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

	const role = await getOptionalWorkspaceRole(workspaceId, user.id, minRole);
	if (!role) throw error(403, 'Forbidden');
	return { workspaceId, userId: user.id, role };
}

async function getOptionalWorkspaceRole(
	workspaceId: string | null | undefined,
	userId: string,
	minRole: WorkspaceRole
): Promise<WorkspaceRole | null> {
	if (!workspaceId) return null;

	try {
		return await requireMembership(workspaceId, userId, minRole);
	} catch {
		return null;
	}
}

export async function resolveOptionalWorkspaceContext(
	workspaceId: string | null | undefined,
	userId: string,
	minRole: WorkspaceRole = 'VIEWER'
): Promise<string | null> {
	const role = await getOptionalWorkspaceRole(workspaceId, userId, minRole);
	return role ? (workspaceId ?? null) : null;
}

export async function requireOptionalWorkspaceAccess(
	workspaceId: string | null | undefined,
	userId: string,
	minRole: WorkspaceRole = 'VIEWER',
	denialMessage = 'Access denied'
): Promise<string | null> {
	if (!workspaceId) return null;

	const role = await getOptionalWorkspaceRole(workspaceId, userId, minRole);
	if (!role) throw error(403, denialMessage);
	return workspaceId;
}
