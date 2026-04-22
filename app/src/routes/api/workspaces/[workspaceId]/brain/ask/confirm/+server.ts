import { confirmTool } from '$lib/server/agent';
import { normalizeAutoApproveToolNames } from '$lib/server/agent/auto-approve-tools';
import { confirmToolSchema, parseBody } from '$lib/server/api';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const user = event.locals.user!;

	const body = await parseBody(event.request, confirmToolSchema);

	const autoApproveToolNames = normalizeAutoApproveToolNames(body.autoApproveToolNames);

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
