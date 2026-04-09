// ---------------------------------------------------------------------------
// agent/index.ts — Public API for the agent system
//
// Two entry points:
//   runAgent()     — handle a new question or regeneration
//   confirmTool()  — handle tool approval/denial and resume
//
// Both return either a JSON Response or a streaming Response, depending
// on the configured transport mode.
// ---------------------------------------------------------------------------

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { AgentRequest, AgentRunConfig, ConfirmRunConfig, TransportMode } from './types';
import type { AgentContext } from './context';
import { AgentLogger } from './logger';
import { createDefaultRegistry } from './tools';
import { normalizeFilters, serializeFilters } from './filters';
import { runAgentLoop } from './loop';
import { summarizeToolResult } from './loop';
import { buildSyncResponse } from './transport/sync';
import { buildStreamResponse } from './transport/stream';
import { startBackgroundRun } from './transport/background';
import { sliceHistory } from './memory/history';
import {
	resolveOrCreateChat,
	ensureOwnedChatSession,
	getChatMessagesForUser,
	messagesToLlmHistory,
	saveUserMessage,
	saveAssistantMessage
} from '$lib/server/chat-store';
import {
	takePendingConfirmation,
	type PendingAgentPayload
} from '$lib/server/pending-tool-confirmation';
import type { ToolCallSummary } from './types';
import type { MediaType } from '$lib/server/services/storage';
import { errorMessage } from './errors';

// Singleton registry — all built-in tools registered once.
const registry = createDefaultRegistry();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModel(): string {
	return env.LLM_MODEL ?? 'llama3.2';
}

function makeContext(config: { userId: string; isAdmin: boolean; chatId: string }, logger: AgentLogger, filters?: import('./types').AskFilters): AgentContext {
	return {
		userId: config.userId,
		chatId: config.chatId,
		toolExec: { userId: config.userId, isAdmin: config.isAdmin },
		registry,
		filters: normalizeFilters(filters),
		logger
	};
}

// ---------------------------------------------------------------------------
// runAgent — handles new questions and regenerations
// ---------------------------------------------------------------------------

export async function runAgent(
	question: string,
	config: AgentRunConfig,
	filters?: import('./types').AskFilters
): Promise<Response> {
	const logger = new AgentLogger();

	// ---- Resolve or create chat ----
	let chatId: string;
	let bodyForAgent: AgentRequest;
	let savedUserMessageId: string | null = null;

	if (config.regenerate) {
		if (!config.chatId?.trim()) throw error(400, 'chatId is required when regenerate is true');
		try {
			await ensureOwnedChatSession(config.userId, config.chatId);
		} catch {
			throw error(404, 'Chat not found');
		}
		chatId = config.chatId;
		const previousMessages = await getChatMessagesForUser(config.userId, chatId);
		if (previousMessages.length === 0) throw error(400, 'No messages to regenerate from');
		const last = previousMessages[previousMessages.length - 1];
		if (last.role !== 'user') throw error(400, 'Last message must be a user message to regenerate');
		const history = sliceHistory(
			messagesToLlmHistory(previousMessages.slice(0, -1)),
			config.maxHistoryMessages
		);
		bodyForAgent = {
			question: last.content,
			history,
			filters,
			autoApproveToolNames: config.autoApproveToolNames
		};
	} else {
		const chat = await resolveOrCreateChat(config.userId, config.chatId, question).catch(() => {
			throw error(404, 'Chat not found');
		});
		chatId = chat.id;
		const previousMessages = await getChatMessagesForUser(config.userId, chatId);
		const history = sliceHistory(messagesToLlmHistory(previousMessages), config.maxHistoryMessages);
		savedUserMessageId = await saveUserMessage(chatId, question);
		bodyForAgent = {
			question,
			history,
			filters,
			autoApproveToolNames: config.autoApproveToolNames
		};
	}

	const ctx = makeContext({ userId: config.userId, isAdmin: config.isAdmin, chatId }, logger, filters);

	logger.info('agent.run', { chatId, mode: config.mode, regenerate: !!config.regenerate });

	// ---- Dispatch to transport ----
	return dispatch(config.mode, bodyForAgent, ctx, { chatId, savedUserMessageId, kind: 'ask' });
}

// ---------------------------------------------------------------------------
// confirmTool — handles tool approval/denial and resumes the loop
// ---------------------------------------------------------------------------

export async function confirmTool(config: ConfirmRunConfig): Promise<Response> {
	const logger = new AgentLogger();

	const taken = await takePendingConfirmation(config.userId, config.pendingId);
	if (!taken) throw error(404, 'Confirmation expired or not found');
	if (config.chatId && config.chatId !== taken.chatSessionId) throw error(400, 'Chat mismatch');

	const payload = taken.payload;
	const toolExec = { userId: config.userId, isAdmin: config.isAdmin };

	// Execute or decline the tool
	let toolResult: string;
	if (config.approved) {
		try {
			const result = await registry.execute(payload.toolName, payload.toolArgs, toolExec);
			toolResult = result.output;
		} catch (err) {
			toolResult = `Error executing ${payload.toolName}: ${errorMessage(err)}`;
		}
	} else {
		toolResult =
			'User declined this tool action. Acknowledge briefly and offer alternatives (or ask what they would like instead). Do not call the same destructive tool again unless the user clearly asks.';
	}

	const summary: ToolCallSummary = {
		tool: payload.toolName,
		args: payload.toolArgs,
		resultSummary: summarizeToolResult(toolResult)
	};
	const toolCallsSoFar = [...payload.toolCallsSoFar, summary];

	const bodyForAgent: AgentRequest = {
		question: '',
		autoApproveToolNames: config.autoApproveToolNames,
		continuation: {
			messages: [
				...payload.messages,
				{
					role: 'tool' as const,
					tool_call_id: payload.toolCallId,
					name: payload.toolName,
					content: toolResult
				}
			],
			filters: {
				mediaType: payload.filters.mediaType as MediaType | undefined,
				rootIndex: payload.filters.rootIndex,
				fileIds: payload.filters.fileIds,
				limit: payload.filters.limit,
				minScore: payload.filters.minScore
			},
			startIteration: payload.startIteration,
			toolCallsSoFar,
			sources: payload.sources
		}
	};

	const chatId = taken.chatSessionId;
	const ctx = makeContext(
		{ userId: config.userId, isAdmin: config.isAdmin, chatId },
		logger,
		bodyForAgent.continuation!.filters
	);

	logger.info('agent.confirm', { chatId, mode: config.mode, approved: config.approved });

	return dispatch(config.mode, bodyForAgent, ctx, { chatId, kind: 'confirm' });
}

// ---------------------------------------------------------------------------
// Unified dispatch — routes to sync / stream / background
// ---------------------------------------------------------------------------

async function dispatch(
	mode: TransportMode,
	request: AgentRequest,
	ctx: AgentContext,
	opts: { chatId: string; savedUserMessageId?: string | null; kind: 'ask' | 'confirm' }
): Promise<Response> {
	// ---- Background ----
	if (mode === 'background') {
		const result = startBackgroundRun(request, ctx, {
			chatId: opts.chatId,
			kind: opts.kind,
			savedUserMessageId: opts.savedUserMessageId
		});
		return json(result);
	}

	// ---- Streaming ----
	if (mode === 'stream') {
		const readable = buildStreamResponse(request, ctx, {
			chatId: opts.chatId,
			savedUserMessageId: opts.savedUserMessageId
		});
		return new Response(readable, {
			headers: {
				'Content-Type': 'application/x-ndjson; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	}

	// ---- Synchronous ----
	try {
		const model = getModel();
		const filters = normalizeFilters(request.continuation?.filters ?? request.filters);
		const outcome = await runAgentLoop(request, ctx);
		const response = buildSyncResponse(outcome, opts.chatId, model, filters);

		if (!response.awaitingConfirmation) {
			await saveAssistantMessage(opts.chatId, response.answer, {
				sources: response.sources,
				toolCalls: response.toolCalls,
				model: response.model,
				iterations: response.iterations
			});
		}

		return json(response);
	} catch (err) {
		const message = errorMessage(err);
		ctx.logger.error('agent.sync_error', { error: message });
		throw error(500, `LLM request failed: ${message}`);
	}
}
