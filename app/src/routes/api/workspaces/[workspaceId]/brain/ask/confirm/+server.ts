import { confirmTool } from '$lib/server/agent';
import { mergeAgentAutoApproveToolNames } from '$lib/server/agent-settings';
import { confirmToolSchema, parseBody } from '$lib/server/api';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const user = event.locals.user!;

	const body = await parseBody(event.request, confirmToolSchema);

	const autoApproveToolNames = await mergeAgentAutoApproveToolNames(
		userId,
		workspaceId,
		body.autoApproveToolNames
	);

	return confirmTool({
		userId,
		isAdmin: user.role === 'ADMIN',
		pendingId: body.pendingId,
		approved: body.approved,
		chatId: body.chatId,
		workspaceId,
		autoApproveToolNames
	});
};
