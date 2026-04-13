import { json } from '@sveltejs/kit';
import { listWorkspaceDirectory } from '$lib/server/services/workspace-storage';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { workspaceId } = await requireWorkspaceAccess(event);

	const entries = await listWorkspaceDirectory(workspaceId, '');
	return json({ entries });
};
