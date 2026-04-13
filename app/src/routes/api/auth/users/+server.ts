import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/api';
import type { RequestHandler } from './$types';

// GET /api/auth/users — admin only, returns all active users
export const GET: RequestHandler = async ({ locals }) => {
	// Re-validate admin role from DB on every request
	await requireAdmin(locals);

	// Exclude soft-deleted users from the listing
	const users = await db.user.findMany({
		where: { deletedAt: null },
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			username: true,
			displayName: true,
			role: true,
			approved: true,
			createdAt: true
		}
	});

	return json(users);
};
