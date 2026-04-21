import { db } from '$lib/server/db';
import type { Prisma } from '@prisma/client';

const TTL_MS = 30 * 60 * 1000;

export interface PendingAgentPayload {
	/** Serialized RunState from the SDK (via result.state.toString()). */
	runState: string;
	/** Tool name that triggered the approval request — for display in the UI. */
	toolName: string;
	/** Tool arguments at the time of the approval request — for display in the UI. */
	toolArgs: Record<string, unknown>;
}

export async function createPendingConfirmation(
	userId: string,
	chatSessionId: string,
	payload: PendingAgentPayload
): Promise<string> {
	const expiresAt = new Date(Date.now() + TTL_MS);
	const row = await db.pendingToolConfirmation.create({
		data: {
			userId,
			chatSessionId,
			payload: payload as unknown as Prisma.InputJsonValue,
			expiresAt
		},
		select: { id: true }
	});

	return row.id;
}

export async function takePendingConfirmation(
	userId: string,
	pendingId: string
): Promise<{ chatSessionId: string; payload: PendingAgentPayload } | null> {
	const row = await db.pendingToolConfirmation.findFirst({
		where: {
			id: pendingId,
			userId,
			expiresAt: { gt: new Date() }
		},
		select: {
			chatSessionId: true,
			payload: true
		}
	});

	if (!row) return null;

	await db.pendingToolConfirmation.deleteMany({
		where: { id: pendingId, userId }
	});

	return {
		chatSessionId: row.chatSessionId,
		payload: row.payload as unknown as PendingAgentPayload
	};
}

/** Remove expired PendingToolConfirmation rows. */
export async function cleanupExpiredConfirmations(): Promise<number> {
	const result = await db.pendingToolConfirmation.deleteMany({
		where: { expiresAt: { lte: new Date() } }
	});
	return result.count;
}

// Proactively clean up expired confirmations every 10 minutes
setInterval(
	() => {
		cleanupExpiredConfirmations().catch(() => {});
	},
	10 * 60 * 1000
).unref();
