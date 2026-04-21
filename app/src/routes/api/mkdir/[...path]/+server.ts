import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { requireAuth, requirePathAccess } from '$lib/server/api';
import { resolveMediaPath } from '$lib/server/services/storage';
import { requireMembership } from '$lib/server/services/workspace';
import { recordAction, FsOperation } from '$lib/server/fs-history';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const user = await requireAuth(locals);
	const relativePath = params.path ?? '';
	if (!relativePath) throw error(400, 'Path required');

	await requirePathAccess(user, relativePath);

	const resolved = await resolveMediaPath(relativePath, user);
	if (!resolved) throw error(400, 'Invalid path');

	try {
		await fs.mkdir(resolved.fullPath);
	} catch (e: unknown) {
		if (e instanceof Error) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === 'EEXIST') throw error(409, 'A folder with that name already exists');
			if (code === 'ENOENT') throw error(400, 'Parent directory does not exist');
		}
		throw error(500, 'Failed to create folder');
	}

	const rawWorkspaceId = request.headers.get('X-Workspace-Id') ?? null;
	let workspaceId: string | null = null;
	if (rawWorkspaceId) {
		try {
			await requireMembership(rawWorkspaceId, user.id, 'MEMBER');
			workspaceId = rawWorkspaceId;
		} catch {
			// Not a member — ignore the header, record without workspace context
		}
	}

	await recordAction({
		userId: user.id,
		workspaceId,
		operation: FsOperation.MKDIR,
		payload: { path: relativePath },
		description: `Created directory ${relativePath}`
	});

	return json({ success: true });
};
