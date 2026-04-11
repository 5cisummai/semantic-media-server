// ---------------------------------------------------------------------------
// agent/loop-utils.ts — Shared utilities used by tools and transports
// ---------------------------------------------------------------------------

/** Truncate a tool result string to 220 characters for ToolCallSummary metadata. */
export function summarizeToolResult(result: string): string {
	const compact = result.replace(/\s+/g, ' ').trim();
	return compact.length <= 220 ? compact : `${compact.slice(0, 220)}...`;
}
