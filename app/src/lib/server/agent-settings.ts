import { db } from '$lib/server/db';
import { normalizeAutoApproveToolNames } from '$lib/server/agent/auto-approve-tools';

export interface AgentPreference {
	autoApproveToolNames: string[];
}

function normalizeStoredAutoApprove(raw: unknown): string[] {
	const normalized = normalizeAutoApproveToolNames(raw);
	return normalized ?? [];
}

export async function getAgentPreference(
	userId: string,
	workspaceId: string
): Promise<AgentPreference> {
	const row = await db.agentPreference.findUnique({
		where: { userId_workspaceId: { userId, workspaceId } },
		select: { autoApproveToolNames: true }
	});
	return {
		autoApproveToolNames: normalizeStoredAutoApprove(row?.autoApproveToolNames)
	};
}

export async function setAgentPreference(
	userId: string,
	workspaceId: string,
	input: { autoApproveToolNames: unknown }
): Promise<AgentPreference> {
	const autoApproveToolNames = normalizeStoredAutoApprove(input.autoApproveToolNames);
	const row = await db.agentPreference.upsert({
		where: { userId_workspaceId: { userId, workspaceId } },
		update: { autoApproveToolNames },
		create: { userId, workspaceId, autoApproveToolNames },
		select: { autoApproveToolNames: true }
	});
	return {
		autoApproveToolNames: normalizeStoredAutoApprove(row.autoApproveToolNames)
	};
}

export async function mergeAgentAutoApproveToolNames(
	userId: string,
	workspaceId: string,
	requestNames: unknown
): Promise<string[]> {
	const stored = await getAgentPreference(userId, workspaceId);
	const requested = normalizeStoredAutoApprove(requestNames);
	if (!stored.autoApproveToolNames.length) return requested;
	if (!requested.length) return stored.autoApproveToolNames;
	const merged = new Set<string>([...stored.autoApproveToolNames, ...requested]);
	return [...merged];
}
