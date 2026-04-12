// ---------------------------------------------------------------------------
// services/event-bus.ts — Workspace-scoped event bus
// ---------------------------------------------------------------------------

/**
 * In-process pub/sub for workspace-level events.
 * Subscribers receive events only for the workspaces they subscribe to.
 *
 * Event types:
 *   chat.message    — new message in a chat
 *   chat.created    — new chat session created
 *   chat.deleted    — chat session deleted
 *   run.status      — agent run status change
 *   run.step        — agent run produced a step
 *   file.changed    — file created/updated/deleted
 *   member.joined   — user joined workspace
 *   member.left     — user left workspace
 */

export interface WorkspaceEvent {
	/** The type of event. */
	type: string;
	/** Workspace this event belongs to. */
	workspaceId: string;
	/** Arbitrary event payload. */
	data: Record<string, unknown>;
	/** ISO 8601 timestamp. */
	timestamp: string;
}

export type WorkspaceEventListener = (event: WorkspaceEvent) => void;

interface Subscription {
	id: number;
	workspaceId: string;
	listener: WorkspaceEventListener;
}

let nextId = 1;
const subscriptions = new Map<number, Subscription>();

// Index: workspaceId → subscription ids (for fast dispatch)
const workspaceIndex = new Map<string, Set<number>>();

/**
 * Subscribe to events for a specific workspace.
 * Returns an unsubscribe function.
 */
export function subscribe(workspaceId: string, listener: WorkspaceEventListener): () => void {
	const id = nextId++;
	subscriptions.set(id, { id, workspaceId, listener });

	let wsSet = workspaceIndex.get(workspaceId);
	if (!wsSet) {
		wsSet = new Set();
		workspaceIndex.set(workspaceId, wsSet);
	}
	wsSet.add(id);

	return () => {
		subscriptions.delete(id);
		const s = workspaceIndex.get(workspaceId);
		if (s) {
			s.delete(id);
			if (s.size === 0) workspaceIndex.delete(workspaceId);
		}
	};
}

/**
 * Emit an event to all subscribers of the given workspace.
 */
export function emit(workspaceId: string, type: string, data: Record<string, unknown>): void {
	const event: WorkspaceEvent = {
		type,
		workspaceId,
		data,
		timestamp: new Date().toISOString()
	};

	const subIds = workspaceIndex.get(workspaceId);
	if (!subIds) return;

	for (const id of subIds) {
		const sub = subscriptions.get(id);
		if (sub) {
			try {
				sub.listener(event);
			} catch {
				// Don't let one bad listener break dispatch
			}
		}
	}
}

/**
 * Number of active subscriptions (for diagnostics).
 */
export function subscriberCount(workspaceId?: string): number {
	if (workspaceId) {
		return workspaceIndex.get(workspaceId)?.size ?? 0;
	}
	return subscriptions.size;
}
