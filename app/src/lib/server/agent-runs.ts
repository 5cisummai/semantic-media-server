// ---------------------------------------------------------------------------
// agent-runs.ts — DB-backed agent run lifecycle
//
// Replaces the in-memory Map in background-agent-runs.ts with persistent
// storage. Keeps the same subscriber bus pattern for real-time SSE updates.
// ---------------------------------------------------------------------------

import { db } from '$lib/server/db';
import type { AgentRunStatus } from '@prisma/client';
import { emit as emitWorkspaceEvent } from '$lib/server/services/event-bus';

// ---------------------------------------------------------------------------
// Types (backward-compatible with the old in-memory interface)
// ---------------------------------------------------------------------------

export type { AgentRunStatus };

/** Lowercase status string for API responses (backward-compatible with old in-memory format). */
export type ApiRunStatus = 'queued' | 'running' | 'awaiting_confirmation' | 'done' | 'failed';

export function toApiStatus(status: AgentRunStatus): ApiRunStatus {
	return status.toLowerCase() as ApiRunStatus;
}

export interface RunPendingConfirmation {
	pendingId: string;
	tool: string;
	args: Record<string, unknown>;
	chatId: string;
}

export type BackgroundToolStreamEntry = {
	type: 'tool_start' | 'tool_done';
	tool: string;
};

export interface AgentRunRecord {
	id: string;
	userId: string;
	chatId: string;
	workspaceId: string | null;
	kind: string;
	status: AgentRunStatus;
	error?: string | null;
	pendingToolConfirmation?: RunPendingConfirmation;
	toolStreamLog?: BackgroundToolStreamEntry[];
	steps?: RunStep[];
	createdAt: string;
	updatedAt: string;
}

export interface RunStep {
	type: 'tool_call' | 'tool_result' | 'llm_response' | 'error';
	timestamp: string;
	data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Real-time status — workspace-scoped SSE via event-bus (`run.status` events)
// ---------------------------------------------------------------------------

function emit(run: AgentRunRecord): void {
	const apiStatus = toApiStatus(run.status);
	if (run.workspaceId) {
		emitWorkspaceEvent(run.workspaceId, 'run.status', {
			chatId: run.chatId,
			status: apiStatus,
			runId: run.id
		});
	}
}

/** Emit a real-time step event via SSE so the client can show tool progress. */
export function emitRunStep(
	workspaceId: string | null,
	chatId: string,
	runId: string,
	step: { type: string; tool?: string; args?: Record<string, unknown>; resultSummary?: string }
): void {
	if (workspaceId) {
		emitWorkspaceEvent(workspaceId, 'run.step', {
			chatId,
			runId,
			step
		});
	}
}

// In-memory tool stream logs (ephemeral — only needed while run is active)
const toolStreamLogs = new Map<string, BackgroundToolStreamEntry[]>();

/** Periodic cleanup: remove toolStreamLog entries for runs older than 1 hour */
const STALE_LOG_TTL_MS = 60 * 60 * 1000;
const staleLogTimestamps = new Map<string, number>();

function touchLogTimestamp(runId: string): void {
	staleLogTimestamps.set(runId, Date.now());
}

function cleanupStaleToolStreamLogs(): void {
	const now = Date.now();
	for (const [runId, ts] of staleLogTimestamps) {
		if (now - ts > STALE_LOG_TTL_MS) {
			toolStreamLogs.delete(runId);
			staleLogTimestamps.delete(runId);
		}
	}
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleToolStreamLogs, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRecord(row: {
	id: string;
	userId: string;
	chatId: string;
	workspaceId: string | null;
	kind: string;
	status: AgentRunStatus;
	error: string | null;
	metadata: unknown;
	steps: unknown;
	createdAt: Date;
	updatedAt: Date;
}): AgentRunRecord {
	const metadata = (row.metadata ?? {}) as Record<string, unknown>;
	const pending = metadata.pendingToolConfirmation as RunPendingConfirmation | undefined;
	const rawSteps = (row.steps ?? []) as RunStep[];

	return {
		id: row.id,
		userId: row.userId,
		chatId: row.chatId,
		workspaceId: row.workspaceId,
		kind: row.kind,
		status: row.status,
		error: row.error,
		pendingToolConfirmation: pending,
		toolStreamLog: toolStreamLogs.get(row.id),
		steps: rawSteps,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAgentRun(
	userId: string,
	chatId: string,
	kind: string,
	workspaceId?: string | null
): Promise<AgentRunRecord> {
	const row = await db.agentRun.create({
		data: {
			userId,
			chatId,
			workspaceId: workspaceId ?? null,
			kind,
			status: 'QUEUED',
			steps: []
		}
	});
	const record = toRecord(row);
	toolStreamLogs.set(row.id, []);
	touchLogTimestamp(row.id);
	emit(record);
	return record;
}

export async function markRunRunning(runId: string): Promise<AgentRunRecord | null> {
	try {
		const row = await db.agentRun.update({
			where: { id: runId },
			data: { status: 'RUNNING', error: null }
		});
		toolStreamLogs.set(runId, []);
		touchLogTimestamp(runId);
		const record = toRecord(row);
		emit(record);
		return record;
	} catch {
		return null;
	}
}

export function appendRunToolStreamEvent(runId: string, entry: BackgroundToolStreamEntry): void {
	const log = toolStreamLogs.get(runId);
	if (log) log.push(entry);
}

export async function markRunAwaitingConfirmation(
	runId: string,
	pending: RunPendingConfirmation
): Promise<AgentRunRecord | null> {
	try {
		const row = await db.agentRun.update({
			where: { id: runId },
			data: {
				status: 'AWAITING_CONFIRMATION',
				error: null,
				metadata: {
					pendingToolConfirmation: pending
				} as unknown as import('@prisma/client').Prisma.InputJsonValue
			}
		});
		const record = toRecord(row);
		emit(record);
		return record;
	} catch {
		return null;
	}
}

export async function markRunDone(runId: string): Promise<AgentRunRecord | null> {
	try {
		const row = await db.agentRun.update({
			where: { id: runId },
			data: {
				status: 'DONE',
				error: null,
				metadata: {}
			}
		});
		toolStreamLogs.delete(runId);
		staleLogTimestamps.delete(runId);
		const record = toRecord(row);
		emit(record);
		return record;
	} catch {
		return null;
	}
}

export async function markRunFailed(
	runId: string,
	message: string
): Promise<AgentRunRecord | null> {
	try {
		const row = await db.agentRun.update({
			where: { id: runId },
			data: {
				status: 'FAILED',
				error: message,
				metadata: {}
			}
		});
		toolStreamLogs.delete(runId);
		staleLogTimestamps.delete(runId);
		const record = toRecord(row);
		emit(record);
		return record;
	} catch {
		return null;
	}
}

export async function appendRunStep(runId: string, step: RunStep): Promise<void> {
	const current = await db.agentRun.findUnique({
		where: { id: runId },
		select: { steps: true }
	});
	if (!current) return; // Run was deleted (e.g. cascade from chat deletion) — skip silently
	const steps = (current.steps ?? []) as unknown as RunStep[];
	steps.push(step);
	await db.agentRun.update({
		where: { id: runId },
		data: { steps: steps as unknown as import('@prisma/client').Prisma.InputJsonValue }
	});
}

/**
 * When a continuation run starts after tool confirmation, retire any
 * stale runs for the same chat so getActiveRunForChat returns the new one.
 */
export async function supersedeOtherRunsForChat(
	userId: string,
	chatId: string,
	keepRunId: string
): Promise<void> {
	await db.agentRun.updateMany({
		where: {
			userId,
			chatId,
			id: { not: keepRunId },
			status: { notIn: ['DONE', 'FAILED'] }
		},
		data: {
			status: 'DONE',
			metadata: {}
		}
	});
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAgentRun(runId: string, userId?: string): Promise<AgentRunRecord | null> {
	const where: Record<string, unknown> = { id: runId };
	if (userId) where.userId = userId;

	const row = await db.agentRun.findFirst({ where });
	return row ? toRecord(row) : null;
}

export async function getAgentRunForWorkspace(
	workspaceId: string,
	runId: string
): Promise<AgentRunRecord | null> {
	const row = await db.agentRun.findFirst({
		where: { id: runId, workspaceId }
	});
	return row ? toRecord(row) : null;
}

export async function getActiveRunForChat(
	chatId: string,
	userId?: string
): Promise<AgentRunRecord | null> {
	const where: Record<string, unknown> = {
		chatId,
		status: { notIn: ['DONE', 'FAILED'] }
	};
	if (userId) where.userId = userId;

	const row = await db.agentRun.findFirst({
		where,
		orderBy: { createdAt: 'desc' }
	});
	return row ? toRecord(row) : null;
}
