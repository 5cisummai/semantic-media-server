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
// Settings UI: grouped options (move = move_file + move_files)
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
		description: 'Permanently delete files or folders.'
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
	if (id === 'move') return ['move_file', 'move_files'];
	return [id];
}

/** True when every tool for this setting is present in storage. */
export function isAutoApproveSettingEnabled(id: AutoApproveSettingId): boolean {
	const cur = parseStored();
	return toolsForSetting(id).every((t) => cur.includes(t));
}

export function setAutoApproveSettingEnabled(id: AutoApproveSettingId, enabled: boolean): void {
	const tools = toolsForSetting(id);
	let cur = parseStored().filter((x) => !tools.includes(x));
	if (enabled) {
		cur = [...cur, ...tools];
	}
	persist(cur);
}

export function addAutoApproveToolName(toolName: string): void {
	if (typeof localStorage === 'undefined') return;
	const t = toolName.trim().slice(0, 64);
	if (!t) return;
	if (t === 'move_file' || t === 'move_files') {
		setAutoApproveSettingEnabled('move', true);
		return;
	}
	const cur = parseStored();
	if (cur.includes(t)) return;
	persist([...cur, t]);
}
