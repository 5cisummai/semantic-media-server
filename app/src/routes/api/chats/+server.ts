import { json } from '@sveltejs/kit';
import {
	createChatForUser,
	listChatsWithStatusForUser,
	titleFromQuestion
} from '$lib/server/chat-store';
import { requireAuth } from '$lib/server/api';
import type { RequestHandler } from './$types';

interface CreateChatRequest {
	title?: string;
}

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireAuth(locals);
	return json({ chats: await listChatsWithStatusForUser(user.id) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireAuth(locals);

	const body = (await request.json().catch(() => null)) as CreateChatRequest | null;
	const chat = await createChatForUser(user.id, titleFromQuestion(body?.title ?? ''));

	return json({ chat }, { status: 201 });
};
