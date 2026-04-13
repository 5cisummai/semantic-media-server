import { json, error } from '@sveltejs/kit';
import { verifyJwt, generateAccessToken } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { checkRateLimit, REFRESH_RATE_LIMIT } from '$lib/server/api';
import type { RequestHandler } from './$types';

const refreshCookieDeleteOpts = {
	path: '/',
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const
};

export const POST: RequestHandler = async ({ cookies, getClientAddress }) => {
	const clientIp = getClientAddress();
	checkRateLimit('refresh', clientIp, REFRESH_RATE_LIMIT);

	const refreshToken = cookies.get('refreshToken');

	if (!refreshToken) {
		throw error(401, 'No refresh token');
	}

	const payload = verifyJwt(refreshToken);
	if (!payload || payload.type !== 'refresh') {
		throw error(401, 'Invalid refresh token');
	}

	// CRITICAL: Re-validate user from DB before minting a new access token.
	// Without this check, a deleted/banned/demoted user with an unexpired
	// refresh token can keep generating valid access tokens.
	const user = await db.user.findUnique({
		where: { id: payload.sub },
		select: { id: true, username: true, role: true, approved: true, deletedAt: true }
	});

	if (!user || user.deletedAt !== null || !user.approved) {
		// Clear the stale refresh cookie
		cookies.delete('refreshToken', refreshCookieDeleteOpts);
		throw error(401, 'Invalid refresh token');
	}

	// Use fresh DB values — not stale JWT claims — for the new access token
	const newAccessToken = generateAccessToken({
		sub: user.id,
		username: user.username,
		role: user.role
	});

	return json({ accessToken: newAccessToken });
};
