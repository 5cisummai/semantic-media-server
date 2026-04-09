// ---------------------------------------------------------------------------
// agent/transport/stream.ts — NDJSON streaming response builder
// ---------------------------------------------------------------------------

import { env } from '$env/dynamic/private';
import { streamText } from '$lib/server/services/llm';
import type { LlmMessage } from '$lib/server/services/llm';
import { saveAssistantMessage } from '$lib/server/chat-store';
import { runAgentLoop } from '../loop';
import { normalizeFilters, serializeFilters } from '../filters';
import type { AgentContext } from '../context';
import type { AgentRequest, AgentEvent } from '../types';
import { errorMessage } from '../errors';

/**
 * Build a ReadableStream<Uint8Array> that runs the agent loop, then
 * streams the final answer token-by-token as NDJSON.
 *
 * Events emitted:
 *   message_saved, tool_start, tool_done, confirmation_required,
 *   meta, token, message_saved (assistant), error, done
 */
export function buildStreamResponse(
	request: AgentRequest,
	ctx: AgentContext,
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
			const filters = normalizeFilters(request.continuation?.filters ?? request.filters);

			try {
				// Notify client of saved user message ID
				if (opts.savedUserMessageId) {
					writeLine({ type: 'message_saved', role: 'user', id: opts.savedUserMessageId });
				}

				// Wire up event forwarding from agent loop → NDJSON stream
				const originalOnEvent = ctx.onEvent;
				ctx = {
					...ctx,
					onEvent(event: AgentEvent) {
						originalOnEvent?.(event);
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
							case 'confirmation_required':
								writeLine({
									type: 'tool_confirmation_required',
									pendingId: event.pendingId,
									tool: event.tool,
									args: event.args,
									toolCallId: event.toolCallId,
									chatId: event.chatId
								});
								break;
						}
					}
				};

				const outcome = await runAgentLoop(request, ctx);

				// Build meta payload
				const metaBase = {
					type: 'meta',
					chatId: opts.chatId,
					sources: outcome.kind === 'complete'
						? Array.from(outcome.sources.values())
						: Array.from(outcome.sources.values()),
					filters: serializeFilters(filters),
					model,
					toolCalls: outcome.kind === 'complete' ? outcome.toolCalls : outcome.toolCallsSoFar,
					iterations: outcome.iterations
				};

				if (outcome.kind === 'pending_confirmation') {
					writeLine({ ...metaBase, awaitingConfirmation: true });
					writeLine({ type: 'done' });
					return;
				}

				writeLine(metaBase);

				// Stream the final text answer token-by-token
				try {
					let answer = '';
					for await (const text of streamText(outcome.messages as LlmMessage[])) {
						answer += text;
						writeLine({ type: 'token', text });
					}

					const assistantRowId = await saveAssistantMessage(opts.chatId, answer, {
						sources: Array.from(outcome.sources.values()),
						toolCalls: outcome.toolCalls,
						model,
						iterations: outcome.iterations
					});
					if (assistantRowId) {
						writeLine({ type: 'message_saved', role: 'assistant', id: assistantRowId });
					}
					writeLine({ type: 'done' });
				} catch (streamErr) {
					const msg = errorMessage(streamErr);
					ctx.logger.error('stream.token_error', { error: msg });
					writeLine({ type: 'error', message: msg });
				}
			} catch (err) {
				const msg = errorMessage(err);
				ctx.logger.error('stream.loop_error', { error: msg });
				writeLine({ type: 'error', message: msg });
			} finally {
				controller.close();
			}
		}
	});
}
