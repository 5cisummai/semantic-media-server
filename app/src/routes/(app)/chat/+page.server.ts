import type { PageServerLoad } from './$types';
import { CHAT_AGENTS_SIDEBAR_COOKIE } from '$lib/components/ui/sidebar/constants.js';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const raw = cookies.get(CHAT_AGENTS_SIDEBAR_COOKIE);
	const agentsSidebarOpen = raw === undefined ? true : raw === 'true';
	const initialMessage = url.searchParams.get('q') ?? '';
	const agentId = url.searchParams.get('agent') ?? '';
	return { agentsSidebarOpen, initialMessage, agentId };
};
