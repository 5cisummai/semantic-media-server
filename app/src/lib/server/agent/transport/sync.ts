// ---------------------------------------------------------------------------
// agent/transport/sync.ts — Synchronous JSON response builder
// ---------------------------------------------------------------------------

import type { AgentOutcome, Source, ToolCallSummary } from '../types';
import type { AskFilters } from '../types';
import { serializeFilters } from '../filters';

export interface SyncAgentResponse {
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

export function buildSyncResponse(
	outcome: AgentOutcome,
	chatId: string,
	model: string,
	filters: AskFilters
): SyncAgentResponse {
	const serializedFilters = serializeFilters(filters);

	if (outcome.kind === 'pending_confirmation') {
		return {
			chatId,
			answer: '',
			sources: Array.from(outcome.sources.values()),
			filters: serializedFilters,
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

	return {
		chatId,
		answer:
			outcome.finalText ??
			"I couldn't complete the request within the tool-iteration limit. Please try a narrower question.",
		sources: Array.from(outcome.sources.values()),
		filters: serializedFilters,
		model,
		toolCalls: outcome.toolCalls,
		iterations: outcome.iterations
	};
}
