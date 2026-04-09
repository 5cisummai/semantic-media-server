// ---------------------------------------------------------------------------
// agent/filters.ts — Filter normalization
// ---------------------------------------------------------------------------

import type { AskFilters } from './types';
import { DEFAULT_LIMIT, DEFAULT_MIN_SCORE } from './types';

/** Normalize user-supplied filters, filling in defaults. */
export function normalizeFilters(filters?: AskFilters): AskFilters {
	return {
		mediaType: filters?.mediaType,
		rootIndex: filters?.rootIndex,
		fileIds: filters?.fileIds,
		limit:
			typeof filters?.limit === 'number' && Number.isFinite(filters.limit)
				? filters.limit
				: DEFAULT_LIMIT,
		minScore:
			typeof filters?.minScore === 'number' && Number.isFinite(filters.minScore)
				? filters.minScore
				: DEFAULT_MIN_SCORE
	};
}

/** Serialize filters for JSON responses / NDJSON meta events. */
export function serializeFilters(filters: AskFilters): Record<string, unknown> {
	return {
		mediaType: filters.mediaType,
		rootIndex: filters.rootIndex,
		fileIds: filters.fileIds,
		limit: filters.limit,
		minScore: filters.minScore
	};
}
