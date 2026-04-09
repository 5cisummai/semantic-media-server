import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { brain, type BrainPoint } from '$lib/server/services/vectordb';
import { embedText, embedImage, createPointId } from '$lib/server/services/embedding';
import {
	getMediaInfo,
	getMediaRoots,
	listDirectory,
	resolveSafePath,
	type MediaEntry,
	type MediaType
} from '$lib/server/services/storage';

export interface SearchResult {
	id: string;
	score: number;
	name: string;
	path: string;
	type: 'file';
	mediaType: MediaType;
	mimeType?: string;
	size?: number;
	modified?: string;
	rootIndex: number;
}

interface ReindexSummary {
	totalFiles: number;
	indexed: number;
	skipped: number;
	deleted: number;
	imageContentEmbeddingsUsed: number;
}

const DEFAULT_REINDEX_CONCURRENCY = 1;
const MAX_REINDEX_CONCURRENCY = 8;

function buildMetadataText(entry: MediaEntry): string {
	const ext = path.extname(entry.name).slice(1).toLowerCase();
	const parts = [
		entry.name,
		entry.path,
		entry.mediaType ?? 'other',
		ext ? `ext:${ext}` : '',
		entry.type,
		entry.mimeType ?? ''
	].filter(Boolean);
	return parts.join(' | ');
}

function isSvgFile(entry: MediaEntry): boolean {
	return path.extname(entry.name).toLowerCase() === '.svg';
}

function resolveSvgEmbedMaxChars(): number {
	const parsed = Number.parseInt(env.SEMANTIC_SVG_EMBED_CHARS ?? '12000', 10);
	if (!Number.isFinite(parsed) || parsed < 2048) return 12_000;
	return Math.min(parsed, 100_000);
}

/** SVG is XML, not a raster — embed UTF-8 source (labels, text, ids) instead of multimodal image bytes. */
async function readSvgTextForEmbedding(entry: MediaEntry): Promise<string> {
	const max = resolveSvgEmbedMaxChars();
	try {
		const raw = await fs.readFile(entry.fullPath, 'utf8');
		if (raw.length <= max) return raw;
		return `${raw.slice(0, max)}\n...[truncated ${raw.length - max} characters]`;
	} catch {
		return '';
	}
}

function resolveReindexConcurrency(): number {
	const candidate = Number.parseInt(env.EMBEDDING_REINDEX_CONCURRENCY ?? String(DEFAULT_REINDEX_CONCURRENCY), 10);

	if (!Number.isFinite(candidate) || candidate < 1) {
		return DEFAULT_REINDEX_CONCURRENCY;
	}

	return Math.min(Math.floor(candidate), MAX_REINDEX_CONCURRENCY);
}

function collectionName(): string {
	return env.QDRANT_COLLECTION ?? 'media_semantic';
}

/** Qdrant collection populated by `/api/ingest/*` (text chunks + embeddings). */
export function ingestCollectionName(): string {
	return env.QDRANT_INGEST_COLLECTION ?? 'media_ingest';
}

/** Chunk-level hit from ingest collection (used for RAG in chat). */
export interface IngestChunkHit {
	id: string;
	score: number;
	path: string;
	chunk: string;
	filename: string;
	chunkIndex: number;
	chunkCount?: number;
	mediaType: MediaType;
	rootIndex: number;
}

/**
 * Heuristic: "what is in my flowers directory" → "flowers".
 * Helps narrow vector hits to paths containing that segment.
 */
export function extractDirectoryHint(question: string): string | null {
	const q = question.trim();
	const patterns = [
		/\b(?:in|inside|under)\s+(?:my|the)\s+(.+?)\s+(?:directory|folder)\b/i,
		/\bwhat(?:'s|s| is)\s+(?:in|inside)\s+(?:my|the)\s+(.+?)\s+(?:directory|folder)\b/i,
		/\b(?:list|show)\s+(?:what(?:'s|s| is)\s+)?(?:in|inside)\s+(?:my|the)\s+(.+?)\s+(?:directory|folder)\b/i
	];
	for (const p of patterns) {
		const m = q.match(p);
		if (m?.[1]) {
			const raw = m[1].trim().replace(/^["']|["']$/g, '');
			if (raw.length > 0 && raw.length < 200) {
				return raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
			}
		}
	}
	return null;
}

/**
 * When vector search finds nothing, answer "what's in my X folder" from the filesystem
 * (works for image-only folders that never produced ingest chunks).
 */
export async function buildDirectoryListingContext(
	directoryHint: string,
	rootIndex?: number
): Promise<string | null> {
	const clean = directoryHint
		.trim()
		.replace(/^[/\\]+/, '')
		.replace(/\\/g, '/');
	if (!clean) return null;

	const roots = getMediaRoots();
	const indices =
		typeof rootIndex === 'number'
			? [rootIndex]
			: Array.from({ length: roots.length }, (_, i) => i);

	const parts: string[] = [];

	for (const ri of indices) {
		if (ri < 0 || ri >= roots.length) continue;
		const rel = `${ri}/${clean}`;

		const resolved = resolveSafePath(rel);
		if (!resolved) continue;

		try {
			const st = await fs.stat(resolved.fullPath);
			if (!st.isDirectory()) continue;
		} catch {
			continue;
		}

		const entries = await listDirectory(rel);
		if (entries.length === 0) {
			parts.push(`Directory ${rel}: (empty)`);
			continue;
		}

		const lines = entries.map((e) =>
			e.type === 'directory' ? `[folder] ${e.name}/` : `[file] ${e.name}`
		);
		parts.push(`Directory ${rel}:\n${lines.join('\n')}`);
	}

	return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Semantic search over ingested file chunks (actual text), not filename metadata.
 */
export async function searchIngestChunks(
	query: string,
	options?: {
		rootIndex?: number;
		/** If set, keep hits whose path or filename contains this substring (case-insensitive). */
		pathContains?: string | null;
		limit?: number;
		/** Internal prefetch before path filtering. */
		prefetchLimit?: number;
		minScore?: number;
	}
): Promise<IngestChunkHit[]> {
	const vector = (await embedText(query)).vector;
	const limit = Math.max(1, Math.min(options?.limit ?? 16, 48));
	const prefetch = Math.min(options?.prefetchLimit ?? (options?.pathContains ? 80 : 40), 128);
	const minScore =
		typeof options?.minScore === 'number'
			? options.minScore
			: Number.parseFloat(env.BRAIN_INGEST_MIN_SCORE ?? '0.2');
	const threshold = Number.isFinite(minScore) ? minScore : 0.2;

	const must: Array<Record<string, unknown>> = [];
	if (typeof options?.rootIndex === 'number') {
		must.push({ key: 'rootIndex', match: { value: options.rootIndex } });
	}

	let rows;
	try {
		rows = await brain.search(ingestCollectionName(), {
			vector,
			limit: prefetch,
			filter: must.length > 0 ? { must } : undefined
		});
	} catch {
		return [];
	}

	let hits = rows
		.filter((row) => typeof row.score === 'number' && row.score >= threshold)
		.map((row) => {
			const payload = row.payload ?? {};
			const chunk = String(payload.chunk ?? '');
			return {
				id: String(row.id),
				score: row.score,
				path: String(payload.path ?? ''),
				chunk,
				filename: String(payload.filename ?? ''),
				chunkIndex: typeof payload.chunkIndex === 'number' ? payload.chunkIndex : 0,
				chunkCount: typeof payload.chunkCount === 'number' ? payload.chunkCount : undefined,
				mediaType: (payload.mediaType as MediaType) ?? 'other',
				rootIndex: typeof payload.rootIndex === 'number' ? payload.rootIndex : -1
			};
		})
		.filter((h) => h.path.length > 0 && h.chunk.length > 0);

	const hint = options?.pathContains?.trim();
	if (hint) {
		const h = hint.toLowerCase();
		const filtered = hits.filter(
			(x) => x.path.toLowerCase().includes(h) || x.filename.toLowerCase().includes(h)
		);
		if (filtered.length > 0) hits = filtered;
	}

	return hits.slice(0, limit);
}

export async function deleteSemanticEntryByRelativePath(relativePath: string): Promise<void> {
	await brain.deletePoints(collectionName(), [createPointId(relativePath)]);
}

async function toMediaFileEntry(relativePath: string): Promise<MediaEntry | null> {
	const resolved = resolveSafePath(relativePath);
	if (!resolved) return null;

	const stat = await fs.stat(resolved.fullPath);
	if (!stat.isFile()) return null;

	const { mediaType, mimeType } = getMediaInfo(resolved.fullPath);
	return {
		name: path.basename(resolved.fullPath),
		path: relativePath,
		fullPath: resolved.fullPath,
		type: 'file',
		mediaType,
		mimeType,
		size: stat.size,
		modified: stat.mtime.toISOString()
	};
}

async function walkRoot(rootPath: string, rootIndex: number, relativePrefix = ''): Promise<MediaEntry[]> {
	let dirents;
	try {
		dirents = await fs.readdir(path.join(rootPath, relativePrefix), { withFileTypes: true });
	} catch {
		return [];
	}

	const files: MediaEntry[] = [];
	for (const dirent of dirents) {
		if (dirent.name.startsWith('.')) continue;

		const nextRelative = relativePrefix ? path.join(relativePrefix, dirent.name) : dirent.name;
		const fullPath = path.join(rootPath, nextRelative);

		if (dirent.isDirectory()) {
			const nested = await walkRoot(rootPath, rootIndex, nextRelative);
			files.push(...nested);
			continue;
		}

		if (!dirent.isFile()) continue;

		const stat = await fs.stat(fullPath);
		const clientPath = `${rootIndex}/${nextRelative.split(path.sep).join('/')}`;
		const { mediaType, mimeType } = getMediaInfo(dirent.name);
		files.push({
			name: dirent.name,
			path: clientPath,
			fullPath,
			type: 'file',
			mediaType,
			mimeType,
			size: stat.size,
			modified: stat.mtime.toISOString()
		});
	}

	return files;
}

async function collectAllFiles(): Promise<MediaEntry[]> {
	const roots = getMediaRoots();
	const all: MediaEntry[] = [];

	for (let i = 0; i < roots.length; i++) {
		const files = await walkRoot(roots[i], i);
		all.push(...files);
	}

	return all;
}

function rootIndexFromPath(relativePath: string): number {
	const first = relativePath.split('/')[0];
	const parsed = Number.parseInt(first ?? '', 10);
	return Number.isNaN(parsed) ? -1 : parsed;
}

async function makePoint(entry: MediaEntry): Promise<{ point: BrainPoint; usedImageEmbedding: boolean }> {
	const metadataText = buildMetadataText(entry);
	let vector: number[];
	let usedImageEmbedding = false;

	if (isSvgFile(entry)) {
		const svgBody = await readSvgTextForEmbedding(entry);
		const textForEmbed = svgBody
			? `${metadataText}\n--- svg source ---\n${svgBody}`
			: metadataText;
		vector = (await embedText(textForEmbed)).vector;
	} else {
		vector = (await embedText(metadataText)).vector;

		if (entry.mediaType === 'image') {
			try {
				const maybeImageVector = await embedImage(entry.fullPath);
				if (maybeImageVector) {
					vector = maybeImageVector;
					usedImageEmbedding = true;
				}
			} catch (err) {
				const ext = path.extname(entry.name).toLowerCase();
				console.warn(
					'Image embedding failed, falling back to metadata embedding:',
					{
						path: entry.path,
						ext: ext || '(no ext)',
						mimeType: entry.mimeType ?? null,
						mediaType: entry.mediaType,
						sizeBytes: entry.size
					},
					err
				);
			}
		}
	}

	const point: BrainPoint = {
		id: createPointId(entry.path),
		vector,
		payload: {
			name: entry.name,
			path: entry.path,
			type: entry.type,
			mediaType: entry.mediaType ?? 'other',
			mimeType: entry.mimeType,
			size: entry.size,
			modified: entry.modified,
			rootIndex: rootIndexFromPath(entry.path)
		}
	};

	return { point, usedImageEmbedding };
}

export async function reindexSemanticCollection(): Promise<ReindexSummary> {
	const files = await collectAllFiles();
	const concurrency = resolveReindexConcurrency();
	if (files.length === 0) {
		return {
			totalFiles: 0,
			indexed: 0,
			skipped: 0,
			deleted: 0,
			imageContentEmbeddingsUsed: 0
		};
	}

	const existingIds = await brain.scrollPointIds(collectionName());

	let indexed = 0;
	let skipped = 0;
	let imageContentEmbeddingsUsed = 0;
	const newIds = new Set<string>();
	let buffer: BrainPoint[] = [];
	let ensured = false;

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency);
		const results = await Promise.allSettled(
			batch.map(async (file) => {
				const result = await makePoint(file);
				return { file, ...result };
			})
		);

		for (const [index, result] of results.entries()) {
			const file = batch[index];
			if (result.status === 'rejected') {
				skipped++;
				console.warn('Failed to index file:', file.path, result.reason);
				continue;
			}

			const { point, usedImageEmbedding } = result.value;
			if (!ensured) {
				ensured = true;
				await brain.ensureCollection(collectionName(), point.vector.length);
			}

			buffer.push(point);
			newIds.add(point.id);
			indexed++;
			if (usedImageEmbedding) imageContentEmbeddingsUsed++;
		}

		if (buffer.length >= 64) {
			await brain.upsertPoints(collectionName(), buffer);
			buffer = [];
		}
	}

	if (buffer.length > 0) {
		await brain.upsertPoints(collectionName(), buffer);
	}

	const stale = Array.from(existingIds).filter((id) => !newIds.has(id));
	await brain.deletePoints(collectionName(), stale);

	return {
		totalFiles: files.length,
		indexed,
		skipped,
		deleted: stale.length,
		imageContentEmbeddingsUsed
	};
}

export async function indexFileByRelativePath(relativePath: string): Promise<boolean> {
	const entry = await toMediaFileEntry(relativePath);
	if (!entry) return false;

	const { point } = await makePoint(entry);
	await brain.ensureCollection(collectionName(), point.vector.length);
	await brain.upsertPoints(collectionName(), [point]);
	return true;
}

export async function semanticSearch(query: string, options?: { mediaType?: MediaType; rootIndex?: number; limit?: number; minScore?: number }): Promise<SearchResult[]> {
	const vector = (await embedText(query)).vector;
	const limit = Math.max(1, Math.min(options?.limit ?? 30, 100));
	const minScore = typeof options?.minScore === 'number'
		? options?.minScore
		: Number.parseFloat(env.SEMANTIC_SEARCH_MIN_SCORE ?? '0.20');
	const threshold = Number.isFinite(minScore) ? minScore : 0.2;

	const must: Array<Record<string, unknown>> = [];
	if (options?.mediaType) {
		must.push({ key: 'mediaType', match: { value: options.mediaType } });
	}
	if (typeof options?.rootIndex === 'number') {
		must.push({ key: 'rootIndex', match: { value: options.rootIndex } });
	}

	const rows = await brain.search(collectionName(), {
		vector,
		limit,
		filter: must.length > 0 ? { must } : undefined
	});
	return rows
		.filter((row) => typeof row.score === 'number' && row.score >= threshold)
		.map((row) => {
			const payload = row.payload ?? {};
			return {
				id: String(row.id),
				score: row.score,
				name: String(payload.name ?? ''),
				path: String(payload.path ?? ''),
				type: 'file' as const,
				mediaType: (payload.mediaType as MediaType) ?? 'other',
				mimeType: payload.mimeType ? String(payload.mimeType) : undefined,
				size: typeof payload.size === 'number' ? payload.size : undefined,
				modified: payload.modified ? String(payload.modified) : undefined,
				rootIndex: typeof payload.rootIndex === 'number' ? payload.rootIndex : -1
			};
		})
		.filter((entry) => entry.path.length > 0);
}
