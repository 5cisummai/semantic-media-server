// ---------------------------------------------------------------------------
// agent/loop.ts — SDK-based agent loop adapter
//
// Wraps the OpenAI Agents SDK run() call and maps the result to AgentOutcome.
// All tool events (tool_start / tool_done) are emitted inside each tool's
// execute() function via ctx.onEvent, so the loop itself stays clean.
// ---------------------------------------------------------------------------

import { run, type AgentInputItem, type Agent } from '@openai/agents';
import type { RunResult } from '@openai/agents';
import { createPendingConfirmation } from '$lib/server/pending-tool-confirmation';
import { getMediaAgent } from './agent';
import type { AgentAppContext } from './context';
import { SourceTracker } from './memory/sources';
import { normalizeFilters } from './filters';
import { errorMessage } from './errors';
import type { AgentRequest, AgentOutcome } from './types';
import { MAX_AGENT_ITERATIONS } from './types';
import { messagesToAgentInputItems } from './memory/history';

export { summarizeToolResult } from './loop-utils';

/**
 * Run the agent using the SDK. Returns AgentOutcome.
 * Pure — no HTTP, no DB writes except for pending confirmations.
 */
export async function runAgentLoop(
	request: AgentRequest,
	appCtx: AgentAppContext
): Promise<AgentOutcome> {
	const filters = normalizeFilters(request.filters);
	appCtx.filters = filters;

	// Build input: history + new question
	const historyItems = messagesToAgentInputItems(request.history);
	const input: AgentInputItem[] = [
		...historyItems,
		{ role: 'user', content: request.question.trim() }
	];

	const agent = getMediaAgent();

	appCtx.logger.info('agent_loop.start', {
		chatId: appCtx.chatId,
		maxTurns: MAX_AGENT_ITERATIONS,
		historyItems: historyItems.length
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let sdkResult: RunResult<AgentAppContext, any>;
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		sdkResult = (await run(agent, input, {
			context: appCtx,
			maxTurns: MAX_AGENT_ITERATIONS
		})) as RunResult<AgentAppContext, any>;
	} catch (err) {
		throw new Error(`SDK run failed: ${errorMessage(err)}`, { cause: err });
	}

	const iterations =
		sdkResult.newItems.filter(
			(i) => i.type === 'tool_call_item' || i.type === 'message_output_item'
		).length || 1;

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
		const pendingId = await createPendingConfirmation(appCtx.userId, appCtx.chatId, {
			runState: runStateStr,
			toolName,
			toolArgs
		});

		appCtx.logger.info('agent_loop.pending_confirmation', { pendingId, tool: toolName });

		appCtx.onEvent?.({
			type: 'confirmation_required',
			pendingId,
			tool: toolName,
			args: toolArgs,
			chatId: appCtx.chatId
		});

		return {
			kind: 'pending_confirmation',
			pendingId,
			tool: toolName,
			args: toolArgs,
			toolCallsSoFar: appCtx.toolCalls,
			sources: appCtx.sourceTracker.toMap(),
			iterations
		};
	}

	// ---- Complete ----
	const finalText = (sdkResult.finalOutput as string | null | undefined) ?? null;

	appCtx.logger.info('agent_loop.complete', {
		iterations,
		toolCallCount: appCtx.toolCalls.length,
		sourceCount: appCtx.sourceTracker.toMap().size
	});

	return {
		kind: 'complete',
		sources: appCtx.sourceTracker.toMap(),
		toolCalls: appCtx.toolCalls,
		iterations,
		finalText
	};
}
