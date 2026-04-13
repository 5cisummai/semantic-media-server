import { error, json } from '@sveltejs/kit';
import {
	listWorkspaceDirectory,
	getWorkspaceFileInfo,
	deleteWorkspaceFile
} from '$lib/server/services/workspace-storage';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { workspaceId } = await requireWorkspaceAccess(event);

	const relativePath = event.params.path || '';

	try {
		const info = await getWorkspaceFileInfo(workspaceId, relativePath);
		if (!info) throw error(404, 'Path not found');

		if (info.type === 'directory') {
			const entries = await listWorkspaceDirectory(workspaceId, relativePath);
			return json({ type: 'directory', path: relativePath, entries });
		}

		const { type: _type, ...rest } = info;
		return json({ type: 'file', ...rest });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : 'Failed to read path';
		throw error(400, msg);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { workspaceId } = await requireWorkspaceAccess(event, 'MEMBER');

	const relativePath = event.params.path || '';
	if (!relativePath) throw error(400, 'Path is required');

	try {
		await deleteWorkspaceFile(workspaceId, relativePath);
		return json({ ok: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to delete';
		throw error(400, msg);
	}
};
