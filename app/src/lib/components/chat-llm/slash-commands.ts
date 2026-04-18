import type { ComponentType } from 'svelte';

export interface SlashCommand {
	name: string;
	description: string;
	/** Lucide icon component (optional) */
	icon?: ComponentType;
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: 'clear', description: 'Clear the current conversation' },
	{ name: 'new', description: 'Start a new agent chat' },
	{ name: 'help', description: 'Show available slash commands' },
	{ name: 'export', description: 'Export this conversation as JSON' }
];

/** Returns commands matching a partial name (case-insensitive). */
export function filterCommands(query: string): SlashCommand[] {
	const q = query.toLowerCase();
	return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
}
