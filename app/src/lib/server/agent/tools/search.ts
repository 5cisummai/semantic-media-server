// ---------------------------------------------------------------------------
// agent/tools/search.ts — Semantic search tool (SDK tool() + Zod schema)
// ---------------------------------------------------------------------------

import { tool } from '@openai/agents';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { semanticSearch } from '$lib/server/semantic';
import type { SearchResult } from '$lib/server/semantic';
import type { AgentAppContext } from '../context';
import { summarizeToolResult } from '../loop-utils';

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

export const searchTool = tool({
	name: 'search',
	description: 'Semantic search across indexed files in the workspace.',
	parameters: z.object({
		query: z.string().describe('Natural-language search query.'),
		mediaType: z.enum(MEDIA_TYPE_ENUM).optional().describe('Optional media type filter.'),
		rootIndex: z.number().optional().describe('Optional media root index to search.'),
		limit: z.number().optional().default(8).describe('Maximum results to return.'),
		minScore: z.number().optional().default(0.5).describe('Minimum similarity score threshold.')
	}),
	async execute(args, runContext?: RunContext<AgentAppContext>): Promise<string> {
		const ctx = runContext?.context;
		const query = args.query.trim();
		if (!query) return 'Error: search requires a non-empty "query" string.';

		const filters = ctx?.filters;
		const mediaType = args.mediaType ?? filters?.mediaType;
		const rootIndex = args.rootIndex ?? filters?.rootIndex;
		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? filters?.limit ?? 8), 24));
		const minScore = args.minScore ?? filters?.minScore ?? 0.5;

		const effectiveArgs = { query, mediaType, rootIndex, limit, minScore };

		ctx?.onEvent?.({ type: 'tool_start', tool: 'search', args: effectiveArgs });

		const results = await semanticSearch(query, {
			workspaceId: ctx?.workspaceId,
			mediaType,
			rootIndex,
			limit,
			minScore
		});

		const output = formatSearchRows(results);

		// Capture source citations into context
		for (const r of results) ctx?.sourceTracker.addResult(r);

		const summary = summarizeToolResult(output);
		ctx?.toolCalls.push({ tool: 'search', args: effectiveArgs, resultSummary: summary });
		ctx?.onEvent?.({ type: 'tool_done', tool: 'search', resultSummary: summary });

		return output;
	}
});
