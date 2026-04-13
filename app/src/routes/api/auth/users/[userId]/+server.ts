import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	requireAdmin,
	parseBody,
	updateAppUserRoleSchema,
	audit,
	checkRateLimit,
	ADMIN_RATE_LIMIT,
	operationFailedResponse
} from '$lib/server/api';
import { invalidateUserCache } from '../../../../../hooks.server';
import type { RequestHandler } from './$types';

/** PATCH — set app-level role (ADMIN vs USER). Admin only. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const admin = await requireAdmin(locals);
	checkRateLimit('admin', admin.id, ADMIN_RATE_LIMIT);

	const targetUserId = params.userId;
	if (!targetUserId) {
		return operationFailedResponse('Missing user id');
	}

	const { role } = await parseBody(request, updateAppUserRoleSchema);

	if (targetUserId === admin.id) {
		return operationFailedResponse('Cannot change your own role');
	}

	const target = await db.user.findUnique({
		where: { id: targetUserId },
		select: { id: true, role: true, approved: true, deletedAt: true }
	});

	if (!target || target.deletedAt !== null || !target.approved) {
		return operationFailedResponse(`Role update failed for target=${targetUserId}`);
	}

	if (role === 'USER' && target.role === 'ADMIN') {
		const adminCount = await db.user.count({
			where: { role: 'ADMIN', deletedAt: null, approved: true }
		});
		if (adminCount <= 1) {
			return operationFailedResponse('Cannot demote the last administrator');
		}
	}

	await db.user.update({
		where: { id: targetUserId },
		data: { role }
	});

	invalidateUserCache(targetUserId);

	await audit({
		action: 'USER_APP_ROLE_CHANGED',
		actorId: admin.id,
		targetId: targetUserId,
		metadata: { from: target.role, to: role, actorUsername: admin.username }
	});

	return json({ success: true });
};

/** DELETE — soft-delete (deactivate) a user account. Admin only. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const admin = await requireAdmin(locals);
	checkRateLimit('admin', admin.id, ADMIN_RATE_LIMIT);

	const targetUserId = params.userId;
	if (!targetUserId) {
		return operationFailedResponse('Missing user id');
	}

	if (targetUserId === admin.id) {
		return operationFailedResponse('Cannot deactivate your own account');
	}

	const target = await db.user.findUnique({
		where: { id: targetUserId },
		select: { role: true, deletedAt: true }
	});

	if (!target || target.deletedAt !== null) {
		return operationFailedResponse(`Deactivate failed for target=${targetUserId}`);
	}

	if (target.role === 'ADMIN') {
		const adminCount = await db.user.count({
			where: { role: 'ADMIN', deletedAt: null, approved: true }
		});
		if (adminCount <= 1) {
			return operationFailedResponse('Cannot deactivate the last administrator');
		}
	}

	await db.user.update({
		where: { id: targetUserId },
		data: { deletedAt: new Date() }
	});

	invalidateUserCache(targetUserId);

	await audit({
		action: 'USER_DELETED',
		actorId: admin.id,
		targetId: targetUserId,
		metadata: { actorUsername: admin.username, reason: 'admin_deactivate' }
	});

	return json({ success: true });
};
