import { randomUUID } from 'node:crypto';

export type BackgroundRunStatus =
	| 'queued'
	| 'running'
	| 'awaiting_confirmation'
	| 'done'
	| 'failed';

export interface RunPendingConfirmation {
	pendingId: string;
	tool: string;
	args: Record<string, unknown>;
	chatId: string;
}

/** Serializable tool stream entries for UI (see brain-agent-loop ToolStreamEvent). */
export type BackgroundToolStreamEntry = {
	type: 'tool_start' | 'tool_done';
	tool: string;
};

export interface BackgroundRunRecord {
	id: string;
	userId: string;
	chatId: string;
	kind: 'ask' | 'confirm';
	status: BackgroundRunStatus;
	error?: string;
	pendingToolConfirmation?: RunPendingConfirmation;
	/** Ordered tool_start / tool_done pairs for live status while the run is in progress. */
	toolStreamLog?: BackgroundToolStreamEntry[];
	createdAt: number;
	updatedAt: number;
}

const RETAIN_MS = 60 * 60 * 1000;
const runs = new Map<string, BackgroundRunRecord>();

function cleanupRuns(): void {
	const now = Date.now();
	for (const [id, run] of runs) {
		if ((run.status === 'done' || run.status === 'failed') && now - run.updatedAt > RETAIN_MS) {
			runs.delete(id);
		}
	}
}

function updateRun(
	runId: string,
	updater: (run: BackgroundRunRecord) => BackgroundRunRecord
): BackgroundRunRecord | null {
	const current = runs.get(runId);
	if (!current) return null;
	const next = { ...updater(current), updatedAt: Date.now() };
	runs.set(runId, next);
	return next;
}

export function createBackgroundRun(
	userId: string,
	chatId: string,
	kind: 'ask' | 'confirm'
): BackgroundRunRecord {
	cleanupRuns();
	const now = Date.now();
	const run: BackgroundRunRecord = {
		id: randomUUID(),
		userId,
		chatId,
		kind,
		status: 'queued',
		createdAt: now,
		updatedAt: now
	};
	runs.set(run.id, run);
	return run;
}

export function markRunRunning(runId: string): BackgroundRunRecord | null {
	return updateRun(runId, (run) => ({
		...run,
		status: 'running',
		error: undefined,
		toolStreamLog: []
	}));
}

export function appendRunToolStreamEvent(
	runId: string,
	entry: BackgroundToolStreamEntry
): BackgroundRunRecord | null {
	return updateRun(runId, (run) => ({
		...run,
		toolStreamLog: [...(run.toolStreamLog ?? []), entry]
	}));
}

export function markRunAwaitingConfirmation(
	runId: string,
	pending: RunPendingConfirmation
): BackgroundRunRecord | null {
	return updateRun(runId, (run) => ({
		...run,
		status: 'awaiting_confirmation',
		pendingToolConfirmation: pending,
		error: undefined
	}));
}

export function markRunDone(runId: string): BackgroundRunRecord | null {
	return updateRun(runId, (run) => ({
		...run,
		status: 'done',
		pendingToolConfirmation: undefined,
		error: undefined
	}));
}

export function markRunFailed(runId: string, message: string): BackgroundRunRecord | null {
	return updateRun(runId, (run) => ({
		...run,
		status: 'failed',
		error: message,
		pendingToolConfirmation: undefined
	}));
}

export function getBackgroundRunForUser(
	userId: string,
	runId: string
): BackgroundRunRecord | null {
	cleanupRuns();
	const run = runs.get(runId);
	if (!run || run.userId !== userId) return null;
	return run;
}

export function getActiveBackgroundRunForChat(
	userId: string,
	chatId: string
): BackgroundRunRecord | null {
	cleanupRuns();
	let candidate: BackgroundRunRecord | null = null;
	for (const run of runs.values()) {
		if (run.userId !== userId || run.chatId !== chatId) continue;
		if (run.status === 'done' || run.status === 'failed') continue;
		if (!candidate || run.createdAt > candidate.createdAt) {
			candidate = run;
		}
	}
	return candidate;
}
