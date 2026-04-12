import { error } from '@sveltejs/kit';
import { runAgent } from '$lib/server/agent';
import { normalizeAutoApproveToolNames } from '$lib/server/agent/auto-approve-tools';
import type { TransportMode } from '$lib/server/agent/types';
import { ensureDefaultWorkspaceMembership } from '$lib/server/services/workspace';
import type { RequestHandler } from './$types';

interface AskRequestBody {
	question?: string;
	chatId?: string;
	filters?: Record<string, unknown>;
	stream?: boolean;
	regenerate?: boolean;
	maxHistoryMessages?: number;
	background?: boolean;
	autoApproveToolNames?: unknown;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const user = locals.user;

	const body = (await request.json().catch(() => null)) as AskRequestBody | null;
	if (!body) throw error(400, 'Invalid JSON body');

	const regenerate = body.regenerate === true;
	if (!regenerate && !body.question?.trim()) throw error(400, 'Question is required');

	const maxHistory =
		typeof body.maxHistoryMessages === 'number' &&
		Number.isFinite(body.maxHistoryMessages) &&
		body.maxHistoryMessages > 0
			? Math.floor(body.maxHistoryMessages)
			: undefined;

	const mode: TransportMode = body.background ? 'background' : body.stream ? 'stream' : 'sync';

	const autoApproveToolNames = normalizeAutoApproveToolNames(body.autoApproveToolNames);

	// Legacy route: auto-resolve to default workspace for backward compat
	const workspaceId = await ensureDefaultWorkspaceMembership(user.id);

	return runAgent(
		body.question ?? '',
		{
			userId: user.id,
			isAdmin: user.role === 'ADMIN',
			chatId: body.chatId,
			mode,
			regenerate,
			maxHistoryMessages: maxHistory,
			autoApproveToolNames,
			workspaceId
		},
		body.filters as import('$lib/server/agent/types').AskFilters | undefined
	);
};
