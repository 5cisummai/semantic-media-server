import { error, json } from '@sveltejs/kit';
import { createWorkspace, listWorkspacesForUser } from '$lib/server/services/workspace';
import { createWorkspaceSchema, parseBody, requireAuth } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireAuth(locals);

	const workspaces = await listWorkspacesForUser(user.id);
	return json({ workspaces });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireAuth(locals);
	const body = await parseBody(request, createWorkspaceSchema);

	try {
		const workspace = await createWorkspace(body.name, body.slug, user.id, body.description);
		return json({ workspace }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to create workspace';
		throw error(msg.startsWith('Failed to initialize workspace storage:') ? 500 : 400, msg);
	}
};
