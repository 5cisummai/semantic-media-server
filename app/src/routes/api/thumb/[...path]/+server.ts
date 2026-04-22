import { error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import { requireAuth, requirePathAccess } from '$lib/server/api';
import { resolveMediaPath, getMediaInfo } from '$lib/server/services/storage';
import { getOrCreateImageThumbnail, type ThumbFit } from '$lib/server/services/thumbnail-cache';
import type { RequestHandler } from './$types';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 320;
const DEFAULT_QUALITY = 72;

const MIN_SIZE = 32;
const MAX_SIZE = 1024;
const MIN_QUALITY = 40;
const MAX_QUALITY = 90;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
	const value = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(value)) return fallback;
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

function parseFit(raw: string | null): ThumbFit {
	if (raw === 'contain' || raw === 'inside') return raw;
	return 'cover';
}

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	const user = await requireAuth(locals);
	const relativePath = params.path ?? '';
	await requirePathAccess(user, relativePath);

	const resolved = await resolveMediaPath(relativePath, user);
	if (!resolved) throw error(400, 'Invalid path');

	let stat;
	try {
		stat = await fs.stat(resolved.fullPath);
	} catch {
		throw error(404, 'File not found');
	}
	if (!stat.isFile()) throw error(400, 'Not a file');

	const { mediaType } = getMediaInfo(resolved.fullPath);
	if (mediaType !== 'image') {
		throw error(415, 'Only image files support tile thumbnails');
	}

	const width = clampInt(url.searchParams.get('w'), DEFAULT_WIDTH, MIN_SIZE, MAX_SIZE);
	const height = clampInt(url.searchParams.get('h'), DEFAULT_HEIGHT, MIN_SIZE, MAX_SIZE);
	const quality = clampInt(url.searchParams.get('q'), DEFAULT_QUALITY, MIN_QUALITY, MAX_QUALITY);
	const fit = parseFit(url.searchParams.get('fit'));

	const thumb = await getOrCreateImageThumbnail(resolved.fullPath, {
		width,
		height,
		fit,
		quality,
		sourceMtimeMs: stat.mtimeMs,
		sourceSize: stat.size,
		cacheRootPath: resolved.root
	});

	if (request.headers.get('if-none-match') === thumb.etag) {
		return new Response(null, {
			status: 304,
			headers: {
				ETag: thumb.etag,
				'Cache-Control': 'private, max-age=31536000, immutable'
			}
		});
	}

	return new Response(new Uint8Array(thumb.buffer), {
		status: 200,
		headers: {
			'Content-Type': 'image/webp',
			'Content-Length': String(thumb.buffer.length),
			'Cache-Control': 'private, max-age=31536000, immutable',
			ETag: thumb.etag,
			'X-Thumb-Cache': thumb.cacheStatus
		}
	});
};
