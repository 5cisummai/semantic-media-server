import type { Source, ToolCallSummary } from '$lib/components/chat-llm/types';
import type { AgentSseEvent } from './events';
import { toolLabelForName } from './tool-metadata';

export type ToolActionStep = {
	label: string;
	toolName: string;
	args?: Record<string, unknown>;
	thinking?: string;
	done: boolean;
	expanded: boolean;
};

export type StreamAssistantMeta = {
	messageId?: string;
	sources?: Source[];
	toolCalls?: ToolCallSummary[];
	model?: string;
	iterations?: number;
	content: string;
};

export type AgentRunStreamState = {
	activeChatId?: string;
	lastUserMessageId?: string;
	streamingText: string;
	pendingThinking: string;
	toolSteps: ToolActionStep[];
	error: string | null;
	pendingToolConfirmation: {
		pendingId: string;
		tool: string;
		args: Record<string, unknown>;
		chatId?: string;
	} | null;
	finalizedAssistant: StreamAssistantMeta | null;
};

export function createInitialAgentRunStreamState(): AgentRunStreamState {
	return {
		activeChatId: undefined,
		lastUserMessageId: undefined,
		streamingText: '',
		pendingThinking: '',
		toolSteps: [],
		error: null,
		pendingToolConfirmation: null,
		finalizedAssistant: null
	};
}

export function resetAgentRunStreamState(
	state: AgentRunStreamState,
	overrides?: Partial<AgentRunStreamState>
): AgentRunStreamState {
	return {
		...createInitialAgentRunStreamState(),
		activeChatId: state.activeChatId,
		...overrides
	};
}

export function consumeFinalizedAssistant(state: AgentRunStreamState): {
	next: AgentRunStreamState;
	finalized: StreamAssistantMeta | null;
} {
	const finalized = state.finalizedAssistant;
	if (!finalized) return { next: state, finalized: null };
	return {
		next: { ...state, finalizedAssistant: null },
		finalized
	};
}

export function applyAgentSseEvent(
	state: AgentRunStreamState,
	event: AgentSseEvent
): AgentRunStreamState {
	switch (event.type) {
		case 'run_started':
			return {
				...state,
				activeChatId: event.chatId ?? state.activeChatId,
				lastUserMessageId: event.userMessageId ?? state.lastUserMessageId
			};
		case 'text_delta':
			return {
				...state,
				streamingText: state.streamingText + event.delta
			};
		case 'reasoning':
			return {
				...state,
				pendingThinking: state.pendingThinking
					? `${state.pendingThinking}\n${event.text}`
					: event.text
			};
		case 'tool_start':
			return {
				...state,
				toolSteps: [
					...state.toolSteps,
					{
						label: toolLabelForName(event.tool),
						toolName: event.tool,
						args: event.args,
						thinking: state.pendingThinking || undefined,
						done: false,
						expanded: false
					}
				],
				pendingThinking: ''
			};
		case 'tool_done': {
			const idx = state.toolSteps.findLastIndex((step) => !step.done);
			if (idx < 0) return state;
			return {
				...state,
				toolSteps: state.toolSteps.map((step, i) => (i === idx ? { ...step, done: true } : step))
			};
		}
		case 'confirmation':
			return {
				...state,
				pendingToolConfirmation: {
					...event.payload,
					chatId: event.payload.chatId ?? state.activeChatId
				}
			};
		case 'meta': {
			const text = state.streamingText.trim();
			if (!text) return state;
			return {
				...state,
				finalizedAssistant: {
					messageId: event.messageId,
					sources: event.sources,
					toolCalls: event.toolCalls,
					model: event.model,
					iterations: event.iterations,
					content: state.streamingText
				}
			};
		}
		case 'error':
			return {
				...state,
				error: event.message
			};
		case 'done':
			return state;
		default:
			return state;
	}
}
