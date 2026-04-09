import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	runBrainAgentLoop,
	normalizeFilters,
	summarizeToolResult,
	type BrainAgentRequest,
	type ToolCallSummary
} from '$lib/server/brain-agent-loop';
import { takePendingConfirmation, type PendingAgentPayload } from '$lib/server/pending-tool-confirmation';
import { saveAssistantMessage } from '$lib/server/chat-store';
import { executeTool } from '$lib/server/tools/executor';
import { streamText } from '$lib/server/services/llm';
import type { MediaType } from '$lib/server/services/storage';
import {
	appendRunToolStreamEvent,
	createBackgroundRun,
	markRunAwaitingConfirmation,
	markRunDone,
	markRunFailed,
	markRunRunning
} from '$lib/server/background-agent-runs';
import type { RequestHandler } from './$types';

interface ConfirmBody {
	pendingId: string;
	approved: boolean;
	chatId?: string;
	stream?: boolean;
	background?: boolean;
}

function buildContinuationBody(
	payload: PendingAgentPayload,
	toolResult: string,
	toolCallsSoFar: ToolCallSummary[]
): BrainAgentRequest {
	const messages = [
		...payload.messages,
		{
			role: 'tool' as const,
			tool_call_id: payload.toolCallId,
			name: payload.toolName,
			content: toolResult
		}
	];

	return {
		question: '',
		continuation: {
			messages,
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
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}
	const user = locals.user;

	const body = (await request.json().catch(() => null)) as ConfirmBody | null;
	if (!body?.pendingId || typeof body.approved !== 'boolean') {
		throw error(400, 'pendingId and approved are required');
	}

	const taken = await takePendingConfirmation(user.id, body.pendingId);
	if (!taken) {
		throw error(404, 'Confirmation expired or not found');
	}

	if (body.chatId && body.chatId !== taken.chatSessionId) {
		throw error(400, 'Chat mismatch');
	}

	const payload = taken.payload;
	const toolExec = { userId: user.id, isAdmin: user.role === 'ADMIN' };

	let toolResult: string;
	if (body.approved) {
		toolResult = await executeTool(payload.toolName, payload.toolArgs, toolExec);
	} else {
		toolResult =
			'User declined this tool action. Acknowledge briefly and offer alternatives (or ask what they would like instead). Do not call the same destructive tool again unless the user clearly asks.';
	}

	const summary: ToolCallSummary = {
		tool: payload.toolName,
		args: payload.toolArgs,
		resultSummary: summarizeToolResult(toolResult)
	};

	const toolCallsSoFar: ToolCallSummary[] = [...payload.toolCallsSoFar, summary];
	const bodyForAgent = buildContinuationBody(payload, toolResult, toolCallsSoFar);
	const background = body.background === true;

	if (background) {
		const run = createBackgroundRun(user.id, taken.chatSessionId, 'confirm');
		void (async () => {
			markRunRunning(run.id);
			try {
				const outcome = await runBrainAgentLoop(bodyForAgent, {
					userId: user.id,
					chatId: taken.chatSessionId,
					toolExec,
					onToolEvent: (event) => {
						appendRunToolStreamEvent(run.id, { type: event.type, tool: event.tool });
					}
				});

				if (outcome.kind === 'pending_confirmation') {
					markRunAwaitingConfirmation(run.id, {
						pendingId: outcome.pendingId,
						tool: outcome.tool,
						args: outcome.args,
						chatId: taken.chatSessionId
					});
					return;
				}

				const model = env.LLM_MODEL ?? 'llama3.2';
				const answer =
					outcome.finalText ??
					"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

				await saveAssistantMessage(taken.chatSessionId, answer, {
					sources: Array.from(outcome.sources.values()),
					toolCalls: outcome.toolCalls,
					model,
					iterations: outcome.iterations
				});
				markRunDone(run.id);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'LLM request failed';
				console.error('Background confirm run failed:', message);
				markRunFailed(run.id, message);
			}
		})();

		return json({
			chatId: taken.chatSessionId,
			runId: run.id,
			status: run.status
		});
	}

	if (body.stream === true) {
		const encoder = new TextEncoder();
		const readable = new ReadableStream<Uint8Array>({
			async start(controller) {
				const writeLine = (obj: Record<string, unknown>) => {
					controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
				};

				const model = env.LLM_MODEL ?? 'llama3.2';
				const filters = normalizeFilters(bodyForAgent.continuation?.filters);

				try {
					const outcome = await runBrainAgentLoop(bodyForAgent, {
						userId: user.id,
						chatId: taken.chatSessionId,
						toolExec,
						onToolEvent: (event) => {
							writeLine({
								type: event.type,
								tool: event.tool,
								...(event.args !== undefined ? { args: event.args } : {}),
								...(event.resultSummary !== undefined
									? { resultSummary: event.resultSummary }
									: {})
							});
						}
					});

					if (outcome.kind === 'pending_confirmation') {
						writeLine({
							type: 'tool_confirmation_required',
							pendingId: outcome.pendingId,
							tool: outcome.tool,
							args: outcome.args,
							toolCallId: outcome.toolCallId,
							chatId: taken.chatSessionId
						});
						writeLine({
							type: 'meta',
							chatId: taken.chatSessionId,
							sources: Array.from(outcome.sources.values()),
							filters: {
								mediaType: filters.mediaType,
								rootIndex: filters.rootIndex,
								fileIds: filters.fileIds,
								limit: filters.limit,
								minScore: filters.minScore
							},
							model,
							toolCalls: outcome.toolCallsSoFar,
							iterations: outcome.iterations,
							awaitingConfirmation: true
						});
						writeLine({ type: 'done' });
						return;
					}

					writeLine({
						type: 'meta',
						chatId: taken.chatSessionId,
						sources: Array.from(outcome.sources.values()),
						filters: {
							mediaType: filters.mediaType,
							rootIndex: filters.rootIndex,
							fileIds: filters.fileIds,
							limit: filters.limit,
							minScore: filters.minScore
						},
						model,
						toolCalls: outcome.toolCalls,
						iterations: outcome.iterations
					});

					let answer = '';
					for await (const text of streamText(outcome.messages)) {
						answer += text;
						writeLine({ type: 'token', text });
					}
					const assistantRowId = await saveAssistantMessage(taken.chatSessionId, answer, {
						sources: Array.from(outcome.sources.values()),
						toolCalls: outcome.toolCalls,
						model,
						iterations: outcome.iterations
					});
					if (assistantRowId) {
						writeLine({
							type: 'message_saved',
							role: 'assistant',
							id: assistantRowId
						});
					}
					writeLine({ type: 'done' });
				} catch (err) {
					const message = err instanceof Error ? err.message : 'LLM request failed';
					console.error('Confirm stream error:', message);
					writeLine({ type: 'error', message });
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

	try {
		const outcome = await runBrainAgentLoop(bodyForAgent, {
			userId: user.id,
			chatId: taken.chatSessionId,
			toolExec
		});

		const model = env.LLM_MODEL ?? 'llama3.2';
		const filters = normalizeFilters(bodyForAgent.continuation?.filters);

		if (outcome.kind === 'pending_confirmation') {
			return json({
				chatId: taken.chatSessionId,
				awaitingConfirmation: true,
				pendingId: outcome.pendingId,
				pendingTool: outcome.tool,
				pendingArgs: outcome.args,
				pendingToolCallId: outcome.toolCallId,
				toolCalls: outcome.toolCallsSoFar,
				iterations: outcome.iterations,
				sources: Array.from(outcome.sources.values()),
				filters: {
					mediaType: filters.mediaType,
					rootIndex: filters.rootIndex,
					fileIds: filters.fileIds,
					limit: filters.limit,
					minScore: filters.minScore
				},
				model
			});
		}

		const answer =
			outcome.finalText ??
			"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

		await saveAssistantMessage(taken.chatSessionId, answer, {
			sources: Array.from(outcome.sources.values()),
			toolCalls: outcome.toolCalls,
			model,
			iterations: outcome.iterations
		});

		return json({
			chatId: taken.chatSessionId,
			answer,
			sources: Array.from(outcome.sources.values()),
			filters: {
				mediaType: filters.mediaType,
				rootIndex: filters.rootIndex,
				fileIds: filters.fileIds,
				limit: filters.limit,
				minScore: filters.minScore
			},
			model,
			toolCalls: outcome.toolCalls,
			iterations: outcome.iterations
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'LLM request failed';
		console.error('Confirm agent error:', message);
		throw error(500, `LLM request failed: ${message}`);
	}
};
