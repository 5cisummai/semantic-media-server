// ---------------------------------------------------------------------------
// agent/logger.ts — Structured agent logger with per-run trace context
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

export interface AgentLogEntry {
	traceId: string;
	timestamp: string;
	level: 'debug' | 'info' | 'warn' | 'error';
	event: string;
	data?: Record<string, unknown>;
}

/**
 * Lightweight structured logger scoped to a single agent run.
 *
 * Every log entry carries a `traceId` so you can correlate all events
 * belonging to the same run in production logs.
 */
export class AgentLogger {
	readonly traceId: string;
	private startMs: number;

	constructor(traceId?: string) {
		this.traceId = traceId ?? randomUUID();
		this.startMs = Date.now();
	}

	private emit(level: AgentLogEntry['level'], event: string, data?: Record<string, unknown>): void {
		const entry: AgentLogEntry = {
			traceId: this.traceId,
			timestamp: new Date().toISOString(),
			level,
			event,
			...(data ? { data } : {})
		};

		// In production, pipe to a structured logging backend.
		// For now, use console with JSON for machine-parseable output.
		if (level === 'error') {
			console.error(JSON.stringify(entry));
		} else if (level === 'warn') {
			console.warn(JSON.stringify(entry));
		} else {
			console.log(JSON.stringify(entry));
		}
	}

	debug(event: string, data?: Record<string, unknown>): void {
		this.emit('debug', event, data);
	}

	info(event: string, data?: Record<string, unknown>): void {
		this.emit('info', event, data);
	}

	warn(event: string, data?: Record<string, unknown>): void {
		this.emit('warn', event, data);
	}

	error(event: string, data?: Record<string, unknown>): void {
		this.emit('error', event, data);
	}

	/** Elapsed milliseconds since the logger was created. */
	elapsed(): number {
		return Date.now() - this.startMs;
	}
}
