import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reindexSemanticCollection } from '$lib/server/semantic';
import { requireAdmin } from '$lib/server/api';
import { db } from '$lib/server/db';

export const POST: RequestHandler = async (event) => {
	await requireAdmin(event.locals);

	const workspaceId = event.params.workspaceId;
	if (!workspaceId) throw error(400, 'workspaceId is required');

	const ws = await db.workspace.findUnique({
		where: { id: workspaceId },
		select: { id: true }
	});
	if (!ws) throw error(404, 'Workspace not found');

	try {
		const summary = await reindexSemanticCollection(workspaceId);
		return json({ success: true, summary });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Reindex failed';
		throw error(500, message);
	}
};
