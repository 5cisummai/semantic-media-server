// ---------------------------------------------------------------------------
// agent/transport/stream.ts — Real-time SSE streaming transport
//
// Replaces the background polling transport with direct SSE streaming.
// Uses the SDK's `run(agent, input, { stream: true })` to get a
// StreamedRunResult, iterates its events, and writes SSE lines to the client.
// ---------------------------------------------------------------------------

import { run, RunState } from '@openai/agents';
import type {
	StreamedRunResult,
	RunStreamEvent,
	AgentInputItem,
	RunItemStreamEvent,
	RunRawModelStreamEvent
} from '@openai/agents';
import { env } from '$env/dynamic/private';
import { getMediaAgent } from '../agent';
import { createPendingConfirmation } from '$lib/server/pending-tool-confirmation';
import { saveAssistantMessage } from '$lib/server/chat-store';
import {
	createAgentRun,
	markRunRunning,
	markRunDone,
	markRunFailed,
	supersedeOtherRunsForChat,
	emitRunStep
} from '$lib/server/agent-runs';
import type { AgentAppContext } from '../context';
import type { AgentRequest, Source, ToolCallSummary } from '../types';
import { MAX_AGENT_ITERATIONS } from '../types';
import { messagesToAgentInputItems } from '../memory/history';
import { normalizeFilters } from '../filters';
import { errorMessage } from '../errors';
import { getAgentModel } from '../provider';

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Stream an agent run as SSE events
// ---------------------------------------------------------------------------

export interface StreamRunOpts {
	chatId: string;
	kind: 'ask' | 'confirm';
	savedUserMessageId?: string | null;
}

/**
 * Execute the agent and stream SSE events to the client.
 * Returns a Response with Content-Type: text/event-stream.
 */
export function createStreamingResponse(
	request: AgentRequest,
	appCtx: AgentAppContext,
	opts: StreamRunOpts
): Response {
	const encoder = new TextEncoder();

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const write = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(sseEvent(event, data)));
				} catch {
					// controller closed
				}
			};

			try {
				await executeStreamingRun(request, appCtx, opts, write);
			} catch (err) {
				write('error', { message: errorMessage(err) });
			} finally {
				write('done', {});
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		}
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}

/**
 * Resume a paused run (after tool approval/denial) and stream SSE events.
 */
export function createConfirmStreamingResponse(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	runState: RunState<any, any>,
	appCtx: AgentAppContext,
	opts: StreamRunOpts
): Response {
	const encoder = new TextEncoder();

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const write = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(sseEvent(event, data)));
				} catch {
					// controller closed
				}
			};

			try {
				await executeConfirmStreamingRun(runState, appCtx, opts, write);
			} catch (err) {
				write('error', { message: errorMessage(err) });
			} finally {
				write('done', {});
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		}
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}

// ---------------------------------------------------------------------------
// Core streaming execution
// ---------------------------------------------------------------------------

type SSEWriter = (event: string, data: unknown) => void;

async function executeStreamingRun(
	request: AgentRequest,
	appCtx: AgentAppContext,
	opts: StreamRunOpts,
	write: SSEWriter
): Promise<void> {
	const filters = normalizeFilters(request.filters);
	appCtx.filters = filters;

	// Build input: history + new question
	const historyItems = messagesToAgentInputItems(request.history);
	const input: AgentInputItem[] = [
		...historyItems,
		{ role: 'user', content: request.question.trim() }
	];

	const agent = getMediaAgent();

	// Create DB run record for sidebar status
	const agentRun = await createAgentRun(appCtx.userId, opts.chatId, opts.kind, appCtx.workspaceId);
	if (opts.kind === 'confirm') {
		await supersedeOtherRunsForChat(appCtx.userId, opts.chatId, agentRun.id);
	}
	await markRunRunning(agentRun.id);

	// Emit the run/chat IDs so the client can track
	write('run_started', {
		runId: agentRun.id,
		chatId: opts.chatId,
		...(opts.savedUserMessageId ? { userMessageId: opts.savedUserMessageId } : {})
	});

	appCtx.logger.info('stream_run.start', {
		chatId: opts.chatId,
		maxTurns: MAX_AGENT_ITERATIONS,
		historyItems: historyItems.length
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let stream: StreamedRunResult<AgentAppContext, any>;
	try {
		stream = (await run(agent, input, {
			context: appCtx,
			maxTurns: MAX_AGENT_ITERATIONS,
			stream: true
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		})) as StreamedRunResult<AgentAppContext, any>;
	} catch (err) {
		await markRunFailed(agentRun.id, errorMessage(err));
		throw err;
	}

	await processStreamEvents(stream, appCtx, opts, write, agentRun.id);
}

async function executeConfirmStreamingRun(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	runState: RunState<any, any>,
	appCtx: AgentAppContext,
	opts: StreamRunOpts,
	write: SSEWriter
): Promise<void> {
	const agent = getMediaAgent();

	const agentRun = await createAgentRun(appCtx.userId, opts.chatId, 'confirm', appCtx.workspaceId);
	await supersedeOtherRunsForChat(appCtx.userId, opts.chatId, agentRun.id);
	await markRunRunning(agentRun.id);

	write('run_started', { runId: agentRun.id, chatId: opts.chatId });

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let stream: StreamedRunResult<AgentAppContext, any>;
	try {
		stream = (await run(agent, runState, {
			context: appCtx,
			maxTurns: MAX_AGENT_ITERATIONS,
			stream: true
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		})) as StreamedRunResult<AgentAppContext, any>;
	} catch (err) {
		await markRunFailed(agentRun.id, errorMessage(err));
		throw err;
	}

	await processStreamEvents(stream, appCtx, opts, write, agentRun.id);
}

// ---------------------------------------------------------------------------
// Process SDK stream events and map to SSE events for the client
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processStreamEvents(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	stream: StreamedRunResult<AgentAppContext, any>,
	appCtx: AgentAppContext,
	opts: StreamRunOpts,
	write: SSEWriter,
	runId: string
): Promise<void> {
	let accumulatedText = '';
	const model = env.LLM_MODEL ?? getAgentModel();

	try {
		for await (const event of stream) {
			handleStreamEvent(event, appCtx, opts, write, runId);

			// Accumulate text from raw model events
			if (event.type === 'raw_model_stream_event') {
				const delta = extractTextDelta(event);
				if (delta) {
					accumulatedText += delta;
				}
			}
		}

		// Wait for the stream to fully complete
		await stream.completed;

		// Check for interruptions (tool approval requests)
		if (stream.interruptions && stream.interruptions.length > 0) {
			const interruption = stream.interruptions[0];
			const toolName = interruption.name ?? 'unknown_tool';
			let toolArgs: Record<string, unknown> = {};
			try {
				if (
					'arguments' in interruption.rawItem &&
					typeof interruption.rawItem.arguments === 'string'
				) {
					toolArgs = JSON.parse(interruption.rawItem.arguments) as Record<string, unknown>;
				}
			} catch {
				// ignore parse errors
			}

			const runStateStr = stream.state.toString();
			const pendingId = await createPendingConfirmation(appCtx.userId, appCtx.chatId, {
				runState: runStateStr,
				toolName,
				toolArgs
			});

			write('confirmation', {
				pendingId,
				tool: toolName,
				args: toolArgs,
				chatId: opts.chatId
			});

			// Partial text before confirmation — don't save as message yet
			appCtx.logger.info('stream_run.pending_confirmation', { pendingId, tool: toolName });
			// Mark run as awaiting confirmation (for sidebar)
			const { markRunAwaitingConfirmation } = await import('$lib/server/agent-runs');
			await markRunAwaitingConfirmation(runId, {
				pendingId,
				tool: toolName,
				args: toolArgs,
				chatId: opts.chatId
			});
			return;
		}

		// Run completed — extract final output
		const finalText =
			(typeof stream.finalOutput === 'string' ? stream.finalOutput : null) ??
			(accumulatedText || null);
		const answer =
			finalText ??
			"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

		const iterations =
			stream.newItems.filter((i) => i.type === 'tool_call_item' || i.type === 'message_output_item')
				.length || 1;

		// Save assistant message to DB
		const msgId = await saveAssistantMessage(opts.chatId, answer, {
			sources: appCtx.sourceTracker.toArray(),
			toolCalls: appCtx.toolCalls,
			model,
			iterations
		});

		// Emit final metadata
		write('meta', {
			chatId: opts.chatId,
			sources: appCtx.sourceTracker.toArray(),
			toolCalls: appCtx.toolCalls,
			model,
			iterations,
			messageId: msgId
		});

		await markRunDone(runId);
		appCtx.logger.info('stream_run.complete', {
			iterations,
			toolCallCount: appCtx.toolCalls.length
		});
	} catch (err) {
		await markRunFailed(runId, errorMessage(err));
		throw err;
	}
}

function handleStreamEvent(
	event: RunStreamEvent,
	appCtx: AgentAppContext,
	opts: StreamRunOpts,
	write: SSEWriter,
	runId: string
): void {
	switch (event.type) {
		case 'raw_model_stream_event': {
			const delta = extractTextDelta(event);
			if (delta) {
				write('text_delta', { delta });
			}
			break;
		}
		case 'run_item_stream_event': {
			handleRunItemEvent(event, appCtx, opts, write, runId);
			break;
		}
		case 'agent_updated_stream_event': {
			// Could emit agent handoff info, but single-agent for now
			break;
		}
	}
}

function handleRunItemEvent(
	event: RunItemStreamEvent,
	appCtx: AgentAppContext,
	opts: StreamRunOpts,
	write: SSEWriter,
	runId: string
): void {
	const { name, item } = event;

	switch (name) {
		case 'tool_called': {
			const toolName = 'name' in item.rawItem ? String(item.rawItem.name ?? '') : 'unknown';
			let toolArgs: Record<string, unknown> = {};
			try {
				if ('arguments' in item.rawItem && typeof item.rawItem.arguments === 'string') {
					toolArgs = JSON.parse(item.rawItem.arguments) as Record<string, unknown>;
				}
			} catch {
				// ignore
			}
			write('tool_start', { tool: toolName, args: toolArgs });
			emitRunStep(appCtx.workspaceId ?? null, opts.chatId, runId, {
				type: 'tool_call',
				tool: toolName,
				args: toolArgs
			});
			break;
		}
		case 'tool_output': {
			const toolName = 'name' in item.rawItem ? String(item.rawItem.name ?? '') : 'unknown';
			let resultText = '';
			if ('output' in item.rawItem && typeof item.rawItem.output === 'string') {
				resultText =
					item.rawItem.output.length > 220
						? item.rawItem.output.slice(0, 220) + '...'
						: item.rawItem.output;
			}
			write('tool_done', { tool: toolName, result: resultText });
			emitRunStep(appCtx.workspaceId ?? null, opts.chatId, runId, {
				type: 'tool_result',
				tool: toolName,
				resultSummary: resultText
			});
			break;
		}
		case 'reasoning_item_created': {
			// Extract reasoning text if available
			let reasoningText = '';
			if ('rawItem' in item && item.rawItem) {
				const raw = item.rawItem as Record<string, unknown>;
				if (typeof raw.summary === 'string') {
					reasoningText = raw.summary;
				} else if (Array.isArray(raw.summary)) {
					reasoningText = raw.summary
						.filter((s: unknown) => typeof s === 'object' && s !== null && 'text' in s)
						.map((s: unknown) => (s as { text: string }).text)
						.join('\n');
				}
			}
			if (reasoningText) {
				write('reasoning', { text: reasoningText });
			}
			break;
		}
		case 'tool_approval_requested': {
			// Handled after stream completes via stream.interruptions
			break;
		}
		case 'message_output_created': {
			// The final message — text is already streamed via raw_model_stream_event
			break;
		}
		default:
			break;
	}
}

/**
 * Extract text delta from a raw model stream event.
 * Works with both responses API and chat_completions API event shapes.
 */
function extractTextDelta(event: RunRawModelStreamEvent): string | null {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const data = event.data as any;
	if (!data || typeof data !== 'object') return null;

	// Responses API: { type: 'response.output_text.delta', delta: '...' }
	if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') {
		return data.delta;
	}

	// SDK output_text_delta event
	if (data.type === 'output_text_delta' && typeof data.delta === 'string') {
		return data.delta;
	}

	// Chat Completions API (ChatCompletionChunk shape):
	// { choices: [{ delta: { content: '...' } }] }
	if (Array.isArray(data.choices)) {
		const choice = data.choices[0];
		if (choice?.delta?.content && typeof choice.delta.content === 'string') {
			return choice.delta.content;
		}
	}

	// Generic fallback: if data has a delta field with string content
	if (typeof data.delta === 'string') {
		return data.delta;
	}

	return null;
}
