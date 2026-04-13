import type { PageServerLoad } from './$types';
import { requireAuth } from '$lib/server/api';
import { getWorkspace } from '$lib/server/services/workspace';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { activeWorkspaceId } = await parent();

	if (!activeWorkspaceId) {
		return { workspace: null };
	}

	const user = await requireAuth(locals);

	return {
		workspace: await getWorkspace(activeWorkspaceId, user.id)
	};
};
