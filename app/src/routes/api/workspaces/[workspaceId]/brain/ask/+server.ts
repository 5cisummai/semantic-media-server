import { error } from '@sveltejs/kit';
import { runAgent } from '$lib/server/agent';
import { mergeAgentAutoApproveToolNames } from '$lib/server/agent-settings';
import { askRequestSchema, parseBody } from '$lib/server/api';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const user = event.locals.user!;

	const body = await parseBody(event.request, askRequestSchema);

	const regenerate = body.regenerate === true;
	if (!regenerate && !body.question?.trim()) throw error(400, 'Question is required');

	const maxHistory =
		typeof body.maxHistoryMessages === 'number' &&
		Number.isFinite(body.maxHistoryMessages) &&
		body.maxHistoryMessages > 0
			? Math.floor(body.maxHistoryMessages)
			: undefined;

	const autoApproveToolNames = await mergeAgentAutoApproveToolNames(
		userId,
		workspaceId,
		body.autoApproveToolNames
	);

	return runAgent(
		body.question ?? '',
		{
			userId,
			isAdmin: user.role === 'ADMIN',
			chatId: body.chatId,
			workspaceId,
			regenerate,
			maxHistoryMessages: maxHistory,
			autoApproveToolNames
		},
		body.filters
	);
};
