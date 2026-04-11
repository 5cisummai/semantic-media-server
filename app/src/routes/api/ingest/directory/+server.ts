import { error, json } from '@sveltejs/kit';
import { ingestDirectoryByRootIndex } from '$lib/server/services/ingestion';
import { ingestDirectorySchema, parseBody, requireAdmin } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const { rootIndex } = await parseBody(request, ingestDirectorySchema);

	try {
		const summary = await ingestDirectoryByRootIndex(rootIndex);
		return json({ success: true, summary });
	} catch (err) {
		throw error(500, err instanceof Error ? err.message : 'Directory ingestion failed');
	}
};
