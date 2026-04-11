import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	requireAdmin,
	parseBody,
	approveUserSchema,
	audit,
	checkRateLimit,
	ADMIN_RATE_LIMIT,
	operationFailedResponse
} from '$lib/server/api';
import type { RequestHandler } from './$types';

// POST /api/auth/approve — admin only, approves a pending user
export const POST: RequestHandler = async ({ request, locals }) => {
	// Re-validate admin role from DB (not just JWT)
	const admin = await requireAdmin(locals);
	checkRateLimit('admin', admin.id, ADMIN_RATE_LIMIT);

	// Validate input with Zod (.strict() rejects unexpected fields)
	const { userId } = await parseBody(request, approveUserSchema);

	// Prevent self-approval (defense in depth — admin is already approved)
	if (userId === admin.id) {
		return operationFailedResponse('Admin attempted self-approval');
	}

	// Atomic conditional update — eliminates the TOCTOU race condition.
	// The WHERE clause ensures we only approve a user that is:
	//   1. Not already approved
	//   2. Not soft-deleted
	// If the row doesn't match, updateMany returns count: 0.
	const result = await db.user.updateMany({
		where: { id: userId, approved: false, deletedAt: null },
		data: { approved: true }
	});

	if (result.count === 0) {
		// Deliberately vague — don't reveal if user exists, is approved, or is deleted
		return operationFailedResponse(`Approve failed for target=${userId} by actor=${admin.id}`);
	}

	// Audit log — persisted and cannot be bypassed
	await audit({
		action: 'USER_APPROVED',
		actorId: admin.id,
		targetId: userId,
		metadata: { actorUsername: admin.username }
	});

	return json({ success: true });
};

// DELETE /api/auth/approve — admin only, rejects (soft-deletes) a pending user
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const admin = await requireAdmin(locals);
	checkRateLimit('admin', admin.id, ADMIN_RATE_LIMIT);

	const { userId } = await parseBody(request, approveUserSchema);

	// Prevent self-rejection
	if (userId === admin.id) {
		return operationFailedResponse('Admin attempted self-rejection');
	}

	// Soft delete instead of hard delete — preserves audit trail and enables recovery.
	// Only reject users that are still pending (not approved) and not already deleted.
	const result = await db.user.updateMany({
		where: { id: userId, approved: false, deletedAt: null },
		data: { deletedAt: new Date() }
	});

	if (result.count === 0) {
		return operationFailedResponse(`Reject failed for target=${userId} by actor=${admin.id}`);
	}

	await audit({
		action: 'USER_REJECTED',
		actorId: admin.id,
		targetId: userId,
		metadata: { actorUsername: admin.username }
	});

	return json({ success: true });
};
