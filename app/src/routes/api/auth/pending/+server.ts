import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/api';
import type { RequestHandler } from './$types';

// GET /api/auth/pending — admin only, returns unapproved (non-deleted) users
export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	// Only show pending users that haven't been soft-deleted (rejected)
	const pending = await db.user.findMany({
		where: { approved: false, deletedAt: null },
		select: { id: true, username: true, displayName: true, createdAt: true }
	});

	return json(pending);
};
