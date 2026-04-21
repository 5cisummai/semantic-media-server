import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { requireMembership } from '$lib/server/services/workspace';
import { listHistory } from '$lib/server/fs-history';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = await requireAuth(locals);
	const workspaceId = url.searchParams.get('workspaceId');
	const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);

	if (workspaceId) {
		try {
			await requireMembership(workspaceId, user.id, 'VIEWER');
		} catch {
			throw error(403, 'Access denied');
		}
	}

	const actions = await listHistory(workspaceId, Math.min(limit, 50));
	return json(actions);
};
