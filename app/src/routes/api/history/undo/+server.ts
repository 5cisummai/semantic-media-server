import { json, error } from '@sveltejs/kit';
import { parseBody, requireAuth, workspaceSelectionSchema } from '$lib/server/api';
import { undoUserAction } from '$lib/server/fs-history';
import { requireOptionalWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireAuth(locals);
	const body = await parseBody(request, workspaceSelectionSchema);
	const workspaceId = await requireOptionalWorkspaceAccess(
		body.workspaceId || null,
		user.id,
		'MEMBER'
	);

	let action;
	try {
		action = await undoUserAction(user.id, workspaceId);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Undo failed';
		throw error(400, message);
	}

	if (!action) {
		throw error(404, 'Nothing to undo');
	}

	return json({ action });
};
