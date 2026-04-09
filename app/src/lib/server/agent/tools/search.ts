// ---------------------------------------------------------------------------
// agent/tools/search.ts — Semantic search tool
// ---------------------------------------------------------------------------

import { semanticSearch, type SearchResult } from '$lib/server/semantic';
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

export const searchTool: ToolDefinition = {
	name: 'search',
	description: 'Semantic search across indexed files in the workspace.',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'Natural-language search query.' },
			mediaType: { type: 'string', enum: MEDIA_TYPE_ENUM, description: 'Optional media type filter.' },
			rootIndex: { type: 'number', description: 'Optional media root index to search.' },
			limit: { type: 'number', description: 'Maximum results to return.', default: 8 },
			minScore: { type: 'number', description: 'Minimum similarity score threshold.', default: 0.5 }
		},
		required: ['query']
	},
	requiresConfirmation: false,
	hasSideEffects: false,

	async handler(args): Promise<ToolResult> {
		const query = asString(args.query) ?? '';
		if (!query.trim()) return { output: 'Error: search requires a non-empty "query" string.' };

		const results = await semanticSearch(query, {
			mediaType: asMediaType(args.mediaType),
			rootIndex: asNumber(args.rootIndex),
			limit: Math.max(1, Math.min(Math.floor(asNumber(args.limit) ?? 8), 24)),
			minScore: asNumber(args.minScore) ?? 0.5
		});

		return { output: formatSearchRows(results) };
	}
};
