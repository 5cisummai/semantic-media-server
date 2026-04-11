// ---------------------------------------------------------------------------
// agent/index.ts — Public API for the agent system
//
// Two entry points:
//   runAgent()     — handle a new question or regeneration
//   confirmTool()  — handle tool approval/denial and resume
//
// Both return either a JSON Response or a streaming Response.
// ---------------------------------------------------------------------------

import { json, error } from '@sveltejs/kit';
import { run as sdkRun, RunState } from '@openai/agents';
import { env } from '$env/dynamic/private';
import type { AgentRequest, AgentRunConfig, ConfirmRunConfig, TransportMode } from './types';
import { MAX_AGENT_ITERATIONS } from './types';
import { createAppContext, type AgentAppContext } from './context';
import { AgentLogger } from './logger';
import { normalizeFilters, serializeFilters } from './filters';
import { runAgentLoop } from './loop';
import { buildSyncResponse } from './transport/sync';
import { buildStreamResponse } from './transport/stream';
import { startBackgroundRun } from './transport/background';
import { sliceHistory } from './memory/history';
import { getMediaAgent } from './agent';
import { configureAgentProvider, getAgentModel } from './provider';
import {
	resolveOrCreateChat,
	ensureOwnedChatSession,
	getChatMessagesForUser,
	messagesToLlmHistory,
	saveUserMessage,
	saveAssistantMessage
} from '$lib/server/chat-store';
import {
	createAgentRun,
	markRunRunning,
	markRunDone,
	markRunFailed,
	supersedeOtherRunsForChat
} from '$lib/server/agent-runs';
import { takePendingConfirmation } from '$lib/server/pending-tool-confirmation';
import { errorMessage } from './errors';

// Configure the LLM provider once at module initialization
configureAgentProvider();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModel(): string {
	return env.LLM_MODEL ?? getAgentModel();
}

function makeContext(
	config: {
		userId: string;
		isAdmin: boolean;
		chatId: string;
		workspaceId?: string;
		autoApproveToolNames?: string[];
	},
	logger: AgentLogger,
	filters?: import('./types').AskFilters
): AgentAppContext {
	return createAppContext({
		userId: config.userId,
		chatId: config.chatId,
		isAdmin: config.isAdmin,
		workspaceId: config.workspaceId,
		filters: normalizeFilters(filters),
		autoApproveToolNames: config.autoApproveToolNames,
		logger
	});
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

	const ctx = makeContext(
		{
			userId: config.userId,
			isAdmin: config.isAdmin,
			chatId,
			workspaceId: config.workspaceId,
			autoApproveToolNames: config.autoApproveToolNames
		},
		logger,
		filters
	);

	logger.info('agent.run', { chatId, mode: config.mode, regenerate: !!config.regenerate });

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

	const { payload } = taken;
	const chatId = taken.chatSessionId;

	const agent = getMediaAgent();
	const runState = await RunState.fromString(agent, payload.runState);

	// Approve or reject the interruption
	const interruptions = runState.getInterruptions();
	if (interruptions.length > 0) {
		const interruption = interruptions[0];
		if (config.approved) {
			runState.approve(interruption);
		} else {
			runState.reject(interruption, {
				message:
					'User declined this action. Acknowledge briefly and offer alternatives (or ask what they would like instead). Do not call the same destructive tool again unless the user clearly asks.'
			});
		}
	}

	const ctx = makeContext(
		{
			userId: config.userId,
			isAdmin: config.isAdmin,
			chatId,
			workspaceId: config.workspaceId,
			autoApproveToolNames: config.autoApproveToolNames
		},
		logger
	);

	logger.info('agent.confirm', { chatId, mode: config.mode, approved: config.approved });

	return dispatchResume(config.mode, runState, ctx, { chatId });
}

// ---------------------------------------------------------------------------
// Unified dispatch — routes to sync / stream / background
// ---------------------------------------------------------------------------

async function dispatch(
	mode: TransportMode,
	request: AgentRequest,
	ctx: AgentAppContext,
	opts: { chatId: string; savedUserMessageId?: string | null; kind: 'ask' | 'confirm' }
): Promise<Response> {
	if (mode === 'background') {
		const result = await startBackgroundRun(request, ctx, {
			chatId: opts.chatId,
			kind: opts.kind,
			savedUserMessageId: opts.savedUserMessageId
		});
		return json(result);
	}

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

	// Synchronous
	try {
		const model = getModel();
		const filters = normalizeFilters(request.filters);
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
		throw error(500, `Agent request failed: ${message}`);
	}
}

// ---------------------------------------------------------------------------
// dispatchResume — resumes a paused run from a serialized RunState
// ---------------------------------------------------------------------------

async function dispatchResume(
	mode: TransportMode,
	runState: InstanceType<typeof RunState>,
	ctx: AgentAppContext,
	opts: { chatId: string }
): Promise<Response> {
	const model = getModel();
	const agent = getMediaAgent();

	if (mode === 'background') {
		const agentRun = await createAgentRun(ctx.userId, opts.chatId, 'confirm', ctx.workspaceId);
		await supersedeOtherRunsForChat(ctx.userId, opts.chatId, agentRun.id);

		void (async () => {
			await markRunRunning(agentRun.id);
			try {
				const sdkResult = await sdkRun(agent, runState, {
					context: ctx,
					maxTurns: MAX_AGENT_ITERATIONS
				});
				const finalText = typeof sdkResult.finalOutput === 'string' ? sdkResult.finalOutput : null;
				const answer = finalText ?? "I couldn't complete the request. Please try again.";
				await saveAssistantMessage(opts.chatId, answer, {
					sources: ctx.sourceTracker.toArray(),
					toolCalls: ctx.toolCalls,
					model,
					iterations: 0
				});
				await markRunDone(agentRun.id);
			} catch (err) {
				const message = errorMessage(err);
				ctx.logger.error('resume_bg.failed', { error: message });
				await markRunFailed(agentRun.id, message);
			}
		})();

		return json({ chatId: opts.chatId, runId: agentRun.id, status: 'queued' });
	}

	if (mode === 'stream') {
		const encoder = new TextEncoder();
		const readable = new ReadableStream<Uint8Array>({
			async start(controller) {
				const writeLine = (obj: Record<string, unknown>) => {
					controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
				};
				try {
					const sdkResult = await sdkRun(agent, runState, {
						stream: true,
						context: ctx,
						maxTurns: MAX_AGENT_ITERATIONS
					});

					let finalText = '';
					for await (const event of sdkResult) {
						if (
							event.type === 'raw_model_stream_event' &&
							event.data.type === 'output_text_delta'
						) {
							finalText += event.data.delta;
							writeLine({ type: 'token', text: event.data.delta });
						}
					}

					const answer =
						finalText ||
						(typeof sdkResult.finalOutput === 'string' ? sdkResult.finalOutput : null) ||
						"I couldn't complete the request.";

					writeLine({
						type: 'meta',
						chatId: opts.chatId,
						sources: ctx.sourceTracker.toArray(),
						filters: serializeFilters(ctx.filters),
						model,
						toolCalls: ctx.toolCalls,
						iterations: sdkResult.currentTurn ?? 0
					});
					const savedId = await saveAssistantMessage(opts.chatId, answer, {
						sources: ctx.sourceTracker.toArray(),
						toolCalls: ctx.toolCalls,
						model,
						iterations: sdkResult.currentTurn ?? 0
					});
					if (savedId) writeLine({ type: 'message_saved', role: 'assistant', id: savedId });
					writeLine({ type: 'done' });
				} catch (err) {
					writeLine({ type: 'error', message: errorMessage(err) });
				} finally {
					controller.close();
				}
			}
		});
		return new Response(readable, {
			headers: {
				'Content-Type': 'application/x-ndjson; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	}

	// Synchronous resume
	try {
		const sdkResult = await sdkRun(agent, runState, {
			context: ctx,
			maxTurns: MAX_AGENT_ITERATIONS
		});
		const finalText = typeof sdkResult.finalOutput === 'string' ? sdkResult.finalOutput : null;
		const answer = finalText ?? "I couldn't complete the request.";
		await saveAssistantMessage(opts.chatId, answer, {
			sources: ctx.sourceTracker.toArray(),
			toolCalls: ctx.toolCalls,
			model,
			iterations: 0
		});
		return json({
			chatId: opts.chatId,
			answer,
			sources: ctx.sourceTracker.toArray(),
			filters: serializeFilters(ctx.filters),
			model,
			toolCalls: ctx.toolCalls,
			iterations: 0
		});
	} catch (err) {
		throw error(500, `Agent resume failed: ${errorMessage(err)}`);
	}
}
