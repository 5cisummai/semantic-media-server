import { error } from '@sveltejs/kit';
import { confirmTool } from '$lib/server/agent';
import { normalizeAutoApproveToolNames } from '$lib/server/agent/auto-approve-tools';
import type { TransportMode } from '$lib/server/agent/types';
import type { RequestHandler } from './$types';

interface ConfirmBody {
	pendingId: string;
	approved: boolean;
	chatId?: string;
	stream?: boolean;
	background?: boolean;
	autoApproveToolNames?: unknown;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const user = locals.user;

	const body = (await request.json().catch(() => null)) as ConfirmBody | null;
	if (!body?.pendingId || typeof body.approved !== 'boolean') {
		throw error(400, 'pendingId and approved are required');
	}

	const mode: TransportMode = body.background ? 'background' : body.stream ? 'stream' : 'sync';

	const autoApproveToolNames = normalizeAutoApproveToolNames(body.autoApproveToolNames);

	return confirmTool({
		userId: user.id,
		isAdmin: user.role === 'ADMIN',
		pendingId: body.pendingId,
		approved: body.approved,
		chatId: body.chatId,
		mode,
		autoApproveToolNames
	});
};
