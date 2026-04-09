import { error, json } from '@sveltejs/kit';
import { getBackgroundRunForUser } from '$lib/server/background-agent-runs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const runId = params.runId;
	if (!runId) throw error(400, 'runId is required');

	const run = getBackgroundRunForUser(locals.user.id, runId);
	if (!run) throw error(404, 'Run not found');

	return json({
		id: run.id,
		chatId: run.chatId,
		kind: run.kind,
		status: run.status,
		error: run.error ?? null,
		pendingToolConfirmation: run.pendingToolConfirmation ?? null,
		toolStreamLog: run.toolStreamLog ?? [],
		createdAt: run.createdAt,
		updatedAt: run.updatedAt
	});
};
