// ---------------------------------------------------------------------------
// agent/transport/background.ts — Background run lifecycle
// ---------------------------------------------------------------------------

import { env } from '$env/dynamic/private';
import { runAgentLoop } from '../loop';
import { saveAssistantMessage } from '$lib/server/chat-store';
import {
	createBackgroundRun,
	markRunRunning,
	markRunDone,
	markRunFailed,
	markRunAwaitingConfirmation,
	appendRunToolStreamEvent,
	supersedeOtherRunsForChat,
	type BackgroundRunRecord
} from '$lib/server/background-agent-runs';
import type { AgentContext } from '../context';
import type { AgentRequest, AgentEvent } from '../types';
import { errorMessage } from '../errors';

export interface BackgroundRunResult {
	chatId: string;
	runId: string;
	status: string;
	userMessageId?: string;
}

/**
 * Start a background agent run. Returns immediately with the run ID.
 * The agent loop executes asynchronously; the client polls for status.
 */
export function startBackgroundRun(
	request: AgentRequest,
	ctx: AgentContext,
	opts: {
		chatId: string;
		kind: 'ask' | 'confirm';
		savedUserMessageId?: string | null;
	}
): BackgroundRunResult {
	const run = createBackgroundRun(ctx.userId, opts.chatId, opts.kind);
	// Continuation replaces the run that was waiting on confirmation — retire it so polls/active
	// lookup cannot surface a stale awaiting_confirmation row.
	if (opts.kind === 'confirm') {
		supersedeOtherRunsForChat(ctx.userId, opts.chatId, run.id);
	}

	// Fire-and-forget async execution
	void (async () => {
		markRunRunning(run.id);

		// Wire up tool stream events → background run log
		const ctxWithEvents: AgentContext = {
			...ctx,
			onEvent(event: AgentEvent) {
				ctx.onEvent?.(event);
				if (event.type === 'tool_start' || event.type === 'tool_done') {
					appendRunToolStreamEvent(run.id, { type: event.type, tool: event.tool });
				}
			}
		};

		try {
			const outcome = await runAgentLoop(request, ctxWithEvents);

			if (outcome.kind === 'pending_confirmation') {
				markRunAwaitingConfirmation(run.id, {
					pendingId: outcome.pendingId,
					tool: outcome.tool,
					args: outcome.args,
					chatId: opts.chatId
				});
				return;
			}

			const model = env.LLM_MODEL ?? 'llama3.2';
			const answer =
				outcome.finalText ??
				"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.";

			await saveAssistantMessage(opts.chatId, answer, {
				sources: Array.from(outcome.sources.values()),
				toolCalls: outcome.toolCalls,
				model,
				iterations: outcome.iterations
			});
			markRunDone(run.id);
		} catch (err) {
			const message = errorMessage(err);
			ctx.logger.error('background_run.failed', { runId: run.id, error: message });
			markRunFailed(run.id, message);
		}
	})();

	return {
		chatId: opts.chatId,
		runId: run.id,
		status: run.status,
		...(opts.savedUserMessageId ? { userMessageId: opts.savedUserMessageId } : {})
	};
}
