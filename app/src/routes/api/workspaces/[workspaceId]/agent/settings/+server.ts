import { json } from '@sveltejs/kit';
import { parseBody, updateAgentPreferencesSchema } from '$lib/server/api';
import { getAgentPreference, setAgentPreference } from '$lib/server/agent-settings';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const preference = await getAgentPreference(userId, workspaceId);
	return json(preference);
};

export const PUT: RequestHandler = async (event) => {
	const { workspaceId, userId } = await requireWorkspaceAccess(event, 'MEMBER');
	const body = await parseBody(event.request, updateAgentPreferencesSchema);
	const preference = await setAgentPreference(userId, workspaceId, {
		autoApproveToolNames: body.autoApproveToolNames
	});
	return json(preference);
};
