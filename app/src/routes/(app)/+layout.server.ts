import type { LayoutServerLoad } from './$types';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const raw = cookies.get(SIDEBAR_COOKIE_NAME);
	const sidebarOpen = raw === undefined ? true : raw === 'true';
	return { sidebarOpen };
};
