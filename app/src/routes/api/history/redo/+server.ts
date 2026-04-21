import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { requireMembership } from '$lib/server/services/workspace';
import { redoUserAction } from '$lib/server/fs-history';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireAuth(locals);
	const body = await request.json().catch(() => ({}));
	const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;

	if (workspaceId) {
		try {
			await requireMembership(workspaceId, user.id, 'MEMBER');
		} catch {
			throw error(403, 'Access denied');
		}
	}

	let action;
	try {
		action = await redoUserAction(user.id, workspaceId);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Redo failed';
		throw error(400, message);
	}

	if (!action) {
		throw error(404, 'Nothing to redo or operation cannot be redone');
	}

	return json({ action });
};
