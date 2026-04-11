import { verifyJwt } from '$lib/server/auth';
import { db } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';

const refreshCookieDeleteOpts = {
	path: '/',
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const
};

// Routes accessible without a valid JWT
const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/logout'];

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
	// This catches: deleted users, rejected users, revoked accounts, DB resets.
	if (event.locals.user) {
		const row = await db.user.findUnique({
			where: { id: event.locals.user.id },
			select: { id: true, role: true, approved: true, deletedAt: true }
		});
		if (!row || row.deletedAt !== null || !row.approved) {
			event.locals.user = undefined;
			event.cookies.delete('refreshToken', refreshCookieDeleteOpts);
		} else {
			// Refresh role from DB so locals.user always has the current role.
			// This reduces (but does not eliminate) stale-role windows.
			event.locals.user.role = row.role;
		}
	}

	// Allow public paths without authentication
	const isPublic = PUBLIC_PATHS.some(
		(p) => path === p || path.startsWith(p + '/')
	);

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
