import { error } from '@sveltejs/kit';
import { confirmTool } from '$lib/server/agent';
import { normalizeAutoApproveToolNames } from '$lib/server/agent/auto-approve-tools';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

interface ConfirmBody {
	pendingId: string;
	approved: boolean;
	chatId?: string;
	autoApproveToolNames?: unknown;
}

export const POST: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const user = event.locals.user!;

	const body = (await event.request.json().catch(() => null)) as ConfirmBody | null;
	if (!body?.pendingId || typeof body.approved !== 'boolean') {
		throw error(400, 'pendingId and approved are required');
	}

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
