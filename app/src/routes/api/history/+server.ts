import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { listHistory } from '$lib/server/fs-history';
import { requireOptionalWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = await requireAuth(locals);
	const workspaceId = await requireOptionalWorkspaceAccess(
		url.searchParams.get('workspaceId'),
		user.id,
		'VIEWER'
	);
	const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);

	const actions = await listHistory(workspaceId, Math.min(limit, 50));
	return json(actions);
};
