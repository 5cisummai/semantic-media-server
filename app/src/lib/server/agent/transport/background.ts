// ---------------------------------------------------------------------------
// agent/transport/background.ts — Background run lifecycle
// ---------------------------------------------------------------------------

import { env } from '$env/dynamic/private';
import { runAgentLoop } from '../loop';
import { saveAssistantMessage } from '$lib/server/chat-store';
import {
	createAgentRun,
	markRunRunning,
	markRunDone,
	markRunFailed,
	markRunAwaitingConfirmation,
	appendRunToolStreamEvent,
	supersedeOtherRunsForChat,
	appendRunStep
} from '$lib/server/agent-runs';
import type { AgentAppContext } from '../context';
import type { AgentRequest, AgentEvent } from '../types';
import { errorMessage } from '../errors';

export interface BackgroundRunResult {
	chatId: string;
	runId: string;
	status: string;
	userMessageId?: string;
}

/**
 * Start a background agent run. Creates the DB record, then executes
 * the agent loop asynchronously. Returns the run ID for polling.
 */
export async function startBackgroundRun(
	request: AgentRequest,
	appCtx: AgentAppContext,
	opts: {
		chatId: string;
		kind: 'ask' | 'confirm';
		savedUserMessageId?: string | null;
	}
): Promise<BackgroundRunResult> {
	const run = await createAgentRun(appCtx.userId, opts.chatId, opts.kind, appCtx.workspaceId);

	if (opts.kind === 'confirm') {
		await supersedeOtherRunsForChat(appCtx.userId, opts.chatId, run.id);
	}

	void (async () => {
		await markRunRunning(run.id);

		appCtx.onEvent = (event: AgentEvent) => {
			if (event.type === 'tool_start' || event.type === 'tool_done') {
				appendRunToolStreamEvent(run.id, { type: event.type, tool: event.tool });
			}
			if (event.type === 'tool_start') {
				void appendRunStep(run.id, {
					type: 'tool_call',
					timestamp: new Date().toISOString(),
					data: { tool: event.tool, args: event.args }
				});
			}
			if (event.type === 'tool_done') {
				void appendRunStep(run.id, {
					type: 'tool_result',
					timestamp: new Date().toISOString(),
					data: { tool: event.tool, resultSummary: event.resultSummary }
				});
			}
		};

		try {
			const outcome = await runAgentLoop(request, appCtx);

			if (outcome.kind === 'pending_confirmation') {
				await markRunAwaitingConfirmation(run.id, {
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
			await markRunDone(run.id);
		} catch (err) {
			const message = errorMessage(err);
			appCtx.logger.error('background_run.failed', { runId: run.id, error: message });
			await markRunFailed(run.id, message);
		}
	})();

	return {
		chatId: opts.chatId,
		runId: run.id,
		status: 'queued',
		...(opts.savedUserMessageId ? { userMessageId: opts.savedUserMessageId } : {})
	};
}
