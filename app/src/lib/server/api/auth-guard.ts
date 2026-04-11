import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
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
