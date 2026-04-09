import { env } from '$env/dynamic/private';
import { semanticSearch } from '$lib/server/semantic';
import { createPendingConfirmation, type PendingAgentPayload } from '$lib/server/pending-tool-confirmation';
import { ASK_TOOLS } from '$lib/server/tools/definitions';
import { executeTool, toolRequiresUserConfirmation, type ToolExecutionContext } from '$lib/server/tools/executor';
import {
	chatWithTools,
	type LlmMessage,
	type ChatWithToolsResult
} from '$lib/server/services/llm';
import type { MediaType } from '$lib/server/services/storage';

export interface AskFilters {
	mediaType?: MediaType;
	rootIndex?: number;
	fileIds?: string[];
	limit?: number;
	minScore?: number;
}

export interface BrainAgentRequest {
	question: string;
	history?: LlmMessage[];
	filters?: AskFilters;
	/** Resume after user confirmed or declined a mutating tool */
	continuation?: {
		messages: LlmMessage[];
		filters: AskFilters;
		startIteration: number;
		toolCallsSoFar: ToolCallSummary[];
		sources: Source[];
	};
}

export interface Source {
	fileId: string;
	filePath: string;
	chunk: string;
	score: number;
}

export interface ToolCallSummary {
	tool: string;
	args: Record<string, unknown>;
	resultSummary: string;
}

const DEFAULT_LIMIT = 8;
const DEFAULT_MIN_SCORE = 0.5;
export const MAX_AGENT_ITERATIONS = 5;

const AGENT_SYSTEM_PROMPT = `You are an intelligent assistant for a personal file workspace.
You have tools to search, browse, read, move, copy, create folders, and delete the user's files.
Destructive or mutating actions (delete, move, copy, mkdir) require explicit user approval in the UI — the user will confirm before those tools run.
Use tools to find accurate information before answering.
For directory questions use list_directory not search.
For content questions use search first.
For specific file questions use read_file.
Always cite which files your answer draws from.
Never guess — use a tool if you need information.`;

const LIMIT_USER_MESSAGE =
	'The maximum number of tool-use steps was reached. Reply with the best answer you can from the tools already run, or briefly explain what is still missing.';

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asMediaType(value: unknown): MediaType | undefined {
	if (
		value === 'video' ||
		value === 'audio' ||
		value === 'image' ||
		value === 'document' ||
		value === 'other'
	) {
		return value;
	}
	return undefined;
}

export function normalizeFilters(filters?: AskFilters): AskFilters {
	return {
		mediaType: filters?.mediaType,
		rootIndex: filters?.rootIndex,
		fileIds: filters?.fileIds,
		limit:
			typeof filters?.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : DEFAULT_LIMIT,
		minScore:
			typeof filters?.minScore === 'number' && Number.isFinite(filters.minScore)
				? filters.minScore
				: DEFAULT_MIN_SCORE
	};
}

function applySearchDefaults(
	args: Record<string, unknown>,
	filters: AskFilters
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...args };
	if (!asMediaType(merged.mediaType) && filters.mediaType) merged.mediaType = filters.mediaType;
	if (asNumber(merged.rootIndex) === undefined && typeof filters.rootIndex === 'number') {
		merged.rootIndex = filters.rootIndex;
	}
	if (asNumber(merged.limit) === undefined) merged.limit = filters.limit ?? DEFAULT_LIMIT;
	if (asNumber(merged.minScore) === undefined) merged.minScore = filters.minScore ?? DEFAULT_MIN_SCORE;
	return merged;
}

export function summarizeToolResult(result: string): string {
	const compact = result.replace(/\s+/g, ' ').trim();
	if (compact.length <= 220) return compact;
	return `${compact.slice(0, 220)}...`;
}

function extractAssistantToolCallMessage(
	step: Extract<ChatWithToolsResult, { type: 'tool_call' }>
): LlmMessage {
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

	return {
		role: 'assistant',
		content,
		tool_calls: toolCalls
	};
}

async function appendSourcesFromSearchCall(
	sources: Map<string, Source>,
	args: Record<string, unknown>
): Promise<void> {
	const query = asString(args.query);
	if (!query || !query.trim()) return;

	const searchResults = await semanticSearch(query, {
		mediaType: asMediaType(args.mediaType),
		rootIndex: asNumber(args.rootIndex),
		limit: Math.max(1, Math.min(Math.floor(asNumber(args.limit) ?? DEFAULT_LIMIT), 24)),
		minScore: asNumber(args.minScore) ?? DEFAULT_MIN_SCORE
	});

	for (const row of searchResults) {
		const key = row.id;
		if (sources.has(key)) continue;
		sources.set(key, {
			fileId: row.id,
			filePath: row.path,
			chunk: row.name || row.path,
			score: row.score
		});
	}
}

function normalizeHistory(history: LlmMessage[] | undefined): LlmMessage[] {
	if (!Array.isArray(history)) return [];
	return history.filter((m) => m.role === 'user' || m.role === 'assistant');
}

export type ToolStreamEvent = {
	type: 'tool_start' | 'tool_done';
	tool: string;
	args?: Record<string, unknown>;
	resultSummary?: string;
};

export type BrainAgentLoopOutcome =
	| {
			kind: 'complete';
			messages: LlmMessage[];
			sources: Map<string, Source>;
			toolCalls: ToolCallSummary[];
			iterations: number;
			finalText: string | null;
	  }
	| {
			kind: 'pending_confirmation';
			pendingId: string;
			tool: string;
			args: Record<string, unknown>;
			toolCallId: string;
			toolCallsSoFar: ToolCallSummary[];
			sources: Map<string, Source>;
			iterations: number;
	  };

export async function runBrainAgentLoop(
	body: BrainAgentRequest,
	ctx: {
		userId: string;
		chatId: string;
		toolExec: ToolExecutionContext;
		onToolEvent?: (event: ToolStreamEvent) => void;
	}
): Promise<BrainAgentLoopOutcome> {
	const cont = body.continuation;
	const filters = normalizeFilters(cont?.filters ?? body.filters);

	let messages: LlmMessage[];
	if (cont) {
		messages = cont.messages.map((m) => ({ ...m }));
	} else {
		const history = normalizeHistory(body.history);
		const question = body.question.trim();
		messages = [
			{ role: 'system', content: AGENT_SYSTEM_PROMPT },
			...history,
			{ role: 'user', content: question }
		];
	}

	const startIteration = cont?.startIteration ?? 0;
	const toolCalls: ToolCallSummary[] = [...(cont?.toolCallsSoFar ?? [])];
	const sourceMap = new Map<string, Source>();
	if (cont?.sources) {
		for (const s of cont.sources) {
			sourceMap.set(s.fileId, s);
		}
	}

	let finalText: string | null = null;
	let iterations = 0;

	for (let i = startIteration; i < MAX_AGENT_ITERATIONS; i++) {
		iterations = i + 1;
		const result = await chatWithTools(messages, ASK_TOOLS);

		if (result.type === 'text') {
			finalText = result.message;
			break;
		}

		const effectiveArgs =
			result.toolName === 'search' ? applySearchDefaults(result.toolArgs, filters) : result.toolArgs;

		if (toolRequiresUserConfirmation(result.toolName)) {
			const assistantMsg = extractAssistantToolCallMessage(result);
			const messagesWithToolCall = [...messages, assistantMsg];
			const fl = normalizeFilters(filters);
			const pendingPayload: PendingAgentPayload = {
				messages: messagesWithToolCall,
				filters: {
					mediaType: fl.mediaType,
					rootIndex: fl.rootIndex,
					fileIds: fl.fileIds,
					limit: fl.limit,
					minScore: fl.minScore
				},
				toolCallId: result.toolCallId,
				toolName: result.toolName,
				toolArgs: effectiveArgs,
				startIteration: i + 1,
				toolCallsSoFar: toolCalls,
				sources: Array.from(sourceMap.values())
			};
			const pendingId = await createPendingConfirmation(ctx.userId, ctx.chatId, pendingPayload);
			return {
				kind: 'pending_confirmation',
				pendingId,
				tool: result.toolName,
				args: effectiveArgs,
				toolCallId: result.toolCallId,
				toolCallsSoFar: toolCalls,
				sources: sourceMap,
				iterations
			};
		}

		ctx.onToolEvent?.({ type: 'tool_start', tool: result.toolName, args: effectiveArgs });

		const toolResult = await executeTool(result.toolName, effectiveArgs, ctx.toolExec);

		ctx.onToolEvent?.({
			type: 'tool_done',
			tool: result.toolName,
			resultSummary: summarizeToolResult(toolResult)
		});

		toolCalls.push({
			tool: result.toolName,
			args: effectiveArgs,
			resultSummary: summarizeToolResult(toolResult)
		});

		if (result.toolName === 'search') {
			await appendSourcesFromSearchCall(sourceMap, effectiveArgs);
		}

		messages.push(extractAssistantToolCallMessage(result));
		messages.push({
			role: 'tool',
			tool_call_id: result.toolCallId,
			name: result.toolName,
			content: toolResult
		});
	}

	if (finalText === null) {
		messages.push({ role: 'user', content: LIMIT_USER_MESSAGE });
	}

	return {
		kind: 'complete',
		messages,
		sources: sourceMap,
		toolCalls,
		iterations,
		finalText
	};
}
