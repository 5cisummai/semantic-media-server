import { verifyJwt } from '$lib/server/auth';
import { db } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';
import type { UserRole } from '@prisma/client';

const refreshCookieDeleteOpts = {
	path: '/',
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const
};

// Short-lived cache for user DB validation (avoids a DB hit on every request)
const USER_CACHE_TTL_MS = 30_000; // 30 seconds
type CachedUser = { role: UserRole; approved: boolean; deletedAt: Date | null; cachedAt: number };
const userValidationCache = new Map<string, CachedUser>();

function getCachedUser(userId: string): CachedUser | null {
	const entry = userValidationCache.get(userId);
	if (!entry) return null;
	if (Date.now() - entry.cachedAt > USER_CACHE_TTL_MS) {
		userValidationCache.delete(userId);
		return null;
	}
	return entry;
}

/** Call when a user is mutated (role change, deletion, approval change) to bust the cache. */
export function invalidateUserCache(userId: string): void {
	userValidationCache.delete(userId);
}

// Routes accessible without a valid JWT
const PUBLIC_PATHS = [
	'/login',
	'/signup',
	'/api/auth/login',
	'/api/auth/signup',
	'/api/auth/logout'
];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Extract Bearer token from Authorization header (set by handleFetch on client)
	const authHeader = event.request.headers.get('Authorization');
	const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

	if (bearerToken) {
		const payload = verifyJwt(bearerToken);
		if (payload && payload.type !== 'refresh') {
			event.locals.user = { id: payload.sub, username: payload.username, role: payload.role };
		}
	}

	// If no access token in header but refresh token exists, try to issue a new access token
	if (!event.locals.user) {
		const refreshToken = event.cookies.get('refreshToken');
		if (refreshToken) {
			const payload = verifyJwt(refreshToken);
			if (payload && payload.type === 'refresh') {
				event.locals.user = { id: payload.sub, username: payload.username, role: payload.role };
			}
		}
	}

	// Validate user still exists, is not soft-deleted, and is approved.
	// Uses a short-lived cache to avoid hitting the DB on every request.
	if (event.locals.user) {
		const userId = event.locals.user.id;
		let cached = getCachedUser(userId);
		if (!cached) {
			const row = await db.user.findUnique({
				where: { id: userId },
				select: { id: true, role: true, approved: true, deletedAt: true }
			});
			if (row) {
				cached = { role: row.role, approved: row.approved, deletedAt: row.deletedAt, cachedAt: Date.now() };
				userValidationCache.set(userId, cached);
			}
		}
		if (!cached || cached.deletedAt !== null || !cached.approved) {
			event.locals.user = undefined;
			event.cookies.delete('refreshToken', refreshCookieDeleteOpts);
		} else {
			event.locals.user.role = cached.role;
		}
	}

	// Allow public paths without authentication
	const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));

	if (!isPublic && !event.locals.user) {
		// API routes get a 401 JSON response; page routes get a redirect
		if (path.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response(null, {
			status: 302,
			headers: { Location: `/login?next=${encodeURIComponent(path)}` }
		});
	}

	return resolve(event);
};
