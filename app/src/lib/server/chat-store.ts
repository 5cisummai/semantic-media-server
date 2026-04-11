import { db } from '$lib/server/db';
import type { Prisma } from '@prisma/client';
import type { ConversationMessage } from '$lib/server/agent/types';

const UNTITLED_CHAT = 'New chat';
const MAX_TITLE_LENGTH = 120;
const MAX_LIST_CHATS = 100;

type ChatSessionRow = {
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	_count: { messages: number };
};

type ChatSessionBaseRow = {
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
};

type ChatMessageRow = {
	id: string;
	role: 'USER' | 'ASSISTANT';
	content: string;
	sources: Prisma.JsonValue | null;
	toolCalls: Prisma.JsonValue | null;
	model: string | null;
	iterations: number | null;
	createdAt: Date;
};

export type ChatSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
};

export type StoredChatMessage = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	sources?: unknown;
	toolCalls?: unknown;
	model?: string | null;
	iterations?: number | null;
	createdAt: string;
};

type ChatMessageMeta = {
	sources?: unknown;
	toolCalls?: unknown;
	model?: string;
	iterations?: number;
};

function sanitizeTitle(title: string): string {
	return title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

export function titleFromQuestion(question: string): string {
	const normalized = sanitizeTitle(question);
	if (!normalized) return UNTITLED_CHAT;
	return normalized;
}

function toStoredMessage(row: ChatMessageRow): StoredChatMessage {
	return {
		id: row.id,
		role: row.role === 'USER' ? 'user' : 'assistant',
		content: row.content,
		...(row.sources !== null ? { sources: row.sources } : {}),
		...(row.toolCalls !== null ? { toolCalls: row.toolCalls } : {}),
		...(row.model !== null ? { model: row.model } : {}),
		...(row.iterations !== null ? { iterations: row.iterations } : {}),
		createdAt: row.createdAt.toISOString()
	};
}

export function messagesToLlmHistory(messages: StoredChatMessage[]): ConversationMessage[] {
	return messages.map((message) => ({
		role: message.role,
		content: message.content
	}));
}

export async function listChatsForUser(userId: string): Promise<ChatSummary[]> {
	const rows = await db.chatSession.findMany({
		where: { userId },
		orderBy: { updatedAt: 'desc' },
		take: MAX_LIST_CHATS,
		select: {
			id: true,
			title: true,
			createdAt: true,
			updatedAt: true,
			_count: {
				select: { messages: true }
			}
		}
	});

	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		messageCount: row._count.messages
	}));
}

export async function createChatForUser(userId: string, title: string): Promise<ChatSummary> {
	const row = await db.chatSession.create({
		data: {
			userId,
			title: sanitizeTitle(title) || UNTITLED_CHAT
		},
		select: {
			id: true,
			title: true,
			createdAt: true,
			updatedAt: true
		}
	});

	return {
		id: row.id,
		title: row.title,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		messageCount: 0
	};
}

export async function ensureOwnedChatSession(
	userId: string,
	chatId: string
): Promise<{ id: string; title: string }> {
	const row = await db.chatSession.findFirst({
		where: {
			id: chatId,
			userId
		},
		select: {
			id: true,
			title: true
		}
	});

	if (!row) {
		throw new Error('Chat not found');
	}

	return row;
}

export async function getChatMessagesForUser(
	userId: string,
	chatId: string
): Promise<StoredChatMessage[]> {
	await ensureOwnedChatSession(userId, chatId);

	const rows = await db.chatMessage.findMany({
		where: { chatSessionId: chatId },
		orderBy: { createdAt: 'asc' },
		select: {
			id: true,
			role: true,
			content: true,
			sources: true,
			toolCalls: true,
			model: true,
			iterations: true,
			createdAt: true
		}
	});

	return rows.map(toStoredMessage);
}

export async function saveUserMessage(chatId: string, content: string): Promise<string | null> {
	const trimmed = content.trim();
	if (!trimmed) return null;

	const row = await db.chatMessage.create({
		data: {
			chatSessionId: chatId,
			role: 'USER',
			content: trimmed
		},
		select: { id: true }
	});

	await db.chatSession.update({
		where: { id: chatId },
		data: { updatedAt: new Date() }
	});

	return row.id;
}

export async function saveAssistantMessage(
	chatId: string,
	content: string,
	meta?: ChatMessageMeta
): Promise<string | null> {
	const trimmed = content.trim();
	if (!trimmed) return null;

	const row = await db.chatMessage.create({
		data: {
			chatSessionId: chatId,
			role: 'ASSISTANT',
			content: trimmed,
			sources: meta?.sources as Prisma.InputJsonValue | undefined,
			toolCalls: meta?.toolCalls as Prisma.InputJsonValue | undefined,
			model: meta?.model,
			iterations: meta?.iterations
		},
		select: { id: true }
	});

	await db.chatSession.update({
		where: { id: chatId },
		data: { updatedAt: new Date() }
	});

	return row.id;
}

/**
 * Deletes the anchor message and every message after it (by chat order).
 * Used when editing a user message or regenerating an assistant reply.
 */
export async function deleteMessagesFromMessageId(
	userId: string,
	chatId: string,
	fromMessageId: string
): Promise<void> {
	await ensureOwnedChatSession(userId, chatId);

	const rows = await db.chatMessage.findMany({
		where: { chatSessionId: chatId },
		orderBy: { createdAt: 'asc' },
		select: { id: true }
	});

	const idx = rows.findIndex((r: { id: string }) => r.id === fromMessageId);
	if (idx === -1) {
		throw new Error('Message not found');
	}

	const ids = rows.slice(idx).map((r: { id: string }) => r.id);
	if (ids.length === 0) return;

	await db.chatMessage.deleteMany({
		where: { id: { in: ids } }
	});

	await db.chatSession.update({
		where: { id: chatId },
		data: { updatedAt: new Date() }
	});
}

export async function resolveOrCreateChat(
	userId: string,
	chatId: string | undefined,
	question: string
): Promise<ChatSummary> {
	if (chatId) {
		const row = await ensureOwnedChatSession(userId, chatId);
		const found = await db.chatSession.findUniqueOrThrow({
			where: { id: row.id },
			select: {
				id: true,
				title: true,
				createdAt: true,
				updatedAt: true,
				_count: { select: { messages: true } }
			}
		});
		return {
			id: found.id,
			title: found.title,
			createdAt: found.createdAt.toISOString(),
			updatedAt: found.updatedAt.toISOString(),
			messageCount: found._count.messages
		};
	}

	return createChatForUser(userId, titleFromQuestion(question));
}
