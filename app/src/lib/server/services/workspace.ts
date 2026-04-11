import { db } from '$lib/server/db';
import type { WorkspaceRole } from '@prisma/client';
import { ensureWorkspaceDir, removeWorkspaceStorage } from '$lib/server/services/workspace-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	role: WorkspaceRole;
	createdAt: string;
	updatedAt: string;
	memberCount: number;
}

export interface WorkspaceDetail extends WorkspaceSummary {
	members: WorkspaceMemberInfo[];
}

export interface WorkspaceMemberInfo {
	id: string;
	userId: string;
	username: string;
	displayName: string;
	role: WorkspaceRole;
	joinedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEFAULT_WORKSPACE_SLUG = 'default';

// Role hierarchy for permission checks (higher index = more powerful)
const ROLE_HIERARCHY: WorkspaceRole[] = ['VIEWER', 'MEMBER', 'ADMIN'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleIndex(role: WorkspaceRole): number {
	return ROLE_HIERARCHY.indexOf(role);
}

function validateSlug(slug: string): void {
	if (!slug || slug.length < 2 || slug.length > 64) {
		throw new Error('Workspace slug must be 2–64 characters');
	}
	if (!SLUG_REGEX.test(slug)) {
		throw new Error('Workspace slug must be lowercase alphanumeric with hyphens');
	}
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createWorkspace(
	name: string,
	slug: string,
	creatorUserId: string,
	description?: string
): Promise<WorkspaceSummary> {
	validateSlug(slug);

	const workspace = await db.workspace.create({
		data: {
			name: name.trim(),
			slug,
			description: description?.trim() || null,
			members: {
				create: {
					userId: creatorUserId,
					role: 'ADMIN'
				}
			}
		},
		include: {
			_count: { select: { members: true } }
		}
	});

	try {
		await ensureWorkspaceDir(workspace.id);
	} catch (storageError) {
		try {
			await db.workspace.delete({ where: { id: workspace.id } });
		} catch (rollbackError) {
			const storageMessage =
				storageError instanceof Error ? storageError.message : 'Unknown storage error';
			const rollbackMessage =
				rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error';
			throw new Error(
				`Failed to initialize workspace storage: ${storageMessage}. Rollback failed: ${rollbackMessage}`
			);
		}

		const storageMessage =
			storageError instanceof Error ? storageError.message : 'Unknown storage error';
		throw new Error(`Failed to initialize workspace storage: ${storageMessage}`);
	}

	return {
		id: workspace.id,
		name: workspace.name,
		slug: workspace.slug,
		description: workspace.description,
		role: 'ADMIN',
		createdAt: workspace.createdAt.toISOString(),
		updatedAt: workspace.updatedAt.toISOString(),
		memberCount: workspace._count.members
	};
}

export async function getWorkspace(
	workspaceId: string,
	userId: string
): Promise<WorkspaceDetail> {
	const workspace = await db.workspace.findUnique({
		where: { id: workspaceId },
		include: {
			members: {
				include: {
					user: { select: { id: true, username: true, displayName: true } }
				},
				orderBy: { joinedAt: 'asc' }
			},
			_count: { select: { members: true } }
		}
	});

	if (!workspace) {
		throw new Error('Workspace not found');
	}

	const membership = workspace.members.find((m) => m.userId === userId);
	if (!membership) {
		throw new Error('Not a member of this workspace');
	}

	return {
		id: workspace.id,
		name: workspace.name,
		slug: workspace.slug,
		description: workspace.description,
		role: membership.role,
		createdAt: workspace.createdAt.toISOString(),
		updatedAt: workspace.updatedAt.toISOString(),
		memberCount: workspace._count.members,
		members: workspace.members.map((m) => ({
			id: m.id,
			userId: m.user.id,
			username: m.user.username,
			displayName: m.user.displayName,
			role: m.role,
			joinedAt: m.joinedAt.toISOString()
		}))
	};
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
	const memberships = await db.workspaceMember.findMany({
		where: { userId },
		include: {
			workspace: {
				include: {
					_count: { select: { members: true } }
				}
			}
		},
		orderBy: { workspace: { updatedAt: 'desc' } }
	});

	return memberships.map((m) => ({
		id: m.workspace.id,
		name: m.workspace.name,
		slug: m.workspace.slug,
		description: m.workspace.description,
		role: m.role,
		createdAt: m.workspace.createdAt.toISOString(),
		updatedAt: m.workspace.updatedAt.toISOString(),
		memberCount: m.workspace._count.members
	}));
}

export async function updateWorkspace(
	workspaceId: string,
	data: { name?: string; description?: string | null; slug?: string }
): Promise<void> {
	const update: Record<string, unknown> = {};

	if (data.name !== undefined) update.name = data.name.trim();
	if (data.description !== undefined) {
		update.description = data.description === null ? null : data.description.trim() || null;
	}
	if (data.slug !== undefined) {
		validateSlug(data.slug);
		update.slug = data.slug;
	}

	if (Object.keys(update).length === 0) return;

	await db.workspace.update({ where: { id: workspaceId }, data: update });
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
	// Prevent deleting the default workspace
	const ws = await db.workspace.findUnique({
		where: { id: workspaceId },
		select: { slug: true }
	});
	if (ws?.slug === DEFAULT_WORKSPACE_SLUG) {
		throw new Error('Cannot delete the default workspace');
	}

	await db.workspace.delete({ where: { id: workspaceId } });
	try {
		await removeWorkspaceStorage(workspaceId);
	} catch (storageError) {
		const storageMessage =
			storageError instanceof Error ? storageError.message : 'Unknown storage error';
		throw new Error(`Failed to remove workspace storage: ${storageMessage}`);
	}
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function addMember(
	workspaceId: string,
	userId: string,
	role: WorkspaceRole = 'MEMBER'
): Promise<WorkspaceMemberInfo> {
	const member = await db.workspaceMember.create({
		data: { workspaceId, userId, role },
		include: {
			user: { select: { id: true, username: true, displayName: true } }
		}
	});

	return {
		id: member.id,
		userId: member.user.id,
		username: member.user.username,
		displayName: member.user.displayName,
		role: member.role,
		joinedAt: member.joinedAt.toISOString()
	};
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
	// Prevent removing the last admin
	const admins = await db.workspaceMember.count({
		where: { workspaceId, role: 'ADMIN' }
	});
	const target = await db.workspaceMember.findUnique({
		where: { userId_workspaceId: { userId, workspaceId } },
		select: { role: true }
	});

	if (target?.role === 'ADMIN' && admins <= 1) {
		throw new Error('Cannot remove the last admin from a workspace');
	}

	await db.workspaceMember.delete({
		where: { userId_workspaceId: { userId, workspaceId } }
	});
}

export async function updateMemberRole(
	workspaceId: string,
	userId: string,
	role: WorkspaceRole
): Promise<void> {
	// If demoting the last admin, reject
	if (role !== 'ADMIN') {
		const admins = await db.workspaceMember.count({
			where: { workspaceId, role: 'ADMIN' }
		});
		const current = await db.workspaceMember.findUnique({
			where: { userId_workspaceId: { userId, workspaceId } },
			select: { role: true }
		});
		if (current?.role === 'ADMIN' && admins <= 1) {
			throw new Error('Cannot demote the last admin');
		}
	}

	await db.workspaceMember.update({
		where: { userId_workspaceId: { userId, workspaceId } },
		data: { role }
	});
}

// ---------------------------------------------------------------------------
// Auth guards
// ---------------------------------------------------------------------------

export async function getMemberRole(
	workspaceId: string,
	userId: string
): Promise<WorkspaceRole | null> {
	const member = await db.workspaceMember.findUnique({
		where: { userId_workspaceId: { userId, workspaceId } },
		select: { role: true }
	});
	return member?.role ?? null;
}

/**
 * Assert the user is a member of the workspace with at least `minRole`.
 * Throws if membership check fails.
 */
export async function requireMembership(
	workspaceId: string,
	userId: string,
	minRole: WorkspaceRole = 'VIEWER'
): Promise<WorkspaceRole> {
	const role = await getMemberRole(workspaceId, userId);
	if (!role) {
		throw new Error('Not a member of this workspace');
	}
	if (roleIndex(role) < roleIndex(minRole)) {
		throw new Error(`Requires at least ${minRole} role`);
	}
	return role;
}

// ---------------------------------------------------------------------------
// Default workspace utilities
// ---------------------------------------------------------------------------

export const DEFAULT_WORKSPACE_NAME = 'Default';

export async function getOrCreateDefaultWorkspace(creatorUserId: string): Promise<string> {
	const existing = await db.workspace.findUnique({
		where: { slug: DEFAULT_WORKSPACE_SLUG },
		select: { id: true }
	});
	if (existing) return existing.id;

	const ws = await createWorkspace(
		DEFAULT_WORKSPACE_NAME,
		DEFAULT_WORKSPACE_SLUG,
		creatorUserId
	);
	return ws.id;
}

export async function getDefaultWorkspaceId(): Promise<string | null> {
	const ws = await db.workspace.findUnique({
		where: { slug: DEFAULT_WORKSPACE_SLUG },
		select: { id: true }
	});
	return ws?.id ?? null;
}

/**
 * Ensure the user is a member of the default workspace.
 * Called after signup/approval to auto-enroll.
 */
export async function ensureDefaultWorkspaceMembership(userId: string): Promise<string> {
	const wsId = await getOrCreateDefaultWorkspace(userId);

	const existing = await db.workspaceMember.findUnique({
		where: { userId_workspaceId: { userId, workspaceId: wsId } }
	});
	if (!existing) {
		await db.workspaceMember.create({
			data: { userId, workspaceId: wsId, role: 'MEMBER' }
		});
	}

	return wsId;
}
