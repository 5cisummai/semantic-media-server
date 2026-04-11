import type { LayoutServerLoad } from './$types';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';
import {
	DEFAULT_WORKSPACE_SLUG,
	listWorkspacesForUser,
	ensureDefaultWorkspaceMembership
} from '$lib/server/services/workspace';
import type { WorkspaceSummary } from '$lib/server/services/workspace';
import { ACTIVE_WORKSPACE_COOKIE_NAME } from '$lib/workspace-state';

export const load: LayoutServerLoad = async ({ cookies, locals }) => {
	const raw = cookies.get(SIDEBAR_COOKIE_NAME);
	const sidebarOpen = raw === undefined ? true : raw === 'true';

	let workspaces: WorkspaceSummary[] = [];
	if (locals.user) {
		workspaces = await listWorkspacesForUser(locals.user.id);
		if (!workspaces.some((workspace) => workspace.slug === DEFAULT_WORKSPACE_SLUG)) {
			await ensureDefaultWorkspaceMembership(locals.user.id);
			workspaces = await listWorkspacesForUser(locals.user.id);
		}
	}

	const requestedActiveWorkspaceId = cookies.get(ACTIVE_WORKSPACE_COOKIE_NAME);
	const activeWorkspaceId = workspaces.some(
		(workspace) => workspace.id === requestedActiveWorkspaceId
	)
		? requestedActiveWorkspaceId
		: (workspaces[0]?.id ?? null);

	return { sidebarOpen, workspaces, activeWorkspaceId };
};
