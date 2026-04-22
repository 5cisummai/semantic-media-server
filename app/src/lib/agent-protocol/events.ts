import type {
	PendingToolConfirmation,
	Source,
	ToolCallSummary
} from '$lib/components/chat-llm/types';

export type AgentSseEvent =
	| {
			type: 'run_started';
			runId?: string;
			chatId?: string;
			userMessageId?: string;
	  }
	| {
			type: 'text_delta';
			delta: string;
	  }
	| {
			type: 'reasoning';
			text: string;
	  }
	| {
			type: 'tool_start';
			tool: string;
			args: Record<string, unknown>;
	  }
	| {
			type: 'tool_done';
			tool?: string;
			result?: string;
	  }
	| {
			type: 'confirmation';
			payload: PendingToolConfirmation;
	  }
	| {
			type: 'meta';
			chatId?: string;
			messageId?: string;
			sources?: Source[];
			toolCalls?: ToolCallSummary[];
			model?: string;
			iterations?: number;
	  }
	| {
			type: 'error';
			message: string;
	  }
	| {
			type: 'done';
	  };

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

export function parseAgentSseEvent(eventName: string, payload: unknown): AgentSseEvent | null {
	const data = asRecord(payload) ?? {};
	switch (eventName) {
		case 'run_started':
			return {
				type: 'run_started',
				runId: asString(data.runId),
				chatId: asString(data.chatId),
				userMessageId: asString(data.userMessageId)
			};
		case 'text_delta': {
			const delta = asString(data.delta);
			return delta ? { type: 'text_delta', delta } : null;
		}
		case 'reasoning': {
			const text = asString(data.text);
			return text ? { type: 'reasoning', text } : null;
		}
		case 'tool_start': {
			const tool = asString(data.tool);
			if (!tool) return null;
			const args = asRecord(data.args) ?? {};
			return { type: 'tool_start', tool, args };
		}
		case 'tool_done':
			return {
				type: 'tool_done',
				tool: asString(data.tool),
				result: asString(data.result)
			};
		case 'confirmation': {
			const pendingId = asString(data.pendingId);
			const tool = asString(data.tool);
			if (!pendingId || !tool) return null;
			return {
				type: 'confirmation',
				payload: {
					pendingId,
					tool,
					args: asRecord(data.args) ?? {},
					chatId: asString(data.chatId)
				}
			};
		}
		case 'meta':
			return {
				type: 'meta',
				chatId: asString(data.chatId),
				messageId: asString(data.messageId),
				sources: Array.isArray(data.sources) ? (data.sources as Source[]) : undefined,
				toolCalls: Array.isArray(data.toolCalls)
					? (data.toolCalls as ToolCallSummary[])
					: undefined,
				model: asString(data.model),
				iterations: typeof data.iterations === 'number' ? data.iterations : undefined
			};
		case 'error':
			return {
				type: 'error',
				message: asString(data.message) ?? 'Agent error'
			};
		case 'done':
			return { type: 'done' };
		default:
			return null;
	}
}
