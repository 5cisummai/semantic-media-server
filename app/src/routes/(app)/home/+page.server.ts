import type { PageServerLoad } from './$types';

type AgentSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	status: 'idle' | 'working' | 'done';
};

export const load: PageServerLoad = async ({ fetch }) => {
	const [browseResponse, chatsResponse] = await Promise.all([
		fetch('/api/browse'),
		fetch('/api/chats')
	]);

	const fileTree = browseResponse.ok ? await browseResponse.json() : [];
	const chatsPayload = chatsResponse.ok
		? ((await chatsResponse.json()) as { chats?: AgentSummary[] })
		: null;

	return {
		fileTree,
		agents: Array.isArray(chatsPayload?.chats) ? chatsPayload.chats : []
	};
};
