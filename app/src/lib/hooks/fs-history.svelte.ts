// ---------------------------------------------------------------------------
// fs-history.svelte.ts — Reactive undo/redo hook for the file browser UI
// ---------------------------------------------------------------------------

import { invalidateAll } from '$app/navigation';
import { apiFetch } from '$lib/api-fetch';
import { workspaceStore } from '$lib/hooks/workspace.svelte';

export interface HistoryAction {
	id: string;
	userId: string;
	operation: string;
	status: 'DONE' | 'UNDONE';
	description: string;
	createdAt: string;
	user: { displayName: string; username: string };
}

class FsHistoryStore {
	canUndo = $state(false);
	canRedo = $state(false);
	loading = $state(false);
	lastActionDescription = $state<string | null>(null);
	actions = $state<HistoryAction[]>([]);

	private get workspaceId(): string | null {
		return workspaceStore.activeId ?? null;
	}

	async refresh() {
		const query = this.workspaceId
			? `limit=20&workspaceId=${encodeURIComponent(this.workspaceId)}`
			: 'limit=20';

		try {
			const res = await apiFetch(`/api/history?${query}`);
			if (!res.ok) return;
			const data: HistoryAction[] = await res.json();
			this.actions = data;

			// canUndo = user has at least one DONE action (by current user check is server-side)
			this.canUndo = data.some((a) => a.status === 'DONE');
			this.canRedo = data.some((a) => a.status === 'UNDONE');
		} catch {
			// silently ignore — the toolbar just stays in its current state
		}
	}

	async undo(): Promise<{ success: boolean; description?: string; error?: string }> {
		if (this.loading) return { success: false };
		this.loading = true;
		try {
			const res = await apiFetch('/api/history/undo', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspaceId: this.workspaceId })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				const message: string = body?.message ?? 'Undo failed';
				return { success: false, error: message };
			}

			const { action } = await res.json();
			this.lastActionDescription = `Undid: ${action.description}`;
			await Promise.all([this.refresh(), invalidateAll()]);
			return { success: true, description: this.lastActionDescription };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Undo failed' };
		} finally {
			this.loading = false;
		}
	}

	async redo(): Promise<{ success: boolean; description?: string; error?: string }> {
		if (this.loading) return { success: false };
		this.loading = true;
		try {
			const res = await apiFetch('/api/history/redo', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspaceId: this.workspaceId })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				const message: string = body?.message ?? 'Redo failed';
				return { success: false, error: message };
			}

			const { action } = await res.json();
			this.lastActionDescription = `Redid: ${action.description}`;
			await Promise.all([this.refresh(), invalidateAll()]);
			return { success: true, description: this.lastActionDescription };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Redo failed' };
		} finally {
			this.loading = false;
		}
	}
}

export const fsHistory = new FsHistoryStore();
