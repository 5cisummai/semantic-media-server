import { error, json } from '@sveltejs/kit';
import { parseBody, truncateChatSchema } from '$lib/server/api';
import { deleteMessagesFromMessageId } from '$lib/server/chat-store';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');

	const chatId = event.params.chatId;
	if (!chatId) throw error(400, 'Chat id is required');

	const { fromMessageId } = await parseBody(event.request, truncateChatSchema);

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
