import type { PageServerLoad } from './$types';
import { CHAT_AGENTS_SIDEBAR_COOKIE } from '$lib/components/ui/sidebar/constants.js';

export const load: PageServerLoad = async ({ cookies }) => {
	const raw = cookies.get(CHAT_AGENTS_SIDEBAR_COOKIE);
	const agentsSidebarOpen = raw === undefined ? true : raw === 'true';
	return { agentsSidebarOpen };
};
