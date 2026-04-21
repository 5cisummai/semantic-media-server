import { json, error, isHttpError } from '@sveltejs/kit';
import { requireAuth, filterPersonalEntries } from '$lib/server/api';
import { listDirectoryTree } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireAuth(locals);
	try {
		const entries = await listDirectoryTree('', user);
		const filtered = await filterPersonalEntries(user, entries);
		return json(filtered);
	} catch (err) {
		if (isHttpError(err)) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw error(500, message);
	}
};
