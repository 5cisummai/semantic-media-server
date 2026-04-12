import { error, json } from '@sveltejs/kit';
import { ensureOwnedChatSession, getChatMessagesForUser } from '$lib/server/chat-store';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const chatId = params.chatId;
	if (!chatId) throw error(400, 'Chat id is required');

	try {
		const chat = await ensureOwnedChatSession(locals.user.id, chatId);
		const messages = await getChatMessagesForUser(locals.user.id, chatId);
		return json({ chat, messages });
	} catch {
		throw error(404, 'Chat not found');
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const chatId = params.chatId;
	if (!chatId) throw error(400, 'Chat id is required');

	try {
		await ensureOwnedChatSession(locals.user.id, chatId);
		await db.chatSession.delete({ where: { id: chatId } });
		return json({ success: true });
	} catch {
		throw error(404, 'Chat not found');
	}
};
