import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/api';
import { getStorageDrives } from '$lib/server/services/storage';

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireAuth(locals);

	if (user.role !== 'ADMIN') {
		return {
			isAdmin: false,
			currentUserId: user.id,
			drives: [],
			users: [],
			pendingUsers: []
		};
	}

	const [drives, users, pendingUsers] = await Promise.all([
		getStorageDrives(),
		db.user.findMany({
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
		}),
		db.user.findMany({
			where: { approved: false, deletedAt: null },
			select: { id: true, username: true, displayName: true, createdAt: true }
		})
	]);

	return {
		isAdmin: true,
		currentUserId: user.id,
		drives,
		users: users.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
		pendingUsers: pendingUsers.map((entry) => ({
			...entry,
			createdAt: entry.createdAt.toISOString()
		}))
	};
};
