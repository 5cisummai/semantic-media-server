import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { listDirectory } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	await requireAuth(locals);
	try {
		const relativePath = params.path ?? '';
		const entries = await listDirectory(relativePath);

		// Strip fullPath before sending to client
		const safe = entries.map((entry) => {
			const { fullPath, ...rest } = entry;
			void fullPath;
			return rest;
		});
		return json(safe);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw error(500, message);
	}
};
