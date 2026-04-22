import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import busboy from 'busboy';
import * as path from '$lib/server/paths';
import { isPathInsideRoot, resolveMediaPath } from '$lib/server/services/storage';
import { requireAuth, requirePathAccess } from '$lib/server/api';
import { requireMembership } from '$lib/server/services/workspace';
import { db } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { recordAction, FsOperation } from '$lib/server/fs-history';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const user = await requireAuth(locals);

	const maxUploadSize = parseInt(env.MAX_UPLOAD_SIZE ?? '10737418240', 10);
	const contentLength = request.headers.get('content-length');

	if (contentLength && parseInt(contentLength, 10) > maxUploadSize) {
		throw error(413, 'File too large');
	}

	const nodeReq = platform?.req;
	// adapter-node passes `platform.req` in production; Vite dev does not, but the
	// same multipart body is available on the Fetch API `request.body` stream.
	if (!nodeReq && !request.body) {
		throw error(500, 'Streaming upload not supported in this environment');
	}

	// Parse multipart in two passes:
	// 1) Stream the file part directly to a temp file (no memory buffering)
	// 2) After all parts parsed, validate access and move to final destination
	const tmpPath = path.join(tmpdir(), randomUUID());

	const { fields, filename } = await new Promise<{
		fields: Map<string, string>;
		filename: string | null;
	}>((resolve, reject) => {
		const bb = busboy({
			headers: Object.fromEntries(request.headers.entries()),
			limits: { fileSize: maxUploadSize }
		});

		const fields = new Map<string, string>();
		let filename: string | null = null;
		let fileReceived = false;
		let fileTooLarge = false;

		bb.on('field', (name, value) => {
			fields.set(name, value);
		});

		bb.on('file', (fieldname, fileStream, info) => {
			if (fieldname !== 'file' || fileReceived) {
				fileStream.resume();
				return;
			}
			fileReceived = true;
			filename = info.filename ?? null;

			const writer = createWriteStream(tmpPath);
			fileStream.on('limit', () => {
				fileTooLarge = true;
				writer.destroy();
			});
			fileStream.pipe(writer);
			writer.on('error', (err) => reject(err));
			fileStream.on('error', (err) => reject(err));
		});

		bb.on('finish', () => {
			if (fileTooLarge) {
				reject(Object.assign(new Error('File too large'), { code: 413 }));
			} else {
				resolve({ fields, filename });
			}
		});

		bb.on('error', (err) => reject(err));
		if (nodeReq) {
			nodeReq.pipe(bb);
		} else if (request.body) {
			Readable.fromWeb(request.body as NodeReadableStream).pipe(bb);
		} else {
			reject(new Error('Missing request body'));
		}
	}).catch(async (err) => {
		await fs.unlink(tmpPath).catch(() => undefined);
		throw err instanceof Error && 'code' in err && err.code === 413
			? error(413, 'File too large')
			: error(500, err instanceof Error ? err.message : 'Upload failed');
	});

	const destination = fields.get('destination') ?? null;
	const rawWorkspaceId = fields.get('workspaceId') ?? null;

	if (!filename) {
		await fs.unlink(tmpPath).catch(() => undefined);
		throw error(400, 'No file provided');
	}
	if (!destination) {
		await fs.unlink(tmpPath).catch(() => undefined);
		throw error(400, 'No destination provided');
	}

	try {
		await requirePathAccess(user, destination);

		const resolved = await resolveMediaPath(destination, user);
		if (!resolved) throw error(400, 'Invalid destination path');

		// Sanitize filename — strip path separators, null bytes
		const safeName = path.basename(filename).replace(/[/\\]/g, '').replace(/\0/g, '');
		if (!safeName) throw error(400, 'Invalid filename');

		const destPath = path.resolve(resolved.fullPath, safeName);
		if (!isPathInsideRoot(destPath, resolved.root)) {
			throw error(400, 'Invalid destination');
		}

		await fs.mkdir(resolved.fullPath, { recursive: true });

		// Move from temp to final location; fall back to copy+delete on cross-device moves
		try {
			await fs.rename(tmpPath, destPath);
		} catch (renameErr) {
			if (renameErr instanceof Error && (renameErr as NodeJS.ErrnoException).code === 'EXDEV') {
				await fs.copyFile(tmpPath, destPath);
				await fs.unlink(tmpPath).catch(() => undefined);
			} else {
				throw renameErr;
			}
		}

		const relativePath = path.join(destination, safeName);

		await db.uploadedFile.upsert({
			where: { relativePath },
			create: { relativePath, uploadedById: user.id },
			update: { uploadedById: user.id, uploadedAt: new Date() }
		});

		let workspaceId: string | null = null;
		if (rawWorkspaceId) {
			try {
				await requireMembership(rawWorkspaceId, user.id, 'MEMBER');
				workspaceId = rawWorkspaceId;
			} catch {
				// Not a member — ignore the supplied workspace ID
			}
		}

		await recordAction({
			userId: user.id,
			workspaceId,
			operation: FsOperation.UPLOAD,
			payload: { relativePath },
			description: `Uploaded ${relativePath}`
		});

		return json({ success: true, name: safeName, relativePath });
	} catch (err) {
		await fs.unlink(tmpPath).catch(() => undefined);
		throw err;
	}
};
