// ---------------------------------------------------------------------------
// agent/context.ts — Immutable per-run agent context
// ---------------------------------------------------------------------------

import type { ToolRegistry } from './tools/registry';
import type { ToolExecutionContext } from './tools/types';
import type { AgentLogger } from './logger';
import type { AskFilters, AgentEvent } from './types';

/**
 * All the dependencies and configuration an agent run needs.
 *
 * Constructed once before the loop starts, then passed through
 * immutably. This avoids scattered parameter threading and makes
 * the loop function signature clean and testable.
 */
export interface AgentContext {
	/** Authenticated user info for tool permission checks. */
	userId: string;
	chatId: string;
	toolExec: ToolExecutionContext;

	/** Registered tools available to the LLM. */
	registry: ToolRegistry;

	/** Search filters applied to this run. */
	filters: AskFilters;

	/** Structured logger scoped to this run. */
	logger: AgentLogger;

	/** Optional callback for real-time event emission (streaming / background). */
	onEvent?: (event: AgentEvent) => void;
}
