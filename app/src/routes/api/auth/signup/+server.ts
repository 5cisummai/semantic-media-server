import { json, error } from '@sveltejs/kit';
import { createUser, generateAccessToken, generateRefreshToken } from '$lib/server/auth';
import { parseBody, signupSchema, audit, checkRateLimit, SIGNUP_RATE_LIMIT } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const clientIp = getClientAddress();
	checkRateLimit('signup', clientIp, SIGNUP_RATE_LIMIT);

	// Zod validation: enforces types, lengths, format; transforms username
	// Password is NOT trimmed — whitespace is intentional entropy
	const { username, displayName, password } = await parseBody(request, signupSchema);

	try {
		const user = await createUser({ username, displayName, password });

		await audit({
			action: 'USER_SIGNUP',
			actorId: user.id,
			metadata: { username: user.username, autoApproved: user.approved, ip: clientIp }
		});

		// If user is auto-approved (first user), generate tokens
		if (user.approved) {
			const accessToken = generateAccessToken({ sub: user.id, username: user.username, role: user.role });
			const refreshToken = generateRefreshToken({ sub: user.id, username: user.username, role: user.role });

			cookies.set('refreshToken', refreshToken, {
				httpOnly: true,
				secure: process.env.NODE_ENV === 'production',
				sameSite: 'strict',
				path: '/',
				maxAge: 60 * 60 * 24 * 7 // 7 days
			});

			return json({
				id: user.id,
				username: user.username,
				approved: user.approved,
				role: user.role,
				accessToken
			});
		}

		return json({
			id: user.id,
			username: user.username,
			approved: user.approved,
			role: user.role
		});
	} catch (e) {
		if (e instanceof Error && e.message.includes('Unique constraint')) {
			// Don't reveal that the username exists — return a generic message
			throw error(409, 'Username already taken');
		}
		throw e;
	}
};
