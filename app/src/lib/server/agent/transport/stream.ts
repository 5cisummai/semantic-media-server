// ---------------------------------------------------------------------------
// agent/transport/stream.ts — NDJSON streaming response builder (SDK-powered)
// ---------------------------------------------------------------------------

import { run, type AgentInputItem } from '@openai/agents';
import { env } from '$env/dynamic/private';
import { saveAssistantMessage } from '$lib/server/chat-store';
import { getMediaAgent } from '../agent';
import { createPendingConfirmation } from '$lib/server/pending-tool-confirmation';
import { normalizeFilters, serializeFilters } from '../filters';
import { messagesToAgentInputItems } from '../memory/history';
import type { AgentAppContext } from '../context';
import type { AgentRequest, AgentEvent } from '../types';
import { MAX_AGENT_ITERATIONS } from '../types';
import { errorMessage } from '../errors';

/**
 * Build a ReadableStream<Uint8Array> that runs the agent loop with SDK streaming,
 * piping tool events and token deltas as NDJSON.
 *
 * Events emitted:
 *   message_saved (user), tool_start, tool_done, confirmation_required,
 *   token, meta, message_saved (assistant), error, done
 */
export function buildStreamResponse(
	request: AgentRequest,
	appCtx: AgentAppContext,
	opts: {
		chatId: string;
		savedUserMessageId?: string | null;
	}
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const writeLine = (obj: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
			};

			const model = env.LLM_MODEL ?? 'llama3.2';
			const filters = normalizeFilters(request.filters);
			appCtx.filters = filters;

			try {
				if (opts.savedUserMessageId) {
					writeLine({ type: 'message_saved', role: 'user', id: opts.savedUserMessageId });
				}

				// Wire tool events from ctx.onEvent → NDJSON
				appCtx.onEvent = (event: AgentEvent) => {
					switch (event.type) {
						case 'tool_start':
							writeLine({
								type: 'tool_start',
								tool: event.tool,
								...(event.args !== undefined ? { args: event.args } : {})
							});
							break;
						case 'tool_done':
							writeLine({
								type: 'tool_done',
								tool: event.tool,
								...(event.resultSummary !== undefined ? { resultSummary: event.resultSummary } : {})
							});
							break;
						case 'tool_thinking':
							writeLine({ type: 'tool_thinking', tool: event.tool, thinking: event.thinking });
							break;
					}
				};

				const historyItems = messagesToAgentInputItems(request.history);
				const input: AgentInputItem[] = [
					...historyItems,
					{ role: 'user', content: request.question.trim() }
				];

				const agent = getMediaAgent();
				const sdkResult = await run(agent, input, {
					stream: true,
					context: appCtx,
					maxTurns: MAX_AGENT_ITERATIONS
				});

				// Stream token deltas (tool events handled inside tool.execute() via appCtx.onEvent)
				let finalText = '';
				for await (const event of sdkResult) {
					if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
						finalText += event.data.delta;
						writeLine({ type: 'token', text: event.data.delta });
					}
				}

				// ---- Confirmation required ----
				if (sdkResult.interruptions && sdkResult.interruptions.length > 0) {
					const interruption = sdkResult.interruptions[0];
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

					const runStateStr = sdkResult.state.toString();
					const pendingId = await createPendingConfirmation(appCtx.userId, opts.chatId, {
						runState: runStateStr,
						toolName,
						toolArgs
					});

					writeLine({
						type: 'meta',
						chatId: opts.chatId,
						sources: appCtx.sourceTracker.toArray(),
						filters: serializeFilters(filters),
						model,
						toolCalls: appCtx.toolCalls,
						iterations: sdkResult.currentTurn ?? 0,
						awaitingConfirmation: true
					});
					writeLine({
						type: 'tool_confirmation_required',
						pendingId,
						tool: toolName,
						args: toolArgs,
						chatId: opts.chatId
					});
					writeLine({ type: 'done' });
					return;
				}

				// ---- Complete ----
				const answer =
					finalText ||
					(typeof sdkResult.finalOutput === 'string' ? sdkResult.finalOutput : null) ||
					"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

				writeLine({
					type: 'meta',
					chatId: opts.chatId,
					sources: appCtx.sourceTracker.toArray(),
					filters: serializeFilters(filters),
					model,
					toolCalls: appCtx.toolCalls,
					iterations: sdkResult.currentTurn ?? 0
				});

				const assistantRowId = await saveAssistantMessage(opts.chatId, answer, {
					sources: appCtx.sourceTracker.toArray(),
					toolCalls: appCtx.toolCalls,
					model,
					iterations: sdkResult.currentTurn ?? 0
				});
				if (assistantRowId) {
					writeLine({ type: 'message_saved', role: 'assistant', id: assistantRowId });
				}
				writeLine({ type: 'done' });
			} catch (err) {
				const msg = errorMessage(err);
				appCtx.logger.error('stream.error', { error: msg });
				writeLine({ type: 'error', message: msg });
			} finally {
				controller.close();
			}
		}
	});
}
