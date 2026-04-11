// ---------------------------------------------------------------------------
// agent/types.ts — Shared types for the entire agent system
// ---------------------------------------------------------------------------

import type { MediaType } from '$lib/server/services/storage';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface AskFilters {
	mediaType?: MediaType;
	rootIndex?: number;
	fileIds?: string[];
	limit?: number;
	minScore?: number;
}

// ---------------------------------------------------------------------------
// Sources & tool call summaries
// ---------------------------------------------------------------------------

export interface Source {
	fileId: string;
	filePath: string;
	chunk: string;
	score: number;
}

export interface ToolCallSummary {
	tool: string;
	args: Record<string, unknown>;
	resultSummary: string;
}

// ---------------------------------------------------------------------------
// Agent request
// ---------------------------------------------------------------------------

export interface AgentRequest {
	question: string;
	history?: ConversationMessage[];
	filters?: AskFilters;
	/**
	 * Tool names the client has opted to run without confirmation (browser preference).
	 * Server only honors names that are mutating tools with needsApproval.
	 */
	autoApproveToolNames?: string[];
}

/** Minimal chat message shape (user/assistant only — persisted in DB). */
export interface ConversationMessage {
	role: 'user' | 'assistant';
	content: string;
}

// ---------------------------------------------------------------------------
// Agent outcome (returned by the loop)
// ---------------------------------------------------------------------------

export type AgentOutcome = AgentComplete | AgentPendingConfirmation;

export interface AgentComplete {
	kind: 'complete';
	sources: Map<string, Source>;
	toolCalls: ToolCallSummary[];
	iterations: number;
	finalText: string | null;
}

export interface AgentPendingConfirmation {
	kind: 'pending_confirmation';
	pendingId: string;
	tool: string;
	args: Record<string, unknown>;
	toolCallsSoFar: ToolCallSummary[];
	sources: Map<string, Source>;
	iterations: number;
}

// ---------------------------------------------------------------------------
// Agent events (emitted during execution for streaming / background tracking)
// ---------------------------------------------------------------------------

export type AgentEvent =
	| { type: 'tool_start'; tool: string; args?: Record<string, unknown> }
	| { type: 'tool_done'; tool: string; resultSummary?: string }
	| { type: 'tool_thinking'; tool: string; thinking: string }
	| { type: 'token'; text: string }
	| { type: 'meta'; payload: AgentMetaPayload }
	| { type: 'confirmation_required'; pendingId: string; tool: string; args: Record<string, unknown>; chatId: string }
	| { type: 'message_saved'; role: 'user' | 'assistant'; id: string }
	| { type: 'error'; message: string; code?: string }
	| { type: 'done' };

export interface AgentMetaPayload {
	chatId: string;
	sources: Source[];
	filters: Record<string, unknown>;
	model: string;
	toolCalls: ToolCallSummary[];
	iterations: number;
	awaitingConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// Run configuration (passed to public API)
// ---------------------------------------------------------------------------

export type TransportMode = 'sync' | 'stream' | 'background';

export interface AgentRunConfig {
	userId: string;
	isAdmin: boolean;
	chatId?: string;
	workspaceId?: string;
	mode: TransportMode;
	/** When true, replay the last user message instead of appending a new one. */
	regenerate?: boolean;
	/** Limit context window to N most recent messages. */
	maxHistoryMessages?: number;
	/** Client opt-in: these mutating tools run without a confirmation step. */
	autoApproveToolNames?: string[];
}

export interface ConfirmRunConfig {
	userId: string;
	isAdmin: boolean;
	pendingId: string;
	approved: boolean;
	chatId?: string;
	workspaceId?: string;
	mode: TransportMode;
	autoApproveToolNames?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 8;
export const DEFAULT_MIN_SCORE = 0.5;
export const MAX_AGENT_ITERATIONS = 20;


