import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { resolveMediaPath } from '$lib/server/services/storage';
import { deleteSemanticEntryByRelativePath } from '$lib/server/semantic';
import { db } from '$lib/server/db';
import { requireAuth, requirePathAccess, audit } from '$lib/server/api';
import { requireMembership } from '$lib/server/services/workspace';
import { moveToTrash } from '$lib/server/trash';
import { recordAction, FsOperation } from '$lib/server/fs-history';
import type { RequestHandler } from './$types';

async function collectNestedFilePaths(fullPath: string, relativePath: string): Promise<string[]> {
	const stat = await fs.stat(fullPath);
	if (stat.isFile()) return [relativePath];
	if (!stat.isDirectory()) return [];

	const dirents = await fs.readdir(fullPath, { withFileTypes: true });
	const nestedPaths = await Promise.all(
		dirents.map(async (dirent) => {
			const childFullPath = path.join(fullPath, dirent.name);
			const childRelativePath = path.join(relativePath, dirent.name);
			return collectNestedFilePaths(childFullPath, childRelativePath);
		})
	);

	return nestedPaths.flat();
}

export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	// Re-validate user from DB (not just JWT claims)
	const user = await requireAuth(locals);

	const relativePath = params.path ?? '';
	await requirePathAccess(user, relativePath);
	const resolved = await resolveMediaPath(relativePath, user);
	if (!resolved) throw error(400, 'Invalid path');

	if (path.resolve(resolved.fullPath) === path.resolve(resolved.root)) {
		throw error(403, 'Deleting a media root is not allowed');
	}

	// Prevent deleting a personal folder root (even your own)
	const personalFolder = await db.personalFolder.findUnique({ where: { path: relativePath } });
	if (personalFolder) {
		throw error(403, 'Personal folders cannot be deleted');
	}

	let stat;
	try {
		stat = await fs.stat(resolved.fullPath);
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(404, 'Path not found');
		}
		throw err;
	}

	if (!stat.isFile() && !stat.isDirectory()) {
		throw error(400, 'Only files and folders can be deleted');
	}

	// Use DB-fresh role, not JWT role
	const isAdmin = user.role === 'ADMIN';

	if (!isAdmin) {
		if (stat.isDirectory()) {
			throw error(403, 'Only admins can delete directories');
		}

		const owned = await db.uploadedFile.findUnique({
			where: { relativePath },
			select: { uploadedById: true }
		});

		if (!owned || owned.uploadedById !== user.id) {
			throw error(403, 'You can only delete files you uploaded');
		}
	}

	const semanticPaths = await collectNestedFilePaths(resolved.fullPath, relativePath);

	// Workspace context from header — verify membership before stamping history
	const rawWorkspaceId = request.headers.get('X-Workspace-Id') ?? null;
	let workspaceId: string | null = null;
	if (rawWorkspaceId) {
		try {
			await requireMembership(rawWorkspaceId, user.id, 'MEMBER');
			workspaceId = rawWorkspaceId;
		} catch {
			// Not a member — ignore the header
		}
	}
	const trashKey = randomUUID();

	try {
		await moveToTrash(resolved.fullPath, trashKey);
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(404, 'Path not found');
		}
		throw err;
	}

	if (semanticPaths.length > 0) {
		await db.uploadedFile.deleteMany({
			where: { relativePath: { in: semanticPaths } }
		});
	}

	const semanticDeletes = await Promise.allSettled(
		semanticPaths.map(async (semanticPath) => {
			await deleteSemanticEntryByRelativePath(semanticPath);
			return semanticPath;
		})
	);

	for (const [index, result] of semanticDeletes.entries()) {
		if (result.status === 'rejected') {
			console.warn('Failed to delete semantic index entry:', semanticPaths[index], result.reason);
		}
	}

	// Record history action
	await recordAction({
		userId: user.id,
		workspaceId: workspaceId ?? null,
		operation: FsOperation.DELETE,
		payload: { relativePath, trashKey, root: resolved.root },
		description: `Deleted ${relativePath}`
	});

	// Audit log for all file/directory deletions
	await audit({
		action: stat.isDirectory() ? 'DIRECTORY_DELETED' : 'FILE_DELETED',
		actorId: user.id,
		targetId: relativePath,
		metadata: {
			fileCount: semanticPaths.length,
			isAdmin,
			paths: semanticPaths.slice(0, 50) // Cap logged paths to prevent log bloat
		}
	});

	return json({ success: true });
};
