import { json, error } from '@sveltejs/kit';
import { findUserByUsername, verifyPassword, generateAccessToken, generateRefreshToken } from '$lib/server/auth';
import { parseBody, loginSchema, audit, checkRateLimit, LOGIN_RATE_LIMIT } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const clientIp = getClientAddress();
	checkRateLimit('login', clientIp, LOGIN_RATE_LIMIT);

	// Zod validation replaces manual type checks
	const { username, password } = await parseBody(request, loginSchema);

	const normalizedUsername = username.trim().toLowerCase();
	const user = await findUserByUsername(normalizedUsername);

	if (!user || user.deletedAt !== null) {
		// Constant-time stub to prevent user enumeration via timing
		await verifyPassword(password, 'x:0'.padEnd(73, '0'));

		await audit({
			action: 'USER_LOGIN_FAILED',
			actorId: null,
			metadata: { username: normalizedUsername, reason: 'not_found', ip: clientIp }
		});

		// Uniform error message — don't reveal whether user exists
		throw error(401, 'Invalid credentials');
	}

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) {
		await audit({
			action: 'USER_LOGIN_FAILED',
			actorId: user.id,
			metadata: { reason: 'bad_password', ip: clientIp }
		});
		throw error(401, 'Invalid credentials');
	}

	if (!user.approved) {
		await audit({
			action: 'USER_LOGIN_FAILED',
			actorId: user.id,
			metadata: { reason: 'not_approved', ip: clientIp }
		});
		// Don't reveal approval status — same error as bad credentials
		throw error(401, 'Invalid credentials');
	}

	const accessToken = generateAccessToken({ sub: user.id, username: user.username, role: user.role });
	const refreshToken = generateRefreshToken({ sub: user.id, username: user.username, role: user.role });

	cookies.set('refreshToken', refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'strict',
		path: '/',
		maxAge: 60 * 60 * 24 * 7 // 7 days
	});

	await audit({
		action: 'USER_LOGIN',
		actorId: user.id,
		metadata: { ip: clientIp }
	});

	return json({
		accessToken,
		role: user.role,
		username: user.username,
		displayName: user.displayName
	});
};
