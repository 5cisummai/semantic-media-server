// ---------------------------------------------------------------------------
// agent/tools/mutations.ts — File-mutating tools (all require confirmation)
// ---------------------------------------------------------------------------

import type { ToolDefinition, ToolResult } from './types';
import { asString, asStringArray, requireContext } from './validation';
import {
	deleteMediaPath,
	moveMediaPath,
	moveManyMediaPaths,
	copyMediaPath,
	mkdirMediaPath
} from '$lib/server/media-mutations';

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

export const deleteFileTool: ToolDefinition = {
	name: 'delete_file',
	description:
		'Permanently delete a file or folder under a media root. Requires user confirmation before it runs.',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path in rootIndex/path format (e.g. "0/photos/old.jpg").' }
		},
		required: ['path']
	},
	requiresConfirmation: true,
	hasSideEffects: true,

	async handler(args, ctx): Promise<ToolResult> {
		const c = requireContext('delete_file', ctx);
		if (typeof c === 'string') return { output: c };
		const relPath = asString(args.path);
		if (!relPath) return { output: 'Error: delete_file requires a non-empty "path" string.' };
		return { output: await deleteMediaPath(relPath, c) };
	}
};

// ---------------------------------------------------------------------------
// move_file
// ---------------------------------------------------------------------------

export const moveFileTool: ToolDefinition = {
	name: 'move_file',
	description:
		'Move or rename a file or folder within the same media root. Destination must not exist. Requires user confirmation.',
	parameters: {
		type: 'object',
		properties: {
			source_path: { type: 'string', description: 'Current path in rootIndex/path format.' },
			destination_path: {
				type: 'string',
				description: 'New path in the same root (e.g. move "0/a.txt" to "0/archive/a.txt").'
			}
		},
		required: ['source_path', 'destination_path']
	},
	requiresConfirmation: true,
	hasSideEffects: true,

	async handler(args, ctx): Promise<ToolResult> {
		const c = requireContext('move_file', ctx);
		if (typeof c === 'string') return { output: c };
		const src = asString(args.source_path);
		const dst = asString(args.destination_path);
		if (!src || !dst) return { output: 'Error: move_file requires "source_path" and "destination_path".' };
		return { output: await moveMediaPath(src, dst, c) };
	}
};

// ---------------------------------------------------------------------------
// move_files (bulk)
// ---------------------------------------------------------------------------

export const moveFilesTool: ToolDefinition = {
	name: 'move_files',
	description:
		'Move many files/folders into a destination directory within the same media root in one action. Each source keeps its original name. Requires user confirmation.',
	parameters: {
		type: 'object',
		properties: {
			source_paths: {
				type: 'array',
				items: { type: 'string' },
				description: 'List of source paths in rootIndex/path format (e.g. ["0/inbox/a.mp4", "0/inbox/b.mp4"]).'
			},
			destination_directory: {
				type: 'string',
				description: 'Existing destination directory in rootIndex/path format (e.g. "0/archive").'
			}
		},
		required: ['source_paths', 'destination_directory']
	},
	requiresConfirmation: true,
	hasSideEffects: true,

	async handler(args, ctx): Promise<ToolResult> {
		const c = requireContext('move_files', ctx);
		if (typeof c === 'string') return { output: c };
		const srcs = asStringArray(args.source_paths);
		const dstDir = asString(args.destination_directory);
		if (!srcs || srcs.length === 0 || !dstDir) {
			return { output: 'Error: move_files requires "source_paths" (string[]) and "destination_directory" (string).' };
		}
		return { output: await moveManyMediaPaths(srcs, dstDir, c) };
	}
};

// ---------------------------------------------------------------------------
// copy_file
// ---------------------------------------------------------------------------

export const copyFileTool: ToolDefinition = {
	name: 'copy_file',
	description:
		'Copy a file or folder to a new path within the same root. Destination must not exist. Requires user confirmation.',
	parameters: {
		type: 'object',
		properties: {
			source_path: { type: 'string', description: 'Source path in rootIndex/path format.' },
			destination_path: { type: 'string', description: 'Destination path in the same root.' }
		},
		required: ['source_path', 'destination_path']
	},
	requiresConfirmation: true,
	hasSideEffects: true,

	async handler(args, ctx): Promise<ToolResult> {
		const c = requireContext('copy_file', ctx);
		if (typeof c === 'string') return { output: c };
		const src = asString(args.source_path);
		const dst = asString(args.destination_path);
		if (!src || !dst) return { output: 'Error: copy_file requires "source_path" and "destination_path".' };
		return { output: await copyMediaPath(src, dst, c) };
	}
};

// ---------------------------------------------------------------------------
// mkdir
// ---------------------------------------------------------------------------

export const mkdirTool: ToolDefinition = {
	name: 'mkdir',
	description:
		'Create a new directory under a media root. Parent must exist. Requires user confirmation.',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Directory path to create (e.g. "0/incoming/2026").' }
		},
		required: ['path']
	},
	requiresConfirmation: true,
	hasSideEffects: true,

	async handler(args): Promise<ToolResult> {
		const relPath = asString(args.path);
		if (!relPath) return { output: 'Error: mkdir requires a non-empty "path" string.' };
		return { output: await mkdirMediaPath(relPath) };
	}
};
