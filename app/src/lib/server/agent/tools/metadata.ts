// ---------------------------------------------------------------------------
// agent/tools/metadata.ts — Metadata-only search tool
// ---------------------------------------------------------------------------

import { env } from '$env/dynamic/private';
import type { SearchResult } from '$lib/server/semantic';
import { brain } from '$lib/server/services/vectordb';
import type { ToolDefinition, ToolResult } from './types';
import { asString, asNumber, asMediaType } from './validation';

const MEDIA_TYPE_ENUM = ['video', 'audio', 'image', 'document', 'other'] as const;

function formatSearchRows(results: SearchResult[]): string {
	if (results.length === 0) return 'No matching files found.';
	return results
		.map(
			(r, i) =>
				`${i + 1}. ${r.path} | score=${r.score.toFixed(3)} | type=${r.mediaType} | name=${r.name}`
		)
		.join('\n');
}

export const searchByMetadataTool: ToolDefinition = {
	name: 'search_by_metadata',
	description: 'Filter indexed files by metadata fields only (no semantic query embedding involved).',
	parameters: {
		type: 'object',
		properties: {
			mediaType: { type: 'string', enum: MEDIA_TYPE_ENUM, description: 'Optional media type filter.' },
			rootIndex: { type: 'number', description: 'Optional media root index.' },
			path_contains: { type: 'string', description: 'Optional case-insensitive path substring filter.' }
		}
	},
	requiresConfirmation: false,
	hasSideEffects: false,

	async handler(args): Promise<ToolResult> {
		const mediaType = asMediaType(args.mediaType);
		const rootIndex = asNumber(args.rootIndex);
		const pathContains = (asString(args.path_contains) ?? '').toLowerCase().trim() || undefined;

		const must: Array<Record<string, unknown>> = [];
		if (mediaType) must.push({ key: 'mediaType', match: { value: mediaType } });
		if (typeof rootIndex === 'number') must.push({ key: 'rootIndex', match: { value: rootIndex } });

		const collection = env.QDRANT_COLLECTION ?? 'media_semantic';
		const filtered: SearchResult[] = [];
		let offset: string | number | null = null;
		let passes = 0;

		while (passes < 5 && filtered.length < 50) {
			const page = await brain.scrollWithFilter(collection, {
				limit: 64,
				offset,
				filter: must.length > 0 ? { must } : undefined,
				withPayload: true
			});

			for (const point of page.points) {
				const payload = point.payload ?? {};
				const p = String(payload.path ?? '');
				if (!p) continue;
				if (pathContains && !p.toLowerCase().includes(pathContains)) continue;
				filtered.push({
					id: String(point.id),
					score: 1,
					name: String(payload.name ?? ''),
					path: p,
					type: 'file',
					mediaType: asMediaType(payload.mediaType) ?? 'other',
					mimeType: payload.mimeType ? String(payload.mimeType) : undefined,
					size: typeof payload.size === 'number' ? payload.size : undefined,
					modified: payload.modified ? String(payload.modified) : undefined,
					rootIndex: typeof payload.rootIndex === 'number' ? payload.rootIndex : -1
				});
			}

			passes += 1;
			offset = page.nextOffset;
			if (!offset) break;
		}

		return { output: formatSearchRows(filtered.slice(0, 50)) };
	}
};
