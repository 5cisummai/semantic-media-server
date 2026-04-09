// ---------------------------------------------------------------------------
// agent/tools/filesystem.ts — Read-only filesystem tools
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import type { ToolDefinition, ToolResult } from './types';
import { asString } from './validation';
import {
	formatSize,
	getMediaInfo,
	listDirectory,
	readFileContent,
	resolveSafePath
} from '$lib/server/services/storage';

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

export const listDirectoryTool: ToolDefinition = {
	name: 'list_directory',
	description: 'List directory contents by path. Use empty string to list all configured media roots.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Path in rootIndex/path format (for example "0/photos"), or empty string for root.'
			}
		},
		required: ['path']
	},
	requiresConfirmation: false,
	hasSideEffects: false,

	async handler(args): Promise<ToolResult> {
		const targetPath = asString(args.path);
		if (targetPath === null) return { output: 'Error: list_directory requires a "path" string.' };

		const entries = await listDirectory(targetPath);
		if (entries.length === 0) {
			const msg = targetPath.trim() ? `Directory "${targetPath}" is empty.` : 'No media roots available.';
			return { output: msg };
		}

		const lines = entries.map((entry) => {
			if (entry.type === 'directory') return `[dir] ${entry.path}`;
			const size = typeof entry.size === 'number' ? formatSize(entry.size) : 'unknown size';
			return `[file] ${entry.path} | ${entry.mediaType ?? 'other'} | ${size}`;
		});
		return { output: lines.join('\n') };
	}
};

// ---------------------------------------------------------------------------
// get_file_info
// ---------------------------------------------------------------------------

export const getFileInfoTool: ToolDefinition = {
	name: 'get_file_info',
	description: 'Get metadata for a single file or directory path.',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path in rootIndex/path format.' }
		},
		required: ['path']
	},
	requiresConfirmation: false,
	hasSideEffects: false,

	async handler(args): Promise<ToolResult> {
		const relPath = asString(args.path);
		if (!relPath) return { output: 'Error: get_file_info requires a non-empty "path" string.' };

		const resolved = resolveSafePath(relPath);
		if (!resolved) return { output: `Error: invalid or out-of-scope path "${relPath}".` };

		const stat = await fs.stat(resolved.fullPath);
		const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
		const media = stat.isFile() ? getMediaInfo(resolved.fullPath).mediaType : 'other';

		const output = [
			`Path: ${relPath}`,
			`Type: ${kind}`,
			`MediaType: ${media}`,
			`Size: ${formatSize(stat.size)}`,
			`Modified: ${stat.mtime.toISOString()}`
		].join('\n');
		return { output };
	}
};

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const readFileTool: ToolDefinition = {
	name: 'read_file',
	description: 'Read text content from a file path. Returns text for supported text/PDF types only.',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path in rootIndex/path format.' }
		},
		required: ['path']
	},
	requiresConfirmation: false,
	hasSideEffects: false,

	async handler(args): Promise<ToolResult> {
		const relPath = asString(args.path);
		if (!relPath) return { output: 'Error: read_file requires a non-empty "path" string.' };

		const resolved = resolveSafePath(relPath);
		if (!resolved) return { output: `Error: invalid or out-of-scope path "${relPath}".` };

		const info = getMediaInfo(resolved.fullPath);
		const content = await readFileContent(resolved.fullPath, info.mediaType);
		if (content === null) {
			return { output: `File "${relPath}" is not readable as text (detected media type: ${info.mediaType}).` };
		}
		if (!content.trim()) {
			return { output: `File "${relPath}" is empty.` };
		}
		return { output: `File: ${relPath}\n\n${content}` };
	}
};
