// ---------------------------------------------------------------------------
// fs-history.ts — Undo/redo service for filesystem mutations
//
// Google Docs–style: shared workspace history, but each user can only
// undo/redo their own most recent action.
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import { db } from '$lib/server/db';
import { FsOperation, FsActionStatus } from '@prisma/client';
import { restoreFromTrash, cleanTrashEntry } from '$lib/server/trash';
import { resolveMediaPathForUserId } from '$lib/server/services/storage';

export { FsOperation, FsActionStatus };

export const HISTORY_LIMIT = 50;

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface DeletePayload {
	relativePath: string;
	trashKey: string; // = action ID
	root: string; // absolute path to media root (for trash restore)
}

export interface MovePayload {
	from: string;
	to: string;
}

export interface CopyPayload {
	destination: string;
}

export interface MkdirPayload {
	path: string;
}

export interface UploadPayload {
	relativePath: string;
}

export type FsPayload = DeletePayload | MovePayload | CopyPayload | MkdirPayload | UploadPayload;

// ---------------------------------------------------------------------------
// recordAction
// ---------------------------------------------------------------------------

export interface RecordActionParams {
	userId: string;
	workspaceId?: string | null;
	operation: FsOperation;
	payload: FsPayload;
	description: string;
}

export async function recordAction(params: RecordActionParams) {
	const { userId, workspaceId, operation, payload, description } = params;

	const action = await db.fileSystemAction.create({
		data: {
			userId,
			workspaceId: workspaceId ?? null,
			operation,
			payload: payload as object,
			description,
			status: FsActionStatus.DONE
		}
	});

	// Prune after recording
	await pruneHistory(workspaceId ?? null);

	return action;
}

// ---------------------------------------------------------------------------
// undoUserAction
// ---------------------------------------------------------------------------

export async function undoUserAction(userId: string, workspaceId?: string | null) {
	// Find this user's most recent DONE action in the workspace
	const action = await db.fileSystemAction.findFirst({
		where: {
			userId,
			workspaceId: workspaceId ?? null,
			status: FsActionStatus.DONE
		},
		orderBy: { createdAt: 'desc' }
	});

	if (!action) return null;

	const payload = action.payload as unknown as FsPayload;

	switch (action.operation) {
		case FsOperation.DELETE: {
			const p = payload as DeletePayload;
			const resolved = await resolveMediaPathForUserId(p.relativePath, userId);
			if (!resolved) throw new Error(`Invalid path: ${p.relativePath}`);
			await restoreFromTrash(p.trashKey, resolved.fullPath, p.root);
			// Restore UploadedFile DB record if it existed
			await db.uploadedFile
				.upsert({
					where: { relativePath: p.relativePath },
					create: { relativePath: p.relativePath, uploadedById: userId },
					update: {}
				})
				.catch(() => undefined);
			break;
		}
		case FsOperation.MOVE: {
			const p = payload as MovePayload;
			const srcRes = await resolveMediaPathForUserId(p.to, userId);
			const dstRes = await resolveMediaPathForUserId(p.from, userId);
			if (!srcRes || !dstRes) throw new Error('Invalid move paths');
			await fs.rename(srcRes.fullPath, dstRes.fullPath);
			// Update UploadedFile records
			await db.uploadedFile
				.updateMany({
					where: { relativePath: p.to },
					data: { relativePath: p.from }
				})
				.catch(() => undefined);
			break;
		}
		case FsOperation.COPY: {
			const p = payload as CopyPayload;
			const resolved = await resolveMediaPathForUserId(p.destination, userId);
			if (!resolved) throw new Error(`Invalid path: ${p.destination}`);
			const stat = await fs.stat(resolved.fullPath);
			if (stat.isDirectory()) {
				await fs.rm(resolved.fullPath, { recursive: true });
			} else {
				await fs.unlink(resolved.fullPath);
			}
			await db.uploadedFile
				.deleteMany({ where: { relativePath: p.destination } })
				.catch(() => undefined);
			break;
		}
		case FsOperation.MKDIR: {
			const p = payload as MkdirPayload;
			const resolved = await resolveMediaPathForUserId(p.path, userId);
			if (!resolved) throw new Error(`Invalid path: ${p.path}`);
			try {
				await fs.rmdir(resolved.fullPath);
			} catch (err) {
				if (
					err instanceof Error &&
					'code' in err &&
					(err as NodeJS.ErrnoException).code === 'ENOTEMPTY'
				) {
					throw new Error(
						`Cannot undo mkdir: directory "${p.path}" is not empty. Move or delete its contents first.`,
						{ cause: err }
					);
				}
				throw err;
			}
			break;
		}
		case FsOperation.UPLOAD: {
			const p = payload as UploadPayload;
			const resolved = await resolveMediaPathForUserId(p.relativePath, userId);
			if (!resolved) throw new Error(`Invalid path: ${p.relativePath}`);
			await fs.unlink(resolved.fullPath);
			await db.uploadedFile
				.deleteMany({ where: { relativePath: p.relativePath } })
				.catch(() => undefined);
			break;
		}
	}

	// Mark as UNDONE
	await db.fileSystemAction.update({
		where: { id: action.id },
		data: { status: FsActionStatus.UNDONE }
	});

	return action;
}

// ---------------------------------------------------------------------------
// redoUserAction
// ---------------------------------------------------------------------------

export async function redoUserAction(userId: string, workspaceId?: string | null) {
	// Find this user's most recent UNDONE action in the workspace
	const action = await db.fileSystemAction.findFirst({
		where: {
			userId,
			workspaceId: workspaceId ?? null,
			status: FsActionStatus.UNDONE
		},
		orderBy: { createdAt: 'desc' }
	});

	if (!action) return null;

	const payload = action.payload as unknown as FsPayload;

	switch (action.operation) {
		case FsOperation.DELETE: {
			const p = payload as DeletePayload;
			const resolved = await resolveMediaPathForUserId(p.relativePath, userId);
			if (!resolved) throw new Error(`Invalid path: ${p.relativePath}`);
			// Re-delete: move back to trash
			const { moveToTrash } = await import('$lib/server/trash');
			await moveToTrash(resolved.fullPath, p.trashKey);
			await db.uploadedFile
				.deleteMany({ where: { relativePath: p.relativePath } })
				.catch(() => undefined);
			break;
		}
		case FsOperation.MOVE: {
			const p = payload as MovePayload;
			const srcRes = await resolveMediaPathForUserId(p.from, userId);
			const dstRes = await resolveMediaPathForUserId(p.to, userId);
			if (!srcRes || !dstRes) throw new Error('Invalid move paths');
			await fs.rename(srcRes.fullPath, dstRes.fullPath);
			await db.uploadedFile
				.updateMany({ where: { relativePath: p.from }, data: { relativePath: p.to } })
				.catch(() => undefined);
			break;
		}
		case FsOperation.COPY: {
			const p = payload as CopyPayload;
			// Source bytes are gone — we only stored the destination, not the source.
			// Redo is not possible. Return null so the caller can report this clearly.
			void p;
			return null;
		}
		case FsOperation.MKDIR: {
			const p = payload as MkdirPayload;
			const resolved = await resolveMediaPathForUserId(p.path, userId);
			if (!resolved) throw new Error(`Invalid path: ${p.path}`);
			await fs.mkdir(resolved.fullPath);
			break;
		}
		case FsOperation.UPLOAD: {
			// File bytes are gone — redo is not possible. Return null to report clearly.
			return null;
		}
	}

	// Mark as DONE again
	await db.fileSystemAction.update({
		where: { id: action.id },
		data: { status: FsActionStatus.DONE }
	});

	return action;
}

// ---------------------------------------------------------------------------
// listHistory
// ---------------------------------------------------------------------------

export async function listHistory(workspaceId: string | null, limit = 20) {
	return db.fileSystemAction.findMany({
		where: { workspaceId: workspaceId ?? null },
		orderBy: { createdAt: 'desc' },
		take: limit,
		select: {
			id: true,
			userId: true,
			operation: true,
			status: true,
			description: true,
			createdAt: true,
			user: { select: { displayName: true, username: true } }
		}
	});
}

// ---------------------------------------------------------------------------
// pruneHistory — keep only the 50 most recent DONE actions per workspace
// ---------------------------------------------------------------------------

export async function pruneHistory(workspaceId: string | null) {
	// Count total actions
	const count = await db.fileSystemAction.count({
		where: { workspaceId: workspaceId ?? null }
	});

	if (count <= HISTORY_LIMIT) return;

	// Find IDs to delete (oldest beyond the limit)
	const toKeep = await db.fileSystemAction.findMany({
		where: { workspaceId: workspaceId ?? null },
		orderBy: { createdAt: 'desc' },
		take: HISTORY_LIMIT,
		select: { id: true }
	});

	const keepIds = toKeep.map((a) => a.id);

	// Find the ones to delete and clean trash entries for DELETE operations
	const toDelete = await db.fileSystemAction.findMany({
		where: {
			workspaceId: workspaceId ?? null,
			id: { notIn: keepIds }
		},
		select: { id: true, operation: true, payload: true }
	});

	for (const action of toDelete) {
		if (action.operation === FsOperation.DELETE) {
			const p = action.payload as unknown as DeletePayload;
			await cleanTrashEntry(p.trashKey, p.root).catch(() => undefined);
		}
	}

	await db.fileSystemAction.deleteMany({
		where: {
			workspaceId: workspaceId ?? null,
			id: { notIn: keepIds }
		}
	});
}
