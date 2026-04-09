// ---------------------------------------------------------------------------
// agent/memory/history.ts — Conversation history helpers
// ---------------------------------------------------------------------------

import type { LlmMessageLike } from '../types';

/** Filter to only user/assistant messages (strip tool messages). */
export function normalizeHistory(history: LlmMessageLike[] | undefined): LlmMessageLike[] {
	if (!Array.isArray(history)) return [];
	return history.filter((m) => m.role === 'user' || m.role === 'assistant');
}

/** Keep only the N most recent messages. */
export function sliceHistory(history: LlmMessageLike[], max: number | undefined): LlmMessageLike[] {
	if (max === undefined || max <= 0 || history.length <= max) return history;
	return history.slice(-max);
}
