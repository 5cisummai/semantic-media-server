import { browser } from '$app/environment';
import { apiFetch } from '$lib/api-fetch';
import { ACTIVE_WORKSPACE_STORAGE_KEY } from '$lib/workspace-state';

export interface WorkspaceSummary {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	role: 'ADMIN' | 'MEMBER' | 'VIEWER';
	createdAt: string;
	updatedAt: string;
	memberCount: number;
}

function persistActiveWorkspaceId(id: string | null) {
	if (!browser) return;

	if (id) {
		localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
		return;
	}

	localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
}

async function persistActiveWorkspaceCookie(id: string | null): Promise<void> {
	if (!browser) return;
	try {
		await apiFetch('/api/workspaces/active', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ workspaceId: id })
		});
	} catch {
		// Best effort; UI state still uses local store.
	}
}

function readStoredActiveWorkspaceId(): string | null {
	if (!browser) return null;
	return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
}

class WorkspaceStore {
	workspaces = $state<WorkspaceSummary[]>([]);
	activeId = $state<string | null>(null);
	loading = $state(false);

	get active(): WorkspaceSummary | undefined {
		return this.workspaces.find((w) => w.id === this.activeId);
	}

	hydrate(workspaces: WorkspaceSummary[], activeId: string | null) {
		this.workspaces = workspaces;
		this.activeId = activeId;
		persistActiveWorkspaceId(activeId);
		void persistActiveWorkspaceCookie(activeId);
	}

	async load() {
		this.loading = true;
		try {
			const res = await apiFetch('/api/workspaces');
			if (res.ok) {
				const data = (await res.json()) as { workspaces: WorkspaceSummary[] };
				const stored = readStoredActiveWorkspaceId();
				const current = this.activeId;
				const preferredId = [stored, current].find(
					(id): id is string => !!id && data.workspaces.some((workspace) => workspace.id === id)
				);
				this.hydrate(data.workspaces, preferredId ?? data.workspaces[0]?.id ?? null);
			}
		} finally {
			this.loading = false;
		}
	}

	async select(id: string) {
		this.activeId = id;
		persistActiveWorkspaceId(id);
		await persistActiveWorkspaceCookie(id);
	}

	addWorkspace(ws: WorkspaceSummary) {
		this.workspaces = [ws, ...this.workspaces.filter((workspace) => workspace.id !== ws.id)];
	}
}

export const workspaceStore = new WorkspaceStore();
