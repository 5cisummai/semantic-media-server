// ---------------------------------------------------------------------------
// agent/errors.ts — Structured error hierarchy for the agent system
// ---------------------------------------------------------------------------

/**
 * Base class for all agent errors. Carries a machine-readable `code` so
 * callers can branch on error category without instanceof chains.
 */
export class AgentError extends Error {
	readonly code: string;
	readonly cause?: unknown;

	constructor(code: string, message: string, options?: { cause?: unknown }) {
		super(message);
		this.name = 'AgentError';
		this.code = code;
		this.cause = options?.cause;
	}

	/** Serialise for NDJSON / JSON responses. */
	toJSON(): { code: string; message: string } {
		return { code: this.code, message: this.message };
	}
}

/** A tool returned an error or threw during execution. */
export class ToolError extends AgentError {
	readonly toolName: string;
	readonly toolArgs: Record<string, unknown>;

	constructor(
		toolName: string,
		toolArgs: Record<string, unknown>,
		message: string,
		options?: { cause?: unknown }
	) {
		super('TOOL_ERROR', `Tool "${toolName}" failed: ${message}`, options);
		this.name = 'ToolError';
		this.toolName = toolName;
		this.toolArgs = toolArgs;
	}
}

/** The LLM backend returned an unexpected response or timed out. */
export class ModelError extends AgentError {
	readonly statusCode?: number;

	constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
		super('MODEL_ERROR', message, options);
		this.name = 'ModelError';
		this.statusCode = options?.statusCode;
	}
}

/** Catch-all for infrastructure / config / unexpected runtime failures. */
export class SystemError extends AgentError {
	constructor(message: string, options?: { cause?: unknown }) {
		super('SYSTEM_ERROR', message, options);
		this.name = 'SystemError';
	}
}

/** Input validation failed (bad request body, missing required fields). */
export class ValidationError extends AgentError {
	constructor(message: string) {
		super('VALIDATION_ERROR', message);
		this.name = 'ValidationError';
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	return 'Unknown error';
}
