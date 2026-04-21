import { json, error, isHttpError } from '@sveltejs/kit';
import { requireAuth, requirePathAccess, filterPersonalEntries } from '$lib/server/api';
import { listDirectory } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireAuth(locals);
	try {
		const relativePath = params.path ?? '';
		await requirePathAccess(user, relativePath);
		const entries = await listDirectory(relativePath, user);
		const filtered = await filterPersonalEntries(user, entries);

		// Strip fullPath before sending to client
		const safe = filtered.map((entry) => {
			const { fullPath, ...rest } = entry;
			void fullPath;
			return rest;
		});
		return json(safe);
	} catch (err) {
		if (isHttpError(err)) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw error(500, message);
	}
};
