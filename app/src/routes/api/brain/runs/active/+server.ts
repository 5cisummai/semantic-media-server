import { error, json } from '@sveltejs/kit';
import { getActiveBackgroundRunForChat } from '$lib/server/background-agent-runs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const chatId = url.searchParams.get('chatId')?.trim();
	if (!chatId) throw error(400, 'chatId is required');

	const run = getActiveBackgroundRunForChat(locals.user.id, chatId);
	if (!run) {
		return json({ run: null });
	}

	return json({
		run: {
			id: run.id,
			chatId: run.chatId,
			kind: run.kind,
			status: run.status,
			error: run.error ?? null,
			pendingToolConfirmation: run.pendingToolConfirmation ?? null,
			toolStreamLog: run.toolStreamLog ?? [],
			createdAt: run.createdAt,
			updatedAt: run.updatedAt
		}
	});
};
