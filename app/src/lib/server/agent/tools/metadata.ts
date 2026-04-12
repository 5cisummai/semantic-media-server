// ---------------------------------------------------------------------------
// agent/tools/metadata.ts — Metadata-only search tool (SDK tool() + Zod)
// ---------------------------------------------------------------------------

import { tool } from '@openai/agents';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { collectionName as semanticCollectionName } from '$lib/server/semantic';
import type { SearchResult } from '$lib/server/semantic';
import { brain } from '$lib/server/services/vectordb';
import type { AgentAppContext } from '../context';
import { summarizeToolResult } from '../loop-utils';

type MediaType = 'video' | 'audio' | 'image' | 'document' | 'other';
const VALID_MEDIA_TYPES: MediaType[] = ['video', 'audio', 'image', 'document', 'other'];
function asMediaType(val: unknown): MediaType | undefined {
	if (typeof val === 'string' && (VALID_MEDIA_TYPES as string[]).includes(val)) {
		return val as MediaType;
	}
	return undefined;
}

const MEDIA_TYPE_ENUM = VALID_MEDIA_TYPES as unknown as [MediaType, ...MediaType[]];

function formatSearchRows(results: SearchResult[]): string {
	if (results.length === 0) return 'No matching files found.';
	return results
		.map(
			(r, i) =>
				`${i + 1}. ${r.path} | score=${r.score.toFixed(3)} | type=${r.mediaType} | name=${r.name}`
		)
		.join('\n');
}

export const searchByMetadataTool = tool({
	name: 'search_by_metadata',
	description:
		'Filter indexed files by metadata fields only (no semantic query embedding involved).',
	parameters: z.object({
		mediaType: z.enum(MEDIA_TYPE_ENUM).optional().describe('Optional media type filter.'),
		rootIndex: z.number().optional().describe('Optional media root index.'),
		path_contains: z
			.string()
			.optional()
			.describe('Optional case-insensitive path substring filter.')
	}),
	async execute(args, runContext?: RunContext<AgentAppContext>): Promise<string> {
		const ctx = runContext?.context;
		ctx?.onEvent?.({
			type: 'tool_start',
			tool: 'search_by_metadata',
			args: args as Record<string, unknown>
		});

		const mediaType = args.mediaType;
		const rootIndex = args.rootIndex;
		const pathContains = (args.path_contains ?? '').toLowerCase().trim() || undefined;

		const must: Array<Record<string, unknown>> = [];
		if (mediaType) must.push({ key: 'mediaType', match: { value: mediaType } });
		if (typeof rootIndex === 'number') must.push({ key: 'rootIndex', match: { value: rootIndex } });

		const collection = semanticCollectionName(ctx?.workspaceId);
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

		const output = formatSearchRows(filtered.slice(0, 50));
		const summary = summarizeToolResult(output);
		ctx?.toolCalls.push({
			tool: 'search_by_metadata',
			args: args as Record<string, unknown>,
			resultSummary: summary
		});
		ctx?.onEvent?.({ type: 'tool_done', tool: 'search_by_metadata', resultSummary: summary });
		return output;
	}
});
