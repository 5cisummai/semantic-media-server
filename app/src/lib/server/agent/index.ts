// ---------------------------------------------------------------------------
// agent/index.ts — Public API for the agent system
//
// Two entry points:
//   runAgent()     — handle a new question or regeneration
//   confirmTool()  — handle tool approval/denial and resume
//
// All runs use SSE streaming — the client receives real-time events.
// ---------------------------------------------------------------------------

import { error } from '@sveltejs/kit';
import { RunState } from '@openai/agents';
import { env } from '$env/dynamic/private';
import type { AgentRequest, AgentRunConfig, ConfirmRunConfig } from './types';
import { createAppContext, type AgentAppContext } from './context';
import { AgentLogger } from './logger';
import { normalizeFilters } from './filters';
import { createStreamingResponse, createConfirmStreamingResponse } from './transport/stream';
import { sliceHistory } from './memory/history';
import { getMediaAgent } from './agent';
import { configureAgentProvider, getAgentModel } from './provider';
import {
	resolveOrCreateChat,
	ensureOwnedChatSession,
	getChatMessagesForUser,
	messagesToLlmHistory,
	saveUserMessage
} from '$lib/server/chat-store';
import { takePendingConfirmation } from '$lib/server/pending-tool-confirmation';

// Configure the LLM provider once at module initialization
configureAgentProvider();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(
	config: {
		userId: string;
		isAdmin: boolean;
		chatId: string;
		workspaceId?: string;
		autoApproveToolNames?: string[];
	},
	logger: AgentLogger,
	filters?: import('./types').AskFilters
): AgentAppContext {
	return createAppContext({
		userId: config.userId,
		chatId: config.chatId,
		isAdmin: config.isAdmin,
		workspaceId: config.workspaceId,
		filters: normalizeFilters(filters),
		autoApproveToolNames: config.autoApproveToolNames,
		logger
	});
}

// ---------------------------------------------------------------------------
// runAgent — handles new questions and regenerations (SSE streaming)
// ---------------------------------------------------------------------------

export async function runAgent(
	question: string,
	config: AgentRunConfig,
	filters?: import('./types').AskFilters
): Promise<Response> {
	if (!config.workspaceId?.trim()) {
		throw error(400, 'workspaceId is required');
	}

	const logger = new AgentLogger();

	let chatId: string;
	let bodyForAgent: AgentRequest;
	let savedUserMessageId: string | null = null;

	if (config.regenerate) {
		if (!config.chatId?.trim()) throw error(400, 'chatId is required when regenerate is true');
		try {
			await ensureOwnedChatSession(config.userId, config.chatId, config.workspaceId);
		} catch {
			throw error(404, 'Chat not found');
		}
		chatId = config.chatId;
		const previousMessages = await getChatMessagesForUser(config.userId, chatId);
		if (previousMessages.length === 0) throw error(400, 'No messages to regenerate from');
		const last = previousMessages[previousMessages.length - 1];
		if (last.role !== 'user') throw error(400, 'Last message must be a user message to regenerate');
		const history = sliceHistory(
			messagesToLlmHistory(previousMessages.slice(0, -1)),
			config.maxHistoryMessages
		);
		bodyForAgent = {
			question: last.content,
			history,
			filters,
			autoApproveToolNames: config.autoApproveToolNames
		};
	} else {
		const chat = await resolveOrCreateChat(
			config.userId,
			config.chatId,
			question,
			config.workspaceId
		).catch(() => {
			throw error(404, 'Chat not found');
		});
		chatId = chat.id;
		const previousMessages = await getChatMessagesForUser(config.userId, chatId);
		const history = sliceHistory(messagesToLlmHistory(previousMessages), config.maxHistoryMessages);
		savedUserMessageId = await saveUserMessage(chatId, question);
		bodyForAgent = {
			question,
			history,
			filters,
			autoApproveToolNames: config.autoApproveToolNames
		};
	}

	const ctx = makeContext(
		{
			userId: config.userId,
			isAdmin: config.isAdmin,
			chatId,
			workspaceId: config.workspaceId,
			autoApproveToolNames: config.autoApproveToolNames
		},
		logger,
		filters
	);

	logger.info('agent.run', { chatId, regenerate: !!config.regenerate });

	return createStreamingResponse(bodyForAgent, ctx, {
		chatId,
		kind: 'ask',
		savedUserMessageId
	});
}

// ---------------------------------------------------------------------------
// confirmTool — handles tool approval/denial and resumes the loop (SSE streaming)
// ---------------------------------------------------------------------------

export async function confirmTool(config: ConfirmRunConfig): Promise<Response> {
	if (!config.workspaceId?.trim()) {
		throw error(400, 'workspaceId is required');
	}

	const logger = new AgentLogger();

	const taken = await takePendingConfirmation(config.userId, config.pendingId);
	if (!taken) throw error(404, 'Confirmation expired or not found');
	if (config.chatId && config.chatId !== taken.chatSessionId) throw error(400, 'Chat mismatch');

	const { payload } = taken;
	const chatId = taken.chatSessionId;

	const agent = getMediaAgent();
	const runState = await RunState.fromString(agent, payload.runState);

	// Approve or reject the interruption
	const interruptions = runState.getInterruptions();
	if (interruptions.length > 0) {
		const interruption = interruptions[0];
		if (config.approved) {
			runState.approve(interruption);
		} else {
			runState.reject(interruption, {
				message:
					'User declined this action. Acknowledge briefly and offer alternatives (or ask what they would like instead). Do not call the same destructive tool again unless the user clearly asks.'
			});
		}
	}

	const ctx = makeContext(
		{
			userId: config.userId,
			isAdmin: config.isAdmin,
			chatId,
			workspaceId: config.workspaceId,
			autoApproveToolNames: config.autoApproveToolNames
		},
		logger
	);

	logger.info('agent.confirm', { chatId, approved: config.approved });

	return createConfirmStreamingResponse(runState, ctx, {
		chatId,
		kind: 'confirm'
	});
}
