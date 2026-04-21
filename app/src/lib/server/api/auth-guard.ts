import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { ensurePersonalFolderMigration, virtualRootForFolder } from '$lib/server/services/storage';
import type { UserRole } from '@prisma/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
	id: string;
	username: string;
	role: UserRole;
	approved: boolean;
}

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Re-validate user identity from the database.
 *
 * Why: locals.user comes from the JWT, which can be stale (role changed,
 * user deleted, user soft-deleted, approval revoked). For any operation
 * that reads or mutates data, we must confirm the user still exists and
 * is in good standing.
 *
 * This is the single source of truth for "who is making this request."
 */
export async function requireAuth(locals: App.Locals): Promise<AuthenticatedUser> {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const user = await db.user.findUnique({
		where: { id: locals.user.id },
		select: { id: true, username: true, role: true, approved: true, deletedAt: true }
	});

	// Uniform 401 — don't reveal whether user was deleted/deactivated/never existed
	if (!user || user.deletedAt !== null || !user.approved) {
		throw error(401, 'Authentication required');
	}

	return { id: user.id, username: user.username, role: user.role, approved: user.approved };
}

/**
 * Require authenticated user with ADMIN role, re-validated from DB.
 *
 * Prevents privilege escalation from stale JWTs: even if a token says
 * role=ADMIN, we confirm it against the current DB state.
 */
export async function requireAdmin(locals: App.Locals): Promise<AuthenticatedUser> {
	const user = await requireAuth(locals);

	if (user.role !== 'ADMIN') {
		// Don't differentiate "not admin" from "not authorized" to avoid role enumeration
		throw error(403, 'Insufficient permissions');
	}

	return user;
}

// ── Personal folder access ────────────────────────────────────────────────────

/**
 * Enforce that the requesting user can access the given relative path.
 *
 * Paths that live inside another user's personal folder are blocked with 403.
 * Admins bypass this check entirely.
 */
export async function requirePathAccess(
	user: AuthenticatedUser,
	relativePath: string
): Promise<void> {
	await ensurePersonalFolderMigration();

	if (user.role === 'ADMIN') return;

	const normalized = relativePath.replace(/^\/+/, '');

	// Block direct access to another user's hidden physical personal directory
	const hidden = normalized.match(/^\d+\/\.personal_([^/]+)(?:\/|$)/);
	if (hidden) {
		const ownerUsername = hidden[1];
		if (ownerUsername !== user.username) {
			throw error(403, 'Access denied');
		}
		return;
	}

	// Targeted lookup by first path segment (post-migration virtual root == username)
	const firstSegment = normalized.split('/')[0];
	if (firstSegment) {
		const folder = await db.personalFolder.findFirst({
			where: { user: { username: firstSegment } },
			include: { user: { select: { username: true } } }
		});
		if (folder) {
			const folderPath = virtualRootForFolder(folder);
			const isInside = normalized === folderPath || normalized.startsWith(`${folderPath}/`);
			if (isInside && folder.userId !== user.id) {
				throw error(403, 'Access denied');
			}
		}
	}

	// Legacy DB paths (`0/<name>`) — check by exact path prefix
	const legacyPrefix = normalized.split('/').slice(0, 2).join('/');
	if (legacyPrefix.includes('/')) {
		const legacyFolder = await db.personalFolder.findFirst({
			where: { path: legacyPrefix },
			include: { user: { select: { username: true } } }
		});
		if (legacyFolder && legacyFolder.userId !== user.id) {
			const insideLegacy =
				normalized === legacyFolder.path || normalized.startsWith(`${legacyFolder.path}/`);
			if (insideLegacy) {
				throw error(403, 'Access denied');
			}
		}
	}
}

/**
 * Filter a list of path entries, removing personal folders that belong to
 * other users. Admins see everything.
 */
export async function filterPersonalEntries<T extends { path: string }>(
	user: AuthenticatedUser,
	entries: T[]
): Promise<T[]> {
	await ensurePersonalFolderMigration();

	if (user.role === 'ADMIN') return entries;

	// Only load folders belonging to *other* users — avoids returning own folder in blocked list
	const otherFolders = await db.personalFolder.findMany({
		where: { userId: { not: user.id } },
		include: { user: { select: { username: true } } }
	});

	const blockedPrefixes = otherFolders.flatMap((f) => {
		const roots = [virtualRootForFolder(f)];
		if (f.path.includes('/')) roots.push(f.path);
		return roots;
	});

	return entries.filter((entry) => {
		const p = entry.path.replace(/^\/+/, '');
		return !blockedPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
	});
}
