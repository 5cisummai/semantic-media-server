import { apiFetch } from '$lib/api-fetch';

const STORAGE_KEY = 'brain.agent.autoApproveToolNames';
const MAX_TOOLS = 32;

function parseStored(): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		const out: string[] = [];
		const seen = new Set<string>();
		for (const x of parsed) {
			if (typeof x !== 'string') continue;
			const n = x.trim().slice(0, 64);
			if (!n || seen.has(n)) continue;
			seen.add(n);
			out.push(n);
			if (out.length >= MAX_TOOLS) break;
		}
		return out;
	} catch {
		return [];
	}
}

function normalizeList(names: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const x of names) {
		const n = x.trim().slice(0, 64);
		if (!n || seen.has(n)) continue;
		seen.add(n);
		out.push(n);
		if (out.length >= MAX_TOOLS) break;
	}
	return out;
}

function persist(names: string[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeList(names)));
	} catch {
		/* ignore quota */
	}
}

/** Tool names the user chose to run without confirmation (this browser only). */
export function getAutoApproveToolNames(): string[] {
	return parseStored();
}

// ---------------------------------------------------------------------------
// Settings UI: grouped options (move = unified `move` tool)
// ---------------------------------------------------------------------------

export type AutoApproveSettingId = 'delete_file' | 'move' | 'copy_file' | 'mkdir';

export const AUTO_APPROVE_SETTINGS: Array<{
	id: AutoApproveSettingId;
	label: string;
	description: string;
}> = [
	{
		id: 'delete_file',
		label: 'Delete',
		description: 'Move files or folders to Trash (.trash on the media root).'
	},
	{
		id: 'move',
		label: 'Move',
		description: 'Move, rename, or batch-move files within your library.'
	},
	{
		id: 'copy_file',
		label: 'Copy',
		description: 'Copy files or folders to a new path.'
	},
	{
		id: 'mkdir',
		label: 'Create folders',
		description: 'Create new directories under a media root.'
	}
];

function toolsForSetting(id: AutoApproveSettingId): string[] {
	if (id === 'move') return ['move'];
	return [id];
}

const LEGACY_MOVE_NAMES = ['move_file', 'move_files'] as const;

export function isAutoApproveSettingEnabledInList(
	id: AutoApproveSettingId,
	names: string[]
): boolean {
	if (id === 'move') {
		return names.includes('move') || (names.includes('move_file') && names.includes('move_files'));
	}
	return toolsForSetting(id).every((tool) => names.includes(tool));
}

export function setAutoApproveSettingInList(
	id: AutoApproveSettingId,
	enabled: boolean,
	names: string[]
): string[] {
	const tools = toolsForSetting(id);
	let out = normalizeList(names);
	if (id === 'move') {
		out = out.filter(
			(name) =>
				name !== 'move' && !LEGACY_MOVE_NAMES.includes(name as (typeof LEGACY_MOVE_NAMES)[number])
		);
	} else {
		out = out.filter((name) => !tools.includes(name));
	}
	if (enabled) {
		out = normalizeList([...out, ...tools]);
	}
	return out;
}

/** True when every tool for this setting is present in storage. */
export function isAutoApproveSettingEnabled(id: AutoApproveSettingId): boolean {
	return isAutoApproveSettingEnabledInList(id, parseStored());
}

export function setAutoApproveSettingEnabled(id: AutoApproveSettingId, enabled: boolean): void {
	persist(setAutoApproveSettingInList(id, enabled, parseStored()));
}

export function addAutoApproveToolName(toolName: string): void {
	if (typeof localStorage === 'undefined') return;
	const t = toolName.trim().slice(0, 64);
	if (!t) return;
	if (t === 'move' || t === 'move_file' || t === 'move_files') {
		setAutoApproveSettingEnabled('move', true);
		return;
	}
	const cur = parseStored();
	if (cur.includes(t)) return;
	persist([...cur, t]);
}

export function setAutoApproveToolNames(names: string[]): void {
	persist(normalizeList(names));
}

export async function fetchServerAutoApproveToolNames(workspaceId: string): Promise<string[]> {
	const res = await apiFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/settings`);
	if (!res.ok) {
		throw new Error(`Failed to load assistant preferences (${res.status})`);
	}
	const data = (await res.json()) as { autoApproveToolNames?: unknown };
	const list = Array.isArray(data.autoApproveToolNames) ? data.autoApproveToolNames : [];
	return normalizeList(list.filter((x): x is string => typeof x === 'string'));
}

export async function saveServerAutoApproveToolNames(
	workspaceId: string,
	names: string[]
): Promise<string[]> {
	const payload = normalizeList(names);
	const res = await apiFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/settings`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ autoApproveToolNames: payload })
	});
	if (!res.ok) {
		throw new Error(`Failed to save assistant preferences (${res.status})`);
	}
	const data = (await res.json()) as { autoApproveToolNames?: unknown };
	const saved = Array.isArray(data.autoApproveToolNames) ? data.autoApproveToolNames : payload;
	return normalizeList(saved.filter((x): x is string => typeof x === 'string'));
}
