import { error } from '@sveltejs/kit';
import { runAgent } from '$lib/server/agent';
import { normalizeAutoApproveToolNames } from '$lib/server/agent/auto-approve-tools';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

interface AskRequestBody {
	question?: string;
	chatId?: string;
	filters?: Record<string, unknown>;
	regenerate?: boolean;
	maxHistoryMessages?: number;
	autoApproveToolNames?: unknown;
}

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const user = event.locals.user!;

	const body = (await event.request.json().catch(() => null)) as AskRequestBody | null;
	if (!body) throw error(400, 'Invalid JSON body');

	const regenerate = body.regenerate === true;
	if (!regenerate && !body.question?.trim()) throw error(400, 'Question is required');

	const maxHistory =
		typeof body.maxHistoryMessages === 'number' &&
		Number.isFinite(body.maxHistoryMessages) &&
		body.maxHistoryMessages > 0
			? Math.floor(body.maxHistoryMessages)
			: undefined;

	const autoApproveToolNames = normalizeAutoApproveToolNames(body.autoApproveToolNames);

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
		body.filters as import('$lib/server/agent/types').AskFilters | undefined
	);
};
