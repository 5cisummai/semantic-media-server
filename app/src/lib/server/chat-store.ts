import { randomInt } from 'node:crypto';
import { db } from '$lib/server/db';
import type { Prisma } from '@prisma/client';
import type { ConversationMessage, StoredChatMessage } from '$lib/server/agent/types';
import { getActiveRunForChat } from '$lib/server/agent-runs';
import { summarizePromptAsChatTitle } from '$lib/server/services/llm';
import { dedupeChatsById } from '$lib/utils.js';

const UNTITLED_CHAT = 'New chat';
const MAX_TITLE_LENGTH = 120;

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

export type ChatStatus = 'idle' | 'working' | 'done';
export type ChatSummaryWithStatus = ChatSummary & { status: ChatStatus };

export type { StoredChatMessage } from '$lib/server/agent/types';

type ChatMessageMeta = {
	sources?: unknown;
	toolCalls?: unknown;
	model?: string;
	iterations?: number;
};

function sanitizeTitle(title: string): string {
	return title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

/** Short word lists for human-readable session names (not derived from the first prompt). */
const CHAT_TITLE_ADJECTIVES = [
	'Quiet',
	'Calm',
	'Bright',
	'Gentle',
	'Swift',
	'Clear',
	'Soft',
	'Bold',
	'Cool',
	'Warm',
	'Deep',
	'Light',
	'Fresh',
	'Keen',
	'Fine',
	'Grand',
	'Noble',
	'Quick',
	'Steady',
	'Wild',
	'Azure',
	'Cedar',
	'Crimson',
	'Golden',
	'Jade',
	'Silver',
	'Velvet',
	'Winter',
	'Summer',
	'Morning',
	'Evening'
] as const;

const CHAT_TITLE_NOUNS = [
	'Harbor',
	'Meadow',
	'Canvas',
	'Beacon',
	'Compass',
	'Anchor',
	'Current',
	'Drift',
	'Fjord',
	'Glacier',
	'Horizon',
	'Island',
	'Lagoon',
	'Mirror',
	'Orchard',
	'Pinnacle',
	'Quartz',
	'Ridge',
	'Summit',
	'Tide',
	'Voyage',
	'Willow',
	'Zephyr',
	'Atlas',
	'Birch',
	'Cove',
	'Dune',
	'Eagle',
	'Falcon',
	'Garden'
] as const;

/**
 * Random two-word title for new agent sessions (not the user's first message).
 */
export function generateChatTitle(): string {
	const adj = CHAT_TITLE_ADJECTIVES[randomInt(CHAT_TITLE_ADJECTIVES.length)];
	const noun = CHAT_TITLE_NOUNS[randomInt(CHAT_TITLE_NOUNS.length)];
	return sanitizeTitle(`${adj} ${noun}`);
}

/**
 * Title for a newly created chat: explicit user title if provided, otherwise {@link generateChatTitle}.
 */
export function titleForNewChat(explicitTitle?: string | null): string {
	const normalized = sanitizeTitle(explicitTitle ?? '');
	if (normalized) return normalized;
	return generateChatTitle();
}

function normalizeLlmChatTitle(raw: string): string {
	const firstLine = raw.split('\n')[0] ?? raw;
	let t = sanitizeTitle(firstLine.replace(/\s+/g, ' '));
	t = t.replace(/^["'«»\u201c\u201d]+|["'«»\u201c\u201d]+$/g, '').trim();
	return sanitizeTitle(t);
}

async function titleFromFirstUserMessage(firstMessage: string): Promise<string> {
	try {
		const raw = await summarizePromptAsChatTitle(firstMessage);
		const t = normalizeLlmChatTitle(raw);
		if (t) return t;
	} catch {
		// fall back below
	}
	return generateChatTitle();
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

export async function withChatStatuses<T extends { id: string }>(
	items: T[],
	userId?: string
): Promise<Array<T & { status: ChatStatus }>> {
	const itemsWithStatus = await Promise.all(
		items.map(async (item) => {
			const run = await getActiveRunForChat(item.id, userId);
			const status: ChatStatus = run
				? run.status === 'DONE' || run.status === 'FAILED'
					? 'done'
					: 'working'
				: 'idle';

			return { ...item, status };
		})
	);

	return dedupeChatsById(itemsWithStatus);
}

export async function createChatForUser(
	userId: string,
	title: string,
	workspaceId?: string | null
): Promise<ChatSummary> {
	const row = await db.chatSession.create({
		data: {
			userId,
			title: sanitizeTitle(title) || UNTITLED_CHAT,
			...(workspaceId ? { workspaceId } : {})
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
	chatId: string,
	workspaceId?: string | null
): Promise<{ id: string; title: string }> {
	const where =
		workspaceId !== undefined && workspaceId !== null
			? { id: chatId, userId, workspaceId }
			: { id: chatId, userId };

	const row = await db.chatSession.findFirst({
		where,
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
	fromMessageId: string,
	workspaceId?: string | null
): Promise<void> {
	await ensureOwnedChatSession(userId, chatId, workspaceId);

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
	firstMessage: string,
	workspaceId?: string | null
): Promise<ChatSummary> {
	if (chatId) {
		const row = await ensureOwnedChatSession(userId, chatId, workspaceId);
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

	const title = await titleFromFirstUserMessage(firstMessage);
	return createChatForUser(userId, title, workspaceId);
}
