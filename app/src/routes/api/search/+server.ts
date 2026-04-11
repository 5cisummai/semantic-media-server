import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/api';
import { semanticSearch } from '$lib/server/semantic';
import type { MediaType } from '$lib/server/services/storage';

const ALLOWED_MEDIA_TYPES: MediaType[] = ['video', 'audio', 'image', 'document', 'other'];

export const GET: RequestHandler = async ({ url, locals }) => {
	await requireAuth(locals);
	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query) {
		throw error(400, 'Missing query parameter: q');
	}

	const mediaTypeRaw = (url.searchParams.get('mediaType') ?? '').trim();
	const mediaType = ALLOWED_MEDIA_TYPES.includes(mediaTypeRaw as MediaType)
		? (mediaTypeRaw as MediaType)
		: undefined;

	const rootRaw = url.searchParams.get('root');
	const parsedRoot = rootRaw ? Number.parseInt(rootRaw, 10) : undefined;
	const rootIndex =
		typeof parsedRoot === 'number' && !Number.isNaN(parsedRoot) ? parsedRoot : undefined;

	const limitRaw = url.searchParams.get('limit');
	const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
	const limit =
		typeof parsedLimit === 'number' && !Number.isNaN(parsedLimit) ? parsedLimit : undefined;

	const minScoreRaw = url.searchParams.get('minScore');
	const parsedMinScore = minScoreRaw ? Number.parseFloat(minScoreRaw) : undefined;
	const minScore =
		typeof parsedMinScore === 'number' && !Number.isNaN(parsedMinScore)
			? parsedMinScore
			: undefined;

	try {
		const results = await semanticSearch(query, { mediaType, rootIndex, limit, minScore });
		return json({
			query,
			count: results.length,
			results
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Search failed';
		throw error(500, message);
	}
};
