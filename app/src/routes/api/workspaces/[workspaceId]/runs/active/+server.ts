import { error, json } from '@sveltejs/kit';
import { getActiveRunForChat, toApiStatus } from '$lib/server/agent-runs';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { workspaceId } = await requireWorkspaceAccess(event);

	const chatId = event.url.searchParams.get('chatId');
	if (!chatId) throw error(400, 'chatId query parameter is required');

	const run = await getActiveRunForChat(chatId);
	if (!run) {
		return json({ run: null });
	}

	// Ensure the run belongs to this workspace
	if (run.workspaceId !== workspaceId) {
		return json({ run: null });
	}

	return json({
		run: {
			id: run.id,
			chatId: run.chatId,
			status: toApiStatus(run.status),
			error: run.error ?? null,
			pendingToolConfirmation: run.pendingToolConfirmation ?? null,
			toolStreamLog: run.toolStreamLog ?? [],
			steps: run.steps ?? [],
			createdAt: run.createdAt,
			updatedAt: run.updatedAt
		}
	});
};
