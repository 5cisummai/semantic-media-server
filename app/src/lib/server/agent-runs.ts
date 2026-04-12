// ---------------------------------------------------------------------------
// agent-runs.ts — DB-backed agent run lifecycle
//
// Replaces the in-memory Map in background-agent-runs.ts with persistent
// storage. Keeps the same subscriber bus pattern for real-time SSE updates.
// ---------------------------------------------------------------------------

import { db } from '$lib/server/db';
import type { AgentRunStatus } from '@prisma/client';

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
// Subscriber bus — real-time status events (SSE / workspace events)
// ---------------------------------------------------------------------------

type RunStatusListener = (
	userId: string,
	chatId: string,
	status: ApiRunStatus,
	workspaceId?: string | null
) => void;

const listeners = new Set<RunStatusListener>();

export function subscribeRunStatus(cb: RunStatusListener): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

function emit(run: AgentRunRecord): void {
	const apiStatus = toApiStatus(run.status);
	for (const cb of listeners) {
		cb(run.userId, run.chatId, apiStatus, run.workspaceId);
	}
}

// In-memory tool stream logs (ephemeral — only needed while run is active)
const toolStreamLogs = new Map<string, BackgroundToolStreamEntry[]>();

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
