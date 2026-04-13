import { error, json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { requireMembership } from '$lib/server/services/workspace';
import {
	ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
	ACTIVE_WORKSPACE_COOKIE_NAME
} from '$lib/workspace-state';
import type { RequestHandler } from './$types';

type ActiveWorkspacePayload = { workspaceId?: string | null };

const cookieBaseOpts = {
	path: '/',
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const
};

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const user = await requireAuth(locals);
	const body = (await request.json().catch(() => null)) as ActiveWorkspacePayload | null;
	const workspaceId = body?.workspaceId ?? null;

	if (workspaceId !== null && typeof workspaceId !== 'string') {
		throw error(400, 'workspaceId must be a string or null');
	}

	if (workspaceId === null || workspaceId === '') {
		cookies.delete(ACTIVE_WORKSPACE_COOKIE_NAME, cookieBaseOpts);
		return json({ ok: true, activeWorkspaceId: null });
	}

	try {
		await requireMembership(workspaceId, user.id, 'VIEWER');
	} catch {
		throw error(403, 'Forbidden');
	}

	cookies.set(ACTIVE_WORKSPACE_COOKIE_NAME, workspaceId, {
		...cookieBaseOpts,
		maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE
	});

	return json({ ok: true, activeWorkspaceId: workspaceId });
};
