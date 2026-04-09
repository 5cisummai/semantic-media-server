import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	runBrainAgentLoop,
	normalizeFilters,
	type BrainAgentRequest,
	type Source,
	type ToolCallSummary
} from '$lib/server/brain-agent-loop';
import type { LlmMessage } from '$lib/server/services/llm';
import {
	ensureOwnedChatSession,
	getChatMessagesForUser,
	messagesToLlmHistory,
	resolveOrCreateChat,
	saveAssistantMessage,
	saveUserMessage
} from '$lib/server/chat-store';
import {
	appendRunToolStreamEvent,
	createBackgroundRun,
	markRunAwaitingConfirmation,
	markRunDone,
	markRunFailed,
	markRunRunning
} from '$lib/server/background-agent-runs';
import { streamText } from '$lib/server/services/llm';
import type { RequestHandler } from './$types';

interface AskRequest extends BrainAgentRequest {
	chatId?: string;
	stream?: boolean;
	/** When true, does not append a user message; replays the last user message in DB (after client truncation). */
	regenerate?: boolean;
	/** Max number of prior user/assistant messages to pass to the model (newest first slice). */
	maxHistoryMessages?: number;
	/** Start the run server-side and return immediately. */
	background?: boolean;
}

function sliceHistory(history: LlmMessage[], max: number | undefined): LlmMessage[] {
	if (max === undefined || max <= 0 || history.length <= max) return history;
	return history.slice(-max);
}

interface AskResponse {
	chatId: string;
	answer: string;
	sources: Source[];
	filters: Record<string, unknown>;
	model: string;
	toolCalls: ToolCallSummary[];
	iterations: number;
	awaitingConfirmation?: boolean;
	pendingId?: string;
	pendingTool?: string;
	pendingArgs?: Record<string, unknown>;
	pendingToolCallId?: string;
}

async function runAskAgent(
	body: BrainAgentRequest,
	chatId: string,
	toolCtx: { userId: string; isAdmin: boolean }
): Promise<AskResponse> {
	const model = env.LLM_MODEL ?? 'llama3.2';
	const filters = normalizeFilters(body.filters);

	const outcome = await runBrainAgentLoop(body, {
		userId: toolCtx.userId,
		chatId,
		toolExec: { userId: toolCtx.userId, isAdmin: toolCtx.isAdmin }
	});

	if (outcome.kind === 'pending_confirmation') {
		return {
			chatId,
			answer: '',
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
			awaitingConfirmation: true,
			pendingId: outcome.pendingId,
			pendingTool: outcome.tool,
			pendingArgs: outcome.args,
			pendingToolCallId: outcome.toolCallId
		};
	}

	const answer =
		outcome.finalText ??
		"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

	return {
		chatId,
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
	};
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}
	const user = locals.user;

	const body = (await request.json().catch(() => null)) as AskRequest | null;
	if (!body) {
		throw error(400, 'Invalid JSON body');
	}

	const regenerate = body.regenerate === true;
	const maxHistory =
		typeof body.maxHistoryMessages === 'number' &&
		Number.isFinite(body.maxHistoryMessages) &&
		body.maxHistoryMessages > 0
			? Math.floor(body.maxHistoryMessages)
			: undefined;

	if (!regenerate && !body.question?.trim()) {
		throw error(400, 'Question is required');
	}

	let chatId: string;
	let bodyForAgent: BrainAgentRequest;
	/** Set when a new user message row is created (for stream id sync). */
	let savedUserMessageId: string | null = null;

	if (regenerate) {
		if (!body.chatId?.trim()) {
			throw error(400, 'chatId is required when regenerate is true');
		}
		try {
			await ensureOwnedChatSession(user.id, body.chatId);
		} catch {
			throw error(404, 'Chat not found');
		}
		chatId = body.chatId;
		const previousMessages = await getChatMessagesForUser(user.id, chatId);
		if (previousMessages.length === 0) {
			throw error(400, 'No messages to regenerate from');
		}
		const last = previousMessages[previousMessages.length - 1];
		if (last.role !== 'user') {
			throw error(400, 'Last message must be a user message to regenerate');
		}
		let history = messagesToLlmHistory(previousMessages.slice(0, -1));
		history = sliceHistory(history, maxHistory);
		bodyForAgent = {
			question: last.content,
			history,
			filters: body.filters
		};
	} else {
		const chat = await resolveOrCreateChat(user.id, body.chatId, body.question).catch(() => {
			throw error(404, 'Chat not found');
		});
		chatId = chat.id;
		const previousMessages = await getChatMessagesForUser(user.id, chatId);
		let history = messagesToLlmHistory(previousMessages);
		history = sliceHistory(history, maxHistory);
		savedUserMessageId = await saveUserMessage(chatId, body.question);
		bodyForAgent = {
			question: body.question,
			history,
			filters: body.filters
		};
	}

	const stream = body.stream === true;
	const background = body.background === true;

	const toolCtx = { userId: user.id, isAdmin: user.role === 'ADMIN' };

	if (background) {
		const run = createBackgroundRun(user.id, chatId, 'ask');
		void (async () => {
			markRunRunning(run.id);
			try {
				const outcome = await runBrainAgentLoop(bodyForAgent, {
					userId: user.id,
					chatId,
					toolExec: { userId: user.id, isAdmin: user.role === 'ADMIN' },
					onToolEvent: (event) => {
						appendRunToolStreamEvent(run.id, { type: event.type, tool: event.tool });
					}
				});

				if (outcome.kind === 'pending_confirmation') {
					markRunAwaitingConfirmation(run.id, {
						pendingId: outcome.pendingId,
						tool: outcome.tool,
						args: outcome.args,
						chatId
					});
					return;
				}

				const model = env.LLM_MODEL ?? 'llama3.2';
				const answer =
					outcome.finalText ??
					"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

				await saveAssistantMessage(chatId, answer, {
					sources: Array.from(outcome.sources.values()),
					toolCalls: outcome.toolCalls,
					model,
					iterations: outcome.iterations
				});
				markRunDone(run.id);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'LLM request failed';
				console.error('Background ask run failed:', message);
				markRunFailed(run.id, message);
			}
		})();

		return json({
			chatId,
			runId: run.id,
			status: run.status,
			...(savedUserMessageId ? { userMessageId: savedUserMessageId } : {})
		});
	}

	if (stream) {
		const encoder = new TextEncoder();
		const readable = new ReadableStream<Uint8Array>({
			async start(controller) {
				const writeLine = (obj: Record<string, unknown>) => {
					controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
				};

				const model = env.LLM_MODEL ?? 'llama3.2';
				const filters = normalizeFilters(body.filters);

				try {
					if (savedUserMessageId) {
						writeLine({
							type: 'message_saved',
							role: 'user',
							id: savedUserMessageId
						});
					}

					const outcome = await runBrainAgentLoop(bodyForAgent, {
						userId: user.id,
						chatId,
						toolExec: { userId: user.id, isAdmin: user.role === 'ADMIN' },
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
							chatId
						});
						writeLine({
							type: 'meta',
							chatId,
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
						chatId,
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

					try {
						let answer = '';
						for await (const text of streamText(outcome.messages)) {
							answer += text;
							writeLine({ type: 'token', text });
						}
						const assistantRowId = await saveAssistantMessage(chatId, answer, {
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
					} catch (streamErr) {
						const message =
							streamErr instanceof Error ? streamErr.message : 'LLM token stream failed';
						console.error('LLM token stream error:', message);
						writeLine({ type: 'error', message });
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : 'LLM agent loop failed';
					console.error('LLM stream error:', message);
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
		const response = await runAskAgent(bodyForAgent, chatId, toolCtx);
		if (response.awaitingConfirmation && response.pendingId) {
			return json(response);
		}
		await saveAssistantMessage(chatId, response.answer, {
			sources: response.sources,
			toolCalls: response.toolCalls,
			model: response.model,
			iterations: response.iterations
		});
		return json(response);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'LLM request failed';
		console.error('LLM agent loop error:', message);
		throw error(500, `LLM request failed: ${message}`);
	}
};
