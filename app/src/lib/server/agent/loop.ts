// ---------------------------------------------------------------------------
// agent/loop.ts — Pure agent orchestration loop
//
// plan → act (tool) → observe → iterate → respond
//
// This module has NO HTTP/streaming/DB concerns. It takes an AgentContext
// and returns an AgentOutcome. All side effects (event emission, source
// tracking) flow through the context callbacks.
// ---------------------------------------------------------------------------

import { env } from '$env/dynamic/private';
import { chatWithTools, type ChatWithToolsResult, type LlmMessage } from '$lib/server/services/llm';
import { createPendingConfirmation, type PendingAgentPayload } from '$lib/server/pending-tool-confirmation';
import type { AgentContext } from './context';
import { SourceTracker } from './memory/sources';
import { normalizeHistory } from './memory/history';
import { normalizeFilters } from './filters';
import { ToolError, ModelError, errorMessage } from './errors';
import type {
	AgentRequest,
	AgentOutcome,
	LlmMessageLike,
	ToolCallSummary,
	Source
} from './types';
import { MAX_AGENT_ITERATIONS } from './types';
import { shouldAutoApproveTool } from './auto-approve-tools';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const AGENT_SYSTEM_PROMPT = `You are an intelligent assistant for a personal file workspace.
You have tools to search, browse, read, move, copy, create folders, and delete the user's files.
Destructive or mutating actions (delete, move, copy, mkdir) normally require explicit user approval in the UI. The user may enable auto-approval for specific action types in their browser; when enabled, those tools run without a confirmation prompt.
Use tools to find accurate information before answering.
For directory questions use list_directory not search.
For content questions use search first.
For specific file questions use read_file.
Always cite which files your answer draws from.
Never guess — use a tool if you need information.`;

const LIMIT_USER_MESSAGE =
	'The maximum number of tool-use steps was reached. Reply with the best answer you can from the tools already run, or briefly explain what is still missing.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Summarise a tool result for the ToolCallSummary metadata. */
export function summarizeToolResult(result: string): string {
	const compact = result.replace(/\s+/g, ' ').trim();
	return compact.length <= 220 ? compact : `${compact.slice(0, 220)}...`;
}

/**
 * Extract the assistant message that contains a tool_call so we can
 * append it to the conversation thread faithfully.
 */
function extractAssistantToolCallMessage(
	step: Extract<ChatWithToolsResult, { type: 'tool_call' }>
): LlmMessageLike {
	const raw =
		step.rawMessage && typeof step.rawMessage === 'object'
			? (step.rawMessage as { content?: unknown; tool_calls?: unknown })
			: {};
	const content = typeof raw.content === 'string' ? raw.content : '';
	const toolCalls =
		raw.tool_calls ??
		[
			{
				id: step.toolCallId,
				type: 'function',
				function: {
					name: step.toolName,
					arguments: JSON.stringify(step.toolArgs)
				}
			}
		];

	return { role: 'assistant', content, tool_calls: toolCalls };
}

/** Apply user-level search filter defaults to a search tool call. */
function applySearchDefaults(
	args: Record<string, unknown>,
	filters: import('./types').AskFilters
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...args };
	const asMediaType = (v: unknown) =>
		typeof v === 'string' && ['video', 'audio', 'image', 'document', 'other'].includes(v)
			? v
			: undefined;
	const asNum = (v: unknown) =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	if (!asMediaType(merged.mediaType) && filters.mediaType) merged.mediaType = filters.mediaType;
	if (asNum(merged.rootIndex) === undefined && typeof filters.rootIndex === 'number') {
		merged.rootIndex = filters.rootIndex;
	}
	if (asNum(merged.limit) === undefined) merged.limit = filters.limit ?? 8;
	if (asNum(merged.minScore) === undefined) merged.minScore = filters.minScore ?? 0.5;
	return merged;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Run the agent loop: plan → act → observe → iterate → respond.
 *
 * Pure orchestration — no HTTP, no streaming, no DB writes.
 * Events are emitted via `ctx.onEvent()` for the transport layer to consume.
 */
export async function runAgentLoop(
	request: AgentRequest,
	ctx: AgentContext
): Promise<AgentOutcome> {
	const { registry, logger, filters: rawFilters } = ctx;
	const cont = request.continuation;
	const filters = normalizeFilters(cont?.filters ?? rawFilters);

	// ---- Build initial message thread ----
	let messages: LlmMessageLike[];
	if (cont) {
		messages = cont.messages.map((m) => ({ ...m }));
	} else {
		const history = normalizeHistory(request.history);
		messages = [
			{ role: 'system', content: AGENT_SYSTEM_PROMPT },
			...history,
			{ role: 'user', content: request.question.trim() }
		];
	}

	const startIteration = cont?.startIteration ?? 0;
	const toolCalls: ToolCallSummary[] = [...(cont?.toolCallsSoFar ?? [])];
	const sources = new SourceTracker();
	if (cont?.sources) sources.seed(cont.sources);

	const llmTools = registry.toLlmDefinitions();
	let finalText: string | null = null;
	let iterations = 0;

	logger.info('agent_loop.start', {
		chatId: ctx.chatId,
		startIteration,
		maxIterations: MAX_AGENT_ITERATIONS,
		toolCount: llmTools.length
	});

	// ---- Iteration loop ----
	for (let i = startIteration; i < MAX_AGENT_ITERATIONS; i++) {
		iterations = i + 1;

		logger.debug('agent_loop.iteration', { iteration: iterations });

		let result: ChatWithToolsResult;
		try {
			result = await chatWithTools(messages as LlmMessage[], llmTools);
		} catch (err) {
			throw new ModelError(`LLM call failed: ${errorMessage(err)}`, { cause: err });
		}

		// ---- LLM returned a text response → done ----
		if (result.type === 'text') {
			finalText = result.message;
			logger.info('agent_loop.text_response', { iteration: iterations });
			break;
		}

		// ---- LLM wants to call a tool ----
		const effectiveArgs =
			result.toolName === 'search'
				? applySearchDefaults(result.toolArgs, filters)
				: result.toolArgs;

		logger.info('agent_loop.tool_call', {
			tool: result.toolName,
			iteration: iterations
		});

		// ---- Check if confirmation is needed ----
		const skipConfirmation =
			registry.requiresConfirmation(result.toolName) &&
			shouldAutoApproveTool(request.autoApproveToolNames, result.toolName);

		if (registry.requiresConfirmation(result.toolName) && !skipConfirmation) {
			const assistantMsg = extractAssistantToolCallMessage(result);
			const messagesWithToolCall = [...messages, assistantMsg];

			const pendingPayload: PendingAgentPayload = {
				messages: messagesWithToolCall as LlmMessage[],
				filters: {
					mediaType: filters.mediaType,
					rootIndex: filters.rootIndex,
					fileIds: filters.fileIds,
					limit: filters.limit,
					minScore: filters.minScore
				},
				toolCallId: result.toolCallId,
				toolName: result.toolName,
				toolArgs: effectiveArgs,
				startIteration: i + 1,
				toolCallsSoFar: toolCalls,
				sources: sources.toArray()
			};

			const pendingId = await createPendingConfirmation(ctx.userId, ctx.chatId, pendingPayload);

			logger.info('agent_loop.pending_confirmation', {
				pendingId,
				tool: result.toolName,
				iteration: iterations
			});

			ctx.onEvent?.({
				type: 'confirmation_required',
				pendingId,
				tool: result.toolName,
				args: effectiveArgs,
				toolCallId: result.toolCallId,
				chatId: ctx.chatId
			});

			return {
				kind: 'pending_confirmation',
				pendingId,
				tool: result.toolName,
				args: effectiveArgs,
				toolCallId: result.toolCallId,
				toolCallsSoFar: toolCalls,
				sources: sources.toMap(),
				iterations
			};
		}

		if (skipConfirmation) {
			logger.info('agent_loop.auto_approve_skip_confirmation', {
				tool: result.toolName,
				iteration: iterations
			});
		}

		// ---- Execute the tool ----
		ctx.onEvent?.({ type: 'tool_start', tool: result.toolName, args: effectiveArgs });

		let toolOutput: string;
		try {
			const toolResult = await registry.execute(result.toolName, effectiveArgs, ctx.toolExec);
			toolOutput = toolResult.output;
		} catch (err) {
			// Tool errors are non-fatal — pass the error message back to the LLM
			// so it can recover or inform the user.
			if (err instanceof ToolError) {
				toolOutput = `Error executing ${result.toolName}: ${err.message}`;
				logger.warn('agent_loop.tool_error', { tool: result.toolName, error: err.message });
			} else {
				toolOutput = `Error executing ${result.toolName}: ${errorMessage(err)}`;
				logger.error('agent_loop.tool_error', { tool: result.toolName, error: errorMessage(err) });
			}
		}

		const summary = summarizeToolResult(toolOutput);
		ctx.onEvent?.({ type: 'tool_done', tool: result.toolName, resultSummary: summary });

		toolCalls.push({ tool: result.toolName, args: effectiveArgs, resultSummary: summary });

		// Capture source citations from search calls
		if (result.toolName === 'search') {
			await sources.captureFromSearchArgs(effectiveArgs);
		}

		// Append tool call + result to conversation
		messages.push(extractAssistantToolCallMessage(result));
		messages.push({
			role: 'tool',
			tool_call_id: result.toolCallId,
			name: result.toolName,
			content: toolOutput
		});
	}

	// ---- Iteration limit reached without a text response ----
	if (finalText === null) {
		messages.push({ role: 'user', content: LIMIT_USER_MESSAGE });
		logger.warn('agent_loop.iteration_limit', { iterations });
	}

	logger.info('agent_loop.complete', {
		iterations,
		toolCallCount: toolCalls.length,
		sourceCount: sources.toMap().size,
		elapsedMs: logger.elapsed()
	});

	return {
		kind: 'complete',
		messages,
		sources: sources.toMap(),
		toolCalls,
		iterations,
		finalText
	};
}
