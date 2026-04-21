import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '$env/dynamic/private';

export type ThumbFit = 'cover' | 'contain' | 'inside';

export type ThumbnailOptions = {
	width: number;
	height: number;
	fit: ThumbFit;
	quality: number;
	sourceMtimeMs: number;
	sourceSize: number;
};

export type ThumbnailResult = {
	buffer: Buffer;
	cacheStatus: 'memory-hit' | 'disk-hit' | 'generated';
	etag: string;
};

const DEFAULT_MEMORY_CACHE_BYTES = 128 * 1024 * 1024;
const DEFAULT_DISK_CACHE_BYTES = 512 * 1024 * 1024;
const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), '.cache/thumbs');

const memoryCacheMaxBytes = readPositiveInt(
	env.THUMB_MEMORY_CACHE_MAX_BYTES,
	DEFAULT_MEMORY_CACHE_BYTES
);
const diskCacheMaxBytes = readPositiveInt(env.THUMB_DISK_CACHE_MAX_BYTES, DEFAULT_DISK_CACHE_BYTES);
const diskCacheDir = env.THUMB_CACHE_DIR?.trim()
	? path.resolve(env.THUMB_CACHE_DIR.trim())
	: DEFAULT_CACHE_DIR;

const memoryCache = new Map<string, Buffer>();
let memoryCacheBytes = 0;

const inFlight = new Map<string, Promise<Buffer>>();
let diskInitPromise: Promise<void> | null = null;

function readPositiveInt(raw: string | undefined, fallback: number): number {
	const value = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(value) || value < 0) return fallback;
	return value;
}

function makeCacheKey(filePath: string, options: ThumbnailOptions): string {
	return JSON.stringify({
		filePath,
		m: Math.floor(options.sourceMtimeMs),
		s: options.sourceSize,
		w: options.width,
		h: options.height,
		f: options.fit,
		q: options.quality
	});
}

function hashKey(key: string): string {
	return crypto.createHash('sha256').update(key).digest('hex');
}

function toEtag(cacheKey: string): string {
	return `"thumb-${hashKey(cacheKey).slice(0, 24)}"`;
}

function pushMemoryCache(cacheKey: string, buffer: Buffer): void {
	if (memoryCacheMaxBytes <= 0) return;
	const existing = memoryCache.get(cacheKey);
	if (existing) {
		memoryCacheBytes -= existing.length;
		memoryCache.delete(cacheKey);
	}
	memoryCache.set(cacheKey, buffer);
	memoryCacheBytes += buffer.length;

	while (memoryCacheBytes > memoryCacheMaxBytes && memoryCache.size > 0) {
		const oldestKey = memoryCache.keys().next().value as string | undefined;
		if (!oldestKey) break;
		const oldest = memoryCache.get(oldestKey);
		memoryCache.delete(oldestKey);
		if (oldest) memoryCacheBytes -= oldest.length;
	}
}

function readMemoryCache(cacheKey: string): Buffer | null {
	const hit = memoryCache.get(cacheKey);
	if (!hit) return null;
	memoryCache.delete(cacheKey);
	memoryCache.set(cacheKey, hit);
	return hit;
}

function cacheFilePath(cacheKey: string): string {
	const digest = hashKey(cacheKey);
	return path.join(diskCacheDir, digest.slice(0, 2), `${digest}.webp`);
}

async function ensureDiskCacheDir(): Promise<void> {
	if (diskCacheMaxBytes <= 0) return;
	if (!diskInitPromise) {
		diskInitPromise = fs.mkdir(diskCacheDir, { recursive: true }).then(() => undefined);
	}
	await diskInitPromise;
}

async function readDiskCache(cacheKey: string): Promise<Buffer | null> {
	if (diskCacheMaxBytes <= 0) return null;
	await ensureDiskCacheDir();

	const filePath = cacheFilePath(cacheKey);
	try {
		const data = await fs.readFile(filePath);
		const now = new Date();
		await fs.utimes(filePath, now, now).catch(() => {});
		return data;
	} catch {
		return null;
	}
}

async function writeDiskCache(cacheKey: string, buffer: Buffer): Promise<void> {
	if (diskCacheMaxBytes <= 0) return;
	await ensureDiskCacheDir();

	const filePath = cacheFilePath(cacheKey);
	const parent = path.dirname(filePath);
	await fs.mkdir(parent, { recursive: true });
	await fs.writeFile(filePath, buffer);
	await pruneDiskCache();
}

type FileStat = { path: string; size: number; mtimeMs: number };

async function collectCacheFiles(dir: string): Promise<FileStat[]> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const collected: FileStat[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collected.push(...(await collectCacheFiles(fullPath)));
			continue;
		}
		if (!entry.isFile()) continue;
		try {
			const stat = await fs.stat(fullPath);
			collected.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
		} catch {
			// Ignore races from concurrent writes/deletes.
		}
	}
	return collected;
}

async function pruneDiskCache(): Promise<void> {
	if (diskCacheMaxBytes <= 0) return;
	const files = await collectCacheFiles(diskCacheDir);
	let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
	if (totalBytes <= diskCacheMaxBytes) return;

	files.sort((a, b) => a.mtimeMs - b.mtimeMs);
	for (const file of files) {
		if (totalBytes <= diskCacheMaxBytes) break;
		try {
			await fs.unlink(file.path);
			totalBytes -= file.size;
		} catch {
			// Ignore races from parallel prune attempts.
		}
	}
}

async function generateThumbnailBuffer(
	sourcePath: string,
	options: ThumbnailOptions
): Promise<Buffer> {
	return sharp(sourcePath, { failOn: 'none', animated: false })
		.rotate()
		.resize(options.width, options.height, {
			fit: options.fit,
			withoutEnlargement: true
		})
		.webp({
			quality: options.quality,
			effort: 4
		})
		.toBuffer();
}

export async function getOrCreateImageThumbnail(
	sourcePath: string,
	options: ThumbnailOptions
): Promise<ThumbnailResult> {
	const cacheKey = makeCacheKey(sourcePath, options);
	const etag = toEtag(cacheKey);

	const memoryHit = readMemoryCache(cacheKey);
	if (memoryHit) {
		return { buffer: memoryHit, cacheStatus: 'memory-hit', etag };
	}

	const diskHit = await readDiskCache(cacheKey);
	if (diskHit) {
		pushMemoryCache(cacheKey, diskHit);
		return { buffer: diskHit, cacheStatus: 'disk-hit', etag };
	}

	let pending = inFlight.get(cacheKey);
	if (!pending) {
		pending = generateThumbnailBuffer(sourcePath, options).finally(() => {
			inFlight.delete(cacheKey);
		});
		inFlight.set(cacheKey, pending);
	}
	const generated = await pending;
	pushMemoryCache(cacheKey, generated);
	await writeDiskCache(cacheKey, generated);

	return { buffer: generated, cacheStatus: 'generated', etag };
}
