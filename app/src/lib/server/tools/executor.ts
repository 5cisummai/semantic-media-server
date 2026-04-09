import fs from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import { semanticSearch, type SearchResult } from '$lib/server/semantic';
import {
	copyMediaPath,
	deleteMediaPath,
	mkdirMediaPath,
	moveManyMediaPaths,
	moveMediaPath,
	type MutationUserContext
} from '$lib/server/media-mutations';
import {
	formatSize,
	getMediaInfo,
	listDirectory,
	readFileContent,
	resolveSafePath,
	type MediaType
} from '$lib/server/services/storage';
import { brain } from '$lib/server/services/vectordb';
import { TOOLS_REQUIRING_CONFIRMATION } from '$lib/server/tools/definitions';

export type ToolExecutionContext = MutationUserContext;

interface SearchFilesArgs {
	query: string;
	mediaType?: MediaType;
	rootIndex?: number;
	limit?: number;
	minScore?: number;
}

interface MetadataSearchArgs {
	mediaType?: MediaType;
	rootIndex?: number;
	path_contains?: string;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return value;
}

function asStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const out = value.filter((v): v is string => typeof v === 'string').map((v) => v.trim());
	return out.length === value.length ? out : null;
}

function asMediaType(value: unknown): MediaType | undefined {
	if (
		value === 'video' ||
		value === 'audio' ||
		value === 'image' ||
		value === 'document' ||
		value === 'other'
	) {
		return value;
	}
	return undefined;
}

function toSearchRows(results: SearchResult[]): string {
	if (results.length === 0) return 'No matching files found.';
	return results
		.map(
			(r, i) =>
				`${i + 1}. ${r.path} | score=${r.score.toFixed(3)} | type=${r.mediaType} | name=${r.name}`
		)
		.join('\n');
}

async function runSearchFiles(rawArgs: Record<string, unknown>): Promise<string> {
	const args: SearchFilesArgs = {
		query: asString(rawArgs.query) ?? '',
		mediaType: asMediaType(rawArgs.mediaType),
		rootIndex: asNumber(rawArgs.rootIndex),
		limit: asNumber(rawArgs.limit),
		minScore: asNumber(rawArgs.minScore)
	};

	if (!args.query.trim()) return 'Error: search requires a non-empty "query" string.';

	const results = await semanticSearch(args.query, {
		mediaType: args.mediaType,
		rootIndex: args.rootIndex,
		limit: Math.max(1, Math.min(Math.floor(args.limit ?? 8), 24)),
		minScore: args.minScore ?? 0.5
	});

	return toSearchRows(results);
}

async function runListDirectory(rawArgs: Record<string, unknown>): Promise<string> {
	const targetPath = asString(rawArgs.path);
	if (targetPath === null) return 'Error: list_directory requires a "path" string.';

	const entries = await listDirectory(targetPath);
	if (entries.length === 0) {
		return targetPath.trim() ? `Directory "${targetPath}" is empty.` : 'No media roots available.';
	}

	return entries
		.map((entry) => {
			if (entry.type === 'directory') {
				return `[dir] ${entry.path}`;
			}
			const size = typeof entry.size === 'number' ? formatSize(entry.size) : 'unknown size';
			return `[file] ${entry.path} | ${entry.mediaType ?? 'other'} | ${size}`;
		})
		.join('\n');
}

async function runGetFileInfo(rawArgs: Record<string, unknown>): Promise<string> {
	const relPath = asString(rawArgs.path);
	if (!relPath) return 'Error: get_file_info requires a non-empty "path" string.';

	const resolved = resolveSafePath(relPath);
	if (!resolved) return `Error: invalid or out-of-scope path "${relPath}".`;

	const stat = await fs.stat(resolved.fullPath);
	const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
	const media = stat.isFile() ? getMediaInfo(resolved.fullPath).mediaType : 'other';

	return [
		`Path: ${relPath}`,
		`Type: ${kind}`,
		`MediaType: ${media}`,
		`Size: ${formatSize(stat.size)}`,
		`Modified: ${stat.mtime.toISOString()}`
	].join('\n');
}

async function runReadFile(rawArgs: Record<string, unknown>): Promise<string> {
	const relPath = asString(rawArgs.path);
	if (!relPath) return 'Error: read_file requires a non-empty "path" string.';

	const resolved = resolveSafePath(relPath);
	if (!resolved) return `Error: invalid or out-of-scope path "${relPath}".`;

	const info = getMediaInfo(resolved.fullPath);
	const content = await readFileContent(resolved.fullPath, info.mediaType);
	if (content === null) {
		return `File "${relPath}" is not readable as text (detected media type: ${info.mediaType}).`;
	}
	if (!content.trim()) {
		return `File "${relPath}" is empty.`;
	}
	return `File: ${relPath}\n\n${content}`;
}

async function runSearchByMetadata(rawArgs: Record<string, unknown>): Promise<string> {
	const args: MetadataSearchArgs = {
		mediaType: asMediaType(rawArgs.mediaType),
		rootIndex: asNumber(rawArgs.rootIndex),
		path_contains: asString(rawArgs.path_contains) ?? undefined
	};

	const must: Array<Record<string, unknown>> = [];
	if (args.mediaType) {
		must.push({ key: 'mediaType', match: { value: args.mediaType } });
	}
	if (typeof args.rootIndex === 'number') {
		must.push({ key: 'rootIndex', match: { value: args.rootIndex } });
	}

	const collection = env.QDRANT_COLLECTION ?? 'media_semantic';
	const filtered: SearchResult[] = [];
	let offset: string | number | null = null;
	let passes = 0;
	const pathContains = args.path_contains?.toLowerCase().trim();

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

	return toSearchRows(filtered.slice(0, 50));
}

function requireMutationContext(
	name: string,
	ctx: ToolExecutionContext | undefined
): ToolExecutionContext | string {
	if (!ctx) {
		return `Error: "${name}" requires an authenticated user context.`;
	}
	return ctx;
}

async function runDeleteFile(
	rawArgs: Record<string, unknown>,
	ctx: ToolExecutionContext | undefined
): Promise<string> {
	const c = requireMutationContext('delete_file', ctx);
	if (typeof c === 'string') return c;
	const relPath = asString(rawArgs.path);
	if (!relPath) return 'Error: delete_file requires a non-empty "path" string.';
	return deleteMediaPath(relPath, c);
}

async function runMoveFile(
	rawArgs: Record<string, unknown>,
	ctx: ToolExecutionContext | undefined
): Promise<string> {
	const c = requireMutationContext('move_file', ctx);
	if (typeof c === 'string') return c;
	const src = asString(rawArgs.source_path);
	const dst = asString(rawArgs.destination_path);
	if (!src || !dst) return 'Error: move_file requires "source_path" and "destination_path".';
	return moveMediaPath(src, dst, c);
}

async function runMoveFiles(
	rawArgs: Record<string, unknown>,
	ctx: ToolExecutionContext | undefined
): Promise<string> {
	const c = requireMutationContext('move_files', ctx);
	if (typeof c === 'string') return c;
	const srcs = asStringArray(rawArgs.source_paths);
	const dstDir = asString(rawArgs.destination_directory);
	if (!srcs || srcs.length === 0 || !dstDir) {
		return 'Error: move_files requires "source_paths" (string[]) and "destination_directory" (string).';
	}
	return moveManyMediaPaths(srcs, dstDir, c);
}

async function runCopyFile(
	rawArgs: Record<string, unknown>,
	ctx: ToolExecutionContext | undefined
): Promise<string> {
	const c = requireMutationContext('copy_file', ctx);
	if (typeof c === 'string') return c;
	const src = asString(rawArgs.source_path);
	const dst = asString(rawArgs.destination_path);
	if (!src || !dst) return 'Error: copy_file requires "source_path" and "destination_path".';
	return copyMediaPath(src, dst, c);
}

async function runMkdir(rawArgs: Record<string, unknown>): Promise<string> {
	const relPath = asString(rawArgs.path);
	if (!relPath) return 'Error: mkdir requires a non-empty "path" string.';
	return mkdirMediaPath(relPath);
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	ctx?: ToolExecutionContext
): Promise<string> {
	try {
		switch (name) {
			case 'search':
				return await runSearchFiles(args);
			case 'list_directory':
				return await runListDirectory(args);
			case 'get_file_info':
				return await runGetFileInfo(args);
			case 'read_file':
				return await runReadFile(args);
			case 'search_by_metadata':
				return await runSearchByMetadata(args);
			case 'delete_file':
				return await runDeleteFile(args, ctx);
			case 'move_file':
				return await runMoveFile(args, ctx);
			case 'move_files':
				return await runMoveFiles(args, ctx);
			case 'copy_file':
				return await runCopyFile(args, ctx);
			case 'mkdir':
				return await runMkdir(args);
			default:
				return `Error: unsupported tool "${name}".`;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown tool execution failure';
		return `Error executing ${name}: ${message}`;
	}
}

export function toolRequiresUserConfirmation(name: string): boolean {
	return TOOLS_REQUIRING_CONFIRMATION.has(name);
}
