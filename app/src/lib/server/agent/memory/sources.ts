// ---------------------------------------------------------------------------
// agent/memory/sources.ts — Source citation tracking
// ---------------------------------------------------------------------------

import { semanticSearch } from '$lib/server/semantic';
import type { Source } from '../types';
import { asString, asNumber, asMediaType } from '../tools/validation';

const DEFAULT_LIMIT = 8;
const DEFAULT_MIN_SCORE = 0.5;

/**
 * Mutable source accumulator. Tracks unique file citations across
 * multiple search tool calls within a single agent run.
 */
export class SourceTracker {
	private map = new Map<string, Source>();

	/** Seed with sources from a prior continuation. */
	seed(sources: Source[]): void {
		for (const s of sources) {
			this.map.set(s.fileId, s);
		}
	}

	/**
	 * After a search tool call, re-run the same query to capture
	 * the source citations (the tool output is text only).
	 */
	async captureFromSearchArgs(args: Record<string, unknown>): Promise<void> {
		const query = asString(args.query);
		if (!query?.trim()) return;

		const results = await semanticSearch(query, {
			mediaType: asMediaType(args.mediaType),
			rootIndex: asNumber(args.rootIndex),
			limit: Math.max(1, Math.min(Math.floor(asNumber(args.limit) ?? DEFAULT_LIMIT), 24)),
			minScore: asNumber(args.minScore) ?? DEFAULT_MIN_SCORE
		});

		for (const row of results) {
			if (this.map.has(row.id)) continue;
			this.map.set(row.id, {
				fileId: row.id,
				filePath: row.path,
				chunk: row.name || row.path,
				score: row.score
			});
		}
	}

	/** Get the accumulated sources as a Map. */
	toMap(): Map<string, Source> {
		return new Map(this.map);
	}

	/** Get the accumulated sources as an array. */
	toArray(): Source[] {
		return Array.from(this.map.values());
	}
}
