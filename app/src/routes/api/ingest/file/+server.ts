import { error, json } from '@sveltejs/kit';
import { ingestFileByRelativePath } from '$lib/server/services/ingestion';
import type { RequestHandler } from './$types';

interface IngestFileRequest {
	path?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	const body = (await request.json().catch(() => null)) as IngestFileRequest | null;
	const relativePath = body?.path?.trim();
	if (!relativePath) {
		throw error(400, 'Path is required');
	}

	try {
		const summary = await ingestFileByRelativePath(relativePath);
		return json({ success: true, summary });
	} catch (err) {
		throw error(500, err instanceof Error ? err.message : 'Ingestion failed');
	}
};
