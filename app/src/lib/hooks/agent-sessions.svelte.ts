/**
 * agent-sessions.svelte.ts
 *
 * Client-side reactive store for agent session statuses.
 *
 * - Subscribes to workspace SSE (`run.status` on `/api/workspaces/:id/events`) so
 *   any chat in that workspace reflects background run state.
 * - `ChatLlm` calls `setWorking` / `setIdle` for immediate local feedback.
 * - Any component can call `getStatus(chatId)` to read live status.
 *
 * Usage:
 *   import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
 *   agentSessions.connect(workspaceId); // from layout when active workspace is known
 *   agentSessions.getStatus(chatId); // 'working' | 'idle'
 */

import { browser } from '$app/environment';

type AgentStatus = 'working' | 'idle';

class AgentSessionsStore {
	/** Reactive map of chatId → current status. */
	#statuses = $state(new Map<string, AgentStatus>());

	#es: EventSource | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#workspaceId: string | null = null;

	get statuses(): ReadonlyMap<string, AgentStatus> {
		return this.#statuses;
	}

	getStatus(chatId: string): AgentStatus {
		return this.#statuses.get(chatId) ?? 'idle';
	}

	setWorking(chatId: string) {
		this.#statuses = new Map(this.#statuses).set(chatId, 'working');
	}

	setIdle(chatId: string) {
		const next = new Map(this.#statuses);
		next.delete(chatId);
		this.#statuses = next;
	}

	/** Seed multiple statuses from an initial fetch (e.g. workspace chat list). */
	seedFromChats(chats: { id: string; status: AgentStatus | string }[]) {
		const next = new Map(this.#statuses);
		for (const c of chats) {
			if (c.status === 'working') {
				next.set(c.id, 'working');
			} else {
				next.delete(c.id);
			}
		}
		this.#statuses = next;
	}

	/** Open SSE for the given workspace. Reconnects when `workspaceId` changes. */
	connect(workspaceId: string | null) {
		if (!browser) return;

		if (!workspaceId) {
			this.disconnect();
			return;
		}

		if (this.#workspaceId === workspaceId && this.#es) return;

		this.disconnect();
		this.#workspaceId = workspaceId;

		const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/events?types=${encodeURIComponent('run.status')}`;
		this.#es = new EventSource(url);

		this.#es.addEventListener('run.status', (e: MessageEvent<string>) => {
			try {
				const payload = JSON.parse(e.data) as { chatId?: string; status?: string };
				const { chatId, status } = payload;
				if (!chatId || !status) return;
				if (status === 'queued' || status === 'running') {
					this.setWorking(chatId);
				} else {
					this.setIdle(chatId);
				}
			} catch {
				// malformed event — ignore
			}
		});

		this.#es.onerror = () => {
			this.#es?.close();
			this.#es = null;
			if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
			const wid = this.#workspaceId;
			this.#reconnectTimer = setTimeout(() => {
				this.#reconnectTimer = null;
				if (wid) this.connect(wid);
			}, 5_000);
		};
	}

	disconnect() {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
		this.#es?.close();
		this.#es = null;
		this.#workspaceId = null;
	}
}

export const agentSessions = new AgentSessionsStore();
