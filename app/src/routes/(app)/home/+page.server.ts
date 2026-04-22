import type { PageServerLoad } from './$types';

type AgentSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	status: 'idle' | 'working' | 'done';
};

export interface DriveInfo {
	index: number;
	path: string;
	name: string;
	available: boolean;
	totalBytes?: number;
	usedBytes?: number;
	freeBytes?: number;
	usedPercent?: number;
}

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { activeWorkspaceId } = await parent();

	if (!activeWorkspaceId) {
		return { fileTree: [], agents: [] as AgentSummary[], drives: [] as DriveInfo[] };
	}

	const [browseResponse, chatsResponse, storageResponse] = await Promise.all([
		fetch('/api/browse?recursive=1'),
		fetch(`/api/workspaces/${activeWorkspaceId}/chats`),
		fetch('/api/storage')
	]);

	const fileTree = browseResponse.ok ? await browseResponse.json() : [];
	const chatsPayload = chatsResponse.ok
		? ((await chatsResponse.json()) as { chats?: AgentSummary[] })
		: null;
	const drives = storageResponse.ok ? ((await storageResponse.json()) as DriveInfo[]) : [];

	return {
		fileTree,
		agents: Array.isArray(chatsPayload?.chats) ? chatsPayload.chats : [],
		drives
	};
};
