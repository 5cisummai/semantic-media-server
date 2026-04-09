// ---------------------------------------------------------------------------
// agent/tools/validation.ts — Shared argument coercion / validation helpers
// ---------------------------------------------------------------------------

import type { MediaType } from '$lib/server/services/storage';
import type { ToolExecutionContext } from './types';

const VALID_MEDIA_TYPES = new Set(['video', 'audio', 'image', 'document', 'other']);

export function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return value;
}

export function asStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const out = value.filter((v): v is string => typeof v === 'string').map((v) => v.trim());
	return out.length === value.length ? out : null;
}

export function asMediaType(value: unknown): MediaType | undefined {
	if (typeof value === 'string' && VALID_MEDIA_TYPES.has(value)) {
		return value as MediaType;
	}
	return undefined;
}

/**
 * Require a valid execution context for mutating tools.
 * Returns the context or an error string for the LLM.
 */
export function requireContext(
	toolName: string,
	ctx: ToolExecutionContext | undefined
): ToolExecutionContext | string {
	if (!ctx) {
		return `Error: "${toolName}" requires an authenticated user context.`;
	}
	return ctx;
}
