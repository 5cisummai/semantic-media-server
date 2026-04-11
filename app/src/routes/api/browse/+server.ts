import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { listDirectoryTree } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAuth(locals);
	try {
		const entries = await listDirectoryTree('');
		return json(entries);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw error(500, message);
	}
};
