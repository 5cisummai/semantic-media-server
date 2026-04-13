// ---------------------------------------------------------------------------
// agent/context.ts — Per-run application context passed via RunContext<T>
//
// AgentAppContext is the typed user-land context object passed to every
// tool execute() function via runContext.context. It replaces the old
// AgentContext / ToolExecutionContext split now that the @openai/agents
// SDK owns the run lifecycle.
// ---------------------------------------------------------------------------

import type { AgentLogger } from './logger';
import type { AskFilters, AgentEvent, ToolCallSummary } from './types';
import { SourceTracker } from './memory/sources';

/**
 * Application context for an agent run. Passed to every SDK tool via
 * `runContext.context` (i.e. `RunContext<AgentAppContext>.context`).
 */
export interface AgentAppContext {
	// ---- Identity ----
	userId: string;
	chatId: string;
	isAdmin: boolean;
	workspaceId?: string;

	// ---- Search filters ----
	filters: AskFilters;

	// ---- Tool auto-approve list (from client) ----
	autoApproveToolNames?: string[];

	// ---- Accumulate source citations across tool calls ----
	sourceTracker: SourceTracker;

	// ---- Accumulate tool call summaries for metadata ----
	toolCalls: ToolCallSummary[];

	// ---- Structured logger ----
	logger: AgentLogger;

	// ---- Real-time event emission (streaming / background transports) ----
	onEvent?: (event: AgentEvent) => void;
}

/**
 * Create a fresh AgentAppContext for one agent run.
 */
export function createAppContext(opts: {
	userId: string;
	chatId: string;
	isAdmin: boolean;
	workspaceId?: string;
	filters: AskFilters;
	autoApproveToolNames?: string[];
	logger: AgentLogger;
	onEvent?: (event: AgentEvent) => void;
}): AgentAppContext {
	return {
		userId: opts.userId,
		chatId: opts.chatId,
		isAdmin: opts.isAdmin,
		workspaceId: opts.workspaceId,
		filters: opts.filters,
		autoApproveToolNames: opts.autoApproveToolNames,
		sourceTracker: new SourceTracker(),
		toolCalls: [],
		logger: opts.logger,
		onEvent: opts.onEvent
	};
}
