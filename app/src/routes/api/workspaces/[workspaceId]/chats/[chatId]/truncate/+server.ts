import { error, json } from '@sveltejs/kit';
import { deleteMessagesFromMessageId } from '$lib/server/chat-store';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');

	const chatId = event.params.chatId;
	if (!chatId) throw error(400, 'Chat id is required');

	const body = (await event.request.json().catch(() => null)) as { fromMessageId?: string } | null;
	const fromMessageId = body?.fromMessageId?.trim();
	if (!fromMessageId) {
		throw error(400, 'fromMessageId is required');
	}

	try {
		await deleteMessagesFromMessageId(userId, chatId, fromMessageId, workspaceId);
		return json({ ok: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === 'Message not found' || msg === 'Chat not found') {
			throw error(404, msg);
		}
		throw error(500, 'Failed to truncate messages');
	}
};
