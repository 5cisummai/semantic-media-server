// ---------------------------------------------------------------------------
// agent/tools/types.ts — Tool interface contracts
// ---------------------------------------------------------------------------

import type { LlmToolDefinition } from '$lib/server/services/llm';

/**
 * Context passed to every tool handler at execution time.
 * Contains the authenticated user info needed for permission checks.
 */
export interface ToolExecutionContext {
	userId: string;
	isAdmin: boolean;
}

/**
 * The result of executing a tool. Tools always return a text summary
 * that gets appended to the LLM conversation as a tool response.
 */
export interface ToolResult {
	output: string;
}

/**
 * Handler function signature. Every tool implements this.
 *
 * @param args  — parsed arguments from the LLM tool call
 * @param ctx   — optional execution context (required for mutating tools)
 * @returns       the tool's text output
 */
export type ToolHandler = (
	args: Record<string, unknown>,
	ctx?: ToolExecutionContext
) => Promise<ToolResult>;

/**
 * Complete definition of a tool in the registry.
 *
 * This is the single source of truth: LLM schema, execution handler,
 * and metadata are co-located so adding a tool is a single registration.
 */
export interface ToolDefinition {
	/** Unique tool name (e.g. "search", "delete_file"). */
	name: string;

	/** Human-readable description shown to the LLM. */
	description: string;

	/** JSON Schema for the tool's parameters (OpenAI function-calling format). */
	parameters: Record<string, unknown>;

	/** The function that runs the tool. */
	handler: ToolHandler;

	/** If true, execution pauses for user confirmation before running. */
	requiresConfirmation: boolean;

	/** If true, the tool mutates state (files, DB). Informational. */
	hasSideEffects: boolean;
}

// ---------------------------------------------------------------------------
// Helpers for converting registry entries → LLM tool definitions
// ---------------------------------------------------------------------------

export function toLlmToolDefinition(def: ToolDefinition): LlmToolDefinition {
	return {
		type: 'function',
		function: {
			name: def.name,
			description: def.description,
			parameters: def.parameters
		}
	};
}
