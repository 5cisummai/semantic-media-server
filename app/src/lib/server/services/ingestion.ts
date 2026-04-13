import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from '$lib/server/paths';
import { env } from '$env/dynamic/private';
import { brain, type BrainPoint } from '$lib/server/services/vectordb';
import { createPointId, embedText } from '$lib/server/services/embedding';
import {
	getMediaInfo,
	getMediaRoots,
	readFileContent,
	resolveSafePath,
	type MediaType
} from '$lib/server/services/storage';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const UPSERT_BATCH_SIZE = 32;
const EMBED_MAX_RETRIES = 3;
const EMBED_RETRY_DELAY_MS = 1000;

/** Embed a text chunk with retries for transient network failures. */
async function embedWithRetry(
	chunk: string,
	retries = EMBED_MAX_RETRIES
): Promise<{ vector: number[]; provider: string }> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await embedText(chunk, 'passage');
		} catch (err) {
			lastError = err;
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, EMBED_RETRY_DELAY_MS * (attempt + 1)));
			}
		}
	}
	throw lastError;
}

interface IngestCounters {
	filesScanned: number;
	filesIndexed: number;
	filesSkipped: number;
	chunksIndexed: number;
	errors: Array<{ path: string; error: string }>;
}

interface IngestFileResult {
	path: string;
	status: 'indexed' | 'skipped';
	chunksIndexed: number;
	reason?: string;
}

export interface IngestSummary extends IngestCounters {
	collection: string;
}

function collectionName(workspaceId?: string): string {
	if (workspaceId) return `ws_${workspaceId}_ingest`;
	return env.QDRANT_INGEST_COLLECTION ?? 'media_ingest';
}

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
	const normalized = text.replace(/\r\n/g, '\n').trim();
	if (!normalized) return [];

	if (normalized.length <= size) {
		return [normalized];
	}

	const chunks: string[] = [];
	let start = 0;

	while (start < normalized.length) {
		const end = Math.min(start + size, normalized.length);
		chunks.push(normalized.slice(start, end));
		if (end >= normalized.length) break;
		start = Math.max(0, end - overlap);
	}

	return chunks;
}

async function walkDirectory(relativePath: string): Promise<string[]> {
	const resolved = resolveSafePath(relativePath);
	if (!resolved) return [];

	let dirents: Dirent[];
	try {
		dirents = await fs.readdir(resolved.fullPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: string[] = [];

	for (const dirent of dirents) {
		if (dirent.name.startsWith('.')) continue;

		const child = path.join(relativePath, dirent.name);
		if (dirent.isDirectory()) {
			files.push(...(await walkDirectory(child)));
			continue;
		}

		if (!dirent.isFile()) continue;
		files.push(child);
	}

	return files;
}

async function ingestOneFile(
	relativePath: string,
	workspaceId?: string
): Promise<IngestFileResult> {
	const resolved = resolveSafePath(relativePath);
	if (!resolved) {
		return { path: relativePath, status: 'skipped', chunksIndexed: 0, reason: 'Invalid path' };
	}

	const stat = await fs.stat(resolved.fullPath);
	if (!stat.isFile()) {
		return { path: relativePath, status: 'skipped', chunksIndexed: 0, reason: 'Not a file' };
	}

	const { mediaType, mimeType } = getMediaInfo(resolved.fullPath);
	const content = await readFileContent(resolved.fullPath, mediaType);
	if (!content) {
		return {
			path: relativePath,
			status: 'skipped',
			chunksIndexed: 0,
			reason: `Unsupported or empty content for media type: ${mediaType}`
		};
	}

	const chunks = chunkText(content);
	if (chunks.length === 0) {
		return {
			path: relativePath,
			status: 'skipped',
			chunksIndexed: 0,
			reason: 'No text chunks produced'
		};
	}

	const points: BrainPoint[] = [];
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index];
		const { vector, provider } = await embedWithRetry(chunk);
		const pointId = createPointId(`${relativePath}#${index}`);
		const payload: {
			path: string;
			chunk: string;
			chunkIndex: number;
			chunkCount: number;
			filename: string;
			mediaType: MediaType;
			mimeType?: string;
			size: number;
			modified: string;
			rootIndex: number;
			provider: string;
		} = {
			path: relativePath,
			chunk,
			chunkIndex: index,
			chunkCount: chunks.length,
			filename: path.basename(resolved.fullPath),
			mediaType,
			size: stat.size,
			modified: stat.mtime.toISOString(),
			rootIndex: Number.parseInt(relativePath.split('/')[0] ?? '-1', 10),
			provider
		};
		if (mimeType) payload.mimeType = mimeType;

		points.push({ id: pointId, vector, payload });
	}

	await brain.ensureCollection(collectionName(workspaceId), points[0].vector.length);

	for (let i = 0; i < points.length; i += UPSERT_BATCH_SIZE) {
		await brain.upsertPoints(collectionName(workspaceId), points.slice(i, i + UPSERT_BATCH_SIZE));
	}

	return { path: relativePath, status: 'indexed', chunksIndexed: points.length };
}

export async function ingestFileByRelativePath(
	relativePath: string,
	workspaceId?: string
): Promise<IngestSummary> {
	const counters: IngestCounters = {
		filesScanned: 1,
		filesIndexed: 0,
		filesSkipped: 0,
		chunksIndexed: 0,
		errors: []
	};

	try {
		const result = await ingestOneFile(relativePath, workspaceId);
		if (result.status === 'indexed') {
			counters.filesIndexed++;
			counters.chunksIndexed += result.chunksIndexed;
		} else {
			counters.filesSkipped++;
		}
	} catch (err) {
		counters.filesSkipped++;
		counters.errors.push({
			path: relativePath,
			error: err instanceof Error ? err.message : 'Unknown ingestion error'
		});
	}

	return {
		collection: collectionName(workspaceId),
		...counters
	};
}

export async function ingestDirectoryByRootIndex(
	rootIndex: number,
	workspaceId?: string
): Promise<IngestSummary> {
	const roots = getMediaRoots();
	if (!Number.isInteger(rootIndex) || rootIndex < 0 || rootIndex >= roots.length) {
		throw new Error('Invalid rootIndex');
	}

	const base = `${rootIndex}`;
	const allFiles = await walkDirectory(base);
	const counters: IngestCounters = {
		filesScanned: allFiles.length,
		filesIndexed: 0,
		filesSkipped: 0,
		chunksIndexed: 0,
		errors: []
	};

	for (const [i, filePath] of allFiles.entries()) {
		if (i > 0 && i % 50 === 0) {
			console.log(`[ingest] Progress: ${i}/${allFiles.length} files (${counters.filesIndexed} indexed, ${counters.errors.length} errors)`);
		}
		try {
			const result = await ingestOneFile(filePath, workspaceId);
			if (result.status === 'indexed') {
				counters.filesIndexed++;
				counters.chunksIndexed += result.chunksIndexed;
			} else {
				counters.filesSkipped++;
			}
		} catch (err) {
			counters.filesSkipped++;
			counters.errors.push({
				path: filePath,
				error: err instanceof Error ? err.message : 'Unknown ingestion error'
			});
		}
	}

	return {
		collection: collectionName(workspaceId),
		...counters
	};
}
