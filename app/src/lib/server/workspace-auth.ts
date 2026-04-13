import { error } from '@sveltejs/kit';
import { requireMembership } from '$lib/server/services/workspace';
import type { WorkspaceRole } from '@prisma/client';

export type { WorkspaceRole };

/**
 * Validate workspace membership from a SvelteKit request event.
 * Returns the workspace ID and user's role.
 */
export async function requireWorkspaceAccess(
	event: { locals: App.Locals; params: Record<string, string> },
	minRole: WorkspaceRole = 'VIEWER'
): Promise<{ workspaceId: string; userId: string; role: WorkspaceRole }> {
	const user = event.locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const workspaceId = event.params.workspaceId;
	if (!workspaceId) throw error(400, 'workspaceId is required');

	try {
		const role = await requireMembership(workspaceId, user.id, minRole);
		return { workspaceId, userId: user.id, role };
	} catch {
		throw error(403, 'Forbidden');
	}
}
