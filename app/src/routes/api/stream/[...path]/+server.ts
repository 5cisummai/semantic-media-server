import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { requireAuth } from '$lib/server/api';
import { resolveSafePath, getMediaInfo } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request, locals }) => {
	await requireAuth(locals);
	const resolved = resolveSafePath(params.path ?? '');
	if (!resolved) throw error(400, 'Invalid path');

	let stat;
	try {
		stat = await fsp.stat(resolved.fullPath);
	} catch {
		throw error(404, 'File not found');
	}

	if (!stat.isFile()) throw error(400, 'Not a file');

	const { mimeType } = getMediaInfo(resolved.fullPath);
	const fileSize = stat.size;
	const rangeHeader = request.headers.get('range');

	// Range request — needed for video/audio seeking
	if (rangeHeader) {
		const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
		const start = parseInt(startStr, 10);
		const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);

		if (start >= fileSize || end >= fileSize || start > end) {
			throw error(416, 'Range not satisfiable');
		}

		const chunkSize = end - start + 1;
		const stream = fs.createReadStream(resolved.fullPath, { start, end });

		return new Response(stream as unknown as ReadableStream, {
			status: 206,
			headers: {
				'Content-Type': mimeType,
				'Content-Range': `bytes ${start}-${end}/${fileSize}`,
				'Accept-Ranges': 'bytes',
				'Content-Length': String(chunkSize),
				'Cache-Control': 'no-store'
			}
		});
	}

	// Full file response
	const stream = fs.createReadStream(resolved.fullPath);
	return new Response(stream as unknown as ReadableStream, {
		status: 200,
		headers: {
			'Content-Type': mimeType,
			'Content-Length': String(fileSize),
			'Accept-Ranges': 'bytes',
			'Cache-Control': 'no-store'
		}
	});
};
