import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	// requireAuth re-validates from DB and checks soft-delete + approval
	const user = await requireAuth(locals);

	return json({
		id: user.id,
		username: user.username,
		role: user.role,
		approved: user.approved
	});
};