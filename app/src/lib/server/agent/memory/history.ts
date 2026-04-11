// ---------------------------------------------------------------------------
// agent/memory/history.ts — Conversation history helpers
// ---------------------------------------------------------------------------

import type { AgentInputItem } from '@openai/agents';
import type { ConversationMessage } from '../types';

/** Keep only the N most recent messages. */
export function sliceHistory<T>(history: T[], max: number | undefined): T[] {
	if (max === undefined || max <= 0 || history.length <= max) return history;
	return history.slice(-max);
}

/**
 * Convert persisted user/assistant messages to SDK AgentInputItem format.
 * Filters out any non-user/assistant roles defensively.
 */
export function messagesToAgentInputItems(
	messages: ConversationMessage[] | undefined
): AgentInputItem[] {
	if (!Array.isArray(messages)) return [];
	const items: AgentInputItem[] = [];
	for (const m of messages) {
		if (m.role === 'user') {
			items.push({ role: 'user', content: m.content });
		} else if (m.role === 'assistant') {
			items.push({
				role: 'assistant',
				status: 'completed' as const,
				content: [{ type: 'output_text' as const, text: m.content }]
			});
		}
	}
	return items;
}
