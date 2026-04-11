import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import { requireAuth } from '$lib/server/api';
import { resolveSafePath } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	await requireAuth(locals);
	const relativePath = params.path ?? '';
	if (!relativePath) throw error(400, 'Path required');

	const resolved = resolveSafePath(relativePath);
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

	return json({ success: true });
};
