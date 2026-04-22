import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createChatSchema, parseOptionalBody } from '$lib/server/api';
import { titleForNewChat, withChatStatuses } from '$lib/server/chat-store';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { workspaceId } = await requireWorkspaceAccess(event);

	const chats = await db.chatSession.findMany({
		where: { workspaceId },
		orderBy: { updatedAt: 'desc' },
		take: 100,
		select: {
			id: true,
			title: true,
			userId: true,
			createdAt: true,
			updatedAt: true,
			_count: { select: { messages: true } }
		}
	});

	return json({
		chats: await withChatStatuses(
			chats.map((chat) => ({
				id: chat.id,
				title: chat.title,
				userId: chat.userId,
				createdAt: chat.createdAt.toISOString(),
				updatedAt: chat.updatedAt.toISOString(),
				messageCount: chat._count.messages
			}))
		)
	});
};

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');

	const body = await parseOptionalBody(event.request, createChatSchema);
	const title = titleForNewChat(body?.title);

	const chat = await db.chatSession.create({
		data: {
			userId,
			workspaceId,
			title
		},
		select: {
			id: true,
			title: true,
			createdAt: true,
			updatedAt: true
		}
	});

	return json(
		{
			chat: {
				id: chat.id,
				title: chat.title,
				createdAt: chat.createdAt.toISOString(),
				updatedAt: chat.updatedAt.toISOString(),
				messageCount: 0
			}
		},
		{ status: 201 }
	);
};
