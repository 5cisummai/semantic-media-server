// ---------------------------------------------------------------------------
// agent/memory/sources.ts — Source citation tracking
// ---------------------------------------------------------------------------

import type { SearchResult } from '$lib/server/semantic';
import type { Source } from '../types';

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

	/** Add a single SearchResult as a source (called directly from the search tool). */
	addResult(r: SearchResult): void {
		if (!this.map.has(r.id)) {
			this.map.set(r.id, {
				fileId: r.id,
				filePath: r.path,
				chunk: r.name || r.path,
				score: r.score
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
