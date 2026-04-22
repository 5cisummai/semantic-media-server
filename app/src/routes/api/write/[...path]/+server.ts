import { error, json } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { requireAuth, requirePathAccess } from '$lib/server/api';
import { resolveMediaPath } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireAuth(locals);
	const relativePath = params.path ?? '';
	if (!relativePath) throw error(400, 'Path required');

	await requirePathAccess(user, relativePath);

	const resolved = await resolveMediaPath(relativePath, user);
	if (!resolved) throw error(400, 'Invalid path');

	let stat;
	try {
		stat = await fs.stat(resolved.fullPath);
	} catch {
		throw error(404, 'File not found');
	}

	if (!stat.isFile()) throw error(400, 'Not a file');

	const content = await request.text();
	const tempPath = path.join(
		path.dirname(resolved.fullPath),
		`.tmp-write-${path.basename(resolved.fullPath)}-${Date.now()}`
	);

	try {
		// Write to a temp file first, then atomically replace the target.
		// This avoids opening read-only targets directly for write.
		await fs.writeFile(tempPath, content, 'utf-8');
		await fs.rename(tempPath, resolved.fullPath);
	} catch (err) {
		await fs.unlink(tempPath).catch(() => undefined);
		if (err instanceof Error && 'code' in err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === 'EACCES' || code === 'EPERM') {
				throw error(403, 'No permission to save this file');
			}
		}
		throw err;
	}

	return json({ ok: true });
};
