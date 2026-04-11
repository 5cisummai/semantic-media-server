import { browser } from '$app/environment';
import { apiFetch } from '$lib/api-fetch';
import {
	ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
	ACTIVE_WORKSPACE_COOKIE_NAME,
	ACTIVE_WORKSPACE_STORAGE_KEY
} from '$lib/workspace-state';

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
		document.cookie = `${ACTIVE_WORKSPACE_COOKIE_NAME}=${encodeURIComponent(id)}; path=/; max-age=${ACTIVE_WORKSPACE_COOKIE_MAX_AGE}; samesite=strict`;
		return;
	}

	localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
	document.cookie = `${ACTIVE_WORKSPACE_COOKIE_NAME}=; path=/; max-age=0; samesite=strict`;
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

	select(id: string) {
		this.activeId = id;
		persistActiveWorkspaceId(id);
	}

	addWorkspace(ws: WorkspaceSummary) {
		this.workspaces = [ws, ...this.workspaces.filter((workspace) => workspace.id !== ws.id)];
	}
}

export const workspaceStore = new WorkspaceStore();
