const TOOL_LABELS: Record<string, string> = {
	list_directory: 'Browsing files',
	search: 'Searching files',
	read_file: 'Reading file',
	get_file_info: 'Checking file',
	search_by_metadata: 'Filtering files',
	delete_file: 'Delete (needs your approval)',
	move: 'Move (needs your approval)',
	copy_file: 'Copy (needs your approval)',
	mkdir: 'Create folder (needs your approval)'
};

const TOOL_ACTION_TITLES: Record<string, string> = {
	delete_file: 'Delete',
	move: 'Move',
	copy_file: 'Copy',
	mkdir: 'Create folder'
};

export function toolLabelForName(name: string): string {
	return TOOL_LABELS[name] ?? `Using ${name}`;
}

export function actionTitleForTool(name: string): string {
	return TOOL_ACTION_TITLES[name] ?? name;
}

export function summarizeToolArgs(tool: string, args: Record<string, unknown>): string {
	try {
		if ((tool === 'delete_file' || tool === 'mkdir') && typeof args.path === 'string') {
			return args.path;
		}

		if (
			(tool === 'move' || tool === 'copy_file') &&
			typeof args.source_path === 'string' &&
			typeof args.destination_path === 'string'
		) {
			return `${args.source_path} → ${args.destination_path}`;
		}

		if (
			tool === 'move' &&
			Array.isArray(args.source_paths) &&
			typeof args.destination_directory === 'string'
		) {
			return `${args.source_paths.length} path(s) → ${args.destination_directory}`;
		}

		return JSON.stringify(args, null, 2);
	} catch {
		return String(tool);
	}
}
