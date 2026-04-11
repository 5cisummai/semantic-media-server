import { error, json } from '@sveltejs/kit';
import {
	createChatForUser,
	listChatsForUser,
	titleFromQuestion
} from '$lib/server/chat-store';
import { dedupeChatsById } from '$lib/utils.js';
import { getActiveRunForChat } from '$lib/server/agent-runs';
import type { RequestHandler } from './$types';

interface CreateChatRequest {
	title?: string;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const chats = await listChatsForUser(locals.user.id);
	const userId = locals.user.id;

	const chatsWithStatus = await Promise.all(
		chats.map(async (chat) => {
			const run = await getActiveRunForChat(chat.id, userId);
			const status: 'idle' | 'working' | 'done' = run
				? run.status === 'DONE' || run.status === 'FAILED'
					? 'done'
					: 'working'
				: 'idle';
			return { ...chat, status };
		})
	);

	return json({ chats: dedupeChatsById(chatsWithStatus) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = (await request.json().catch(() => null)) as CreateChatRequest | null;
	const chat = await createChatForUser(locals.user.id, titleFromQuestion(body?.title ?? ''));

	return json({ chat }, { status: 201 });
};
