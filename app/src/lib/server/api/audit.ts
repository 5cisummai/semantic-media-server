import { db } from '$lib/server/db';
import type { Prisma } from '@prisma/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type AuditAction =
	| 'USER_APPROVED'
	| 'USER_REJECTED'
	| 'USER_LOGIN'
	| 'USER_LOGIN_FAILED'
	| 'USER_SIGNUP'
	| 'USER_DELETED'
	| 'FILE_DELETED'
	| 'DIRECTORY_DELETED'
	| 'WORKSPACE_CREATED'
	| 'WORKSPACE_DELETED'
	| 'WORKSPACE_UPDATED'
	| 'MEMBER_ADDED'
	| 'MEMBER_REMOVED'
	| 'MEMBER_ROLE_CHANGED';

interface AuditEntry {
	action: AuditAction;
	actorId: string | null;
	targetId?: string | null;
	metadata?: Record<string, unknown>;
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Write a structured audit log entry.
 *
 * Dual-writes to:
 * 1. Database AuditLog table (persistent, queryable)
 * 2. Structured console log (for log aggregation / SIEM)
 *
 * Audit logging is fire-and-forget: failures are caught and logged
 * but never block the request or throw to the caller. This prevents
 * an audit infrastructure outage from taking down the application.
 */
export async function audit(entry: AuditEntry): Promise<void> {
	const timestamp = new Date().toISOString();

	// Always log to console — this is the fallback if DB write fails
	const logPayload = {
		level: 'audit',
		timestamp,
		action: entry.action,
		actorId: entry.actorId,
		targetId: entry.targetId ?? null,
		metadata: entry.metadata ?? {}
	};

	console.log(JSON.stringify(logPayload));

	// Persist to database (non-blocking)
	try {
		await db.auditLog.create({
			data: {
				action: entry.action,
				actorId: entry.actorId,
				targetId: entry.targetId ?? null,
				metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue
			}
		});
	} catch (err) {
		// Audit write failure must never crash the request
		console.error('[audit] Failed to persist audit log:', err);
	}
}
