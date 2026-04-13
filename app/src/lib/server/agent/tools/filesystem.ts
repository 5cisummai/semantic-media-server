// ---------------------------------------------------------------------------
// agent/tools/filesystem.ts — Read-only filesystem tools (SDK tool() + Zod)
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import { tool } from '@openai/agents';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import {
	formatSize,
	getMediaInfo,
	listDirectory,
	readFileContent,
	resolveSafePath
} from '$lib/server/services/storage';
import type { AgentAppContext } from '../context';
import { summarizeToolResult } from '../loop-utils';

// ---------------------------------------------------------------------------
// Helper — wrap read-only tool execution with event emission + summary
// ---------------------------------------------------------------------------

function makeReadonlyExecute<T extends Record<string, unknown>>(
	toolName: string,
	fn: (args: T, ctx?: AgentAppContext) => Promise<string>
) {
	return async (args: T, runContext?: RunContext<AgentAppContext>): Promise<string> => {
		const ctx = runContext?.context;
		ctx?.onEvent?.({ type: 'tool_start', tool: toolName, args: args as Record<string, unknown> });
		const output = await fn(args, ctx);
		const summary = summarizeToolResult(output);
		ctx?.toolCalls.push({
			tool: toolName,
			args: args as Record<string, unknown>,
			resultSummary: summary
		});
		ctx?.onEvent?.({ type: 'tool_done', tool: toolName, resultSummary: summary });
		return output;
	};
}

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

export const listDirectoryTool = tool({
	name: 'list_directory',
	description:
		'List directory contents by path. Use empty string to list all configured media roots.',
	parameters: z.object({
		path: z
			.string()
			.describe('Path in rootIndex/path format (for example "0/photos"), or empty string for root.')
	}),
	execute: makeReadonlyExecute('list_directory', async ({ path: targetPath }) => {
		const entries = await listDirectory(targetPath);
		if (entries.length === 0) {
			return targetPath.trim()
				? `Directory "${targetPath}" is empty.`
				: 'No media roots available.';
		}
		return entries
			.map((entry) => {
				if (entry.type === 'directory') return `[dir] ${entry.path}`;
				const size = typeof entry.size === 'number' ? formatSize(entry.size) : 'unknown size';
				return `[file] ${entry.path} | ${entry.mediaType ?? 'other'} | ${size}`;
			})
			.join('\n');
	})
});

// ---------------------------------------------------------------------------
// get_file_info
// ---------------------------------------------------------------------------

export const getFileInfoTool = tool({
	name: 'get_file_info',
	description: 'Get metadata for a single file or directory path.',
	parameters: z.object({
		path: z.string().describe('Path in rootIndex/path format.')
	}),
	execute: makeReadonlyExecute('get_file_info', async ({ path: relPath }) => {
		if (!relPath) return 'Error: get_file_info requires a non-empty "path" string.';
		const resolved = resolveSafePath(relPath);
		if (!resolved) return `Error: invalid or out-of-scope path "${relPath}".`;

		const stat = await fs.stat(resolved.fullPath);
		const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
		const media = stat.isFile() ? getMediaInfo(resolved.fullPath).mediaType : 'other';

		return [
			`Path: ${relPath}`,
			`Type: ${kind}`,
			`MediaType: ${media}`,
			`Size: ${formatSize(stat.size)}`,
			`Modified: ${stat.mtime.toISOString()}`
		].join('\n');
	})
});

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const readFileTool = tool({
	name: 'read_file',
	description:
		'Read text content from a file path. Returns text for supported text/PDF types only.',
	parameters: z.object({
		path: z.string().describe('Path in rootIndex/path format.')
	}),
	execute: makeReadonlyExecute('read_file', async ({ path: relPath }) => {
		if (!relPath) return 'Error: read_file requires a non-empty "path" string.';
		const resolved = resolveSafePath(relPath);
		if (!resolved) return `Error: invalid or out-of-scope path "${relPath}".`;

		const info = getMediaInfo(resolved.fullPath);
		const content = await readFileContent(resolved.fullPath, info.mediaType);
		if (content === null) {
			return `File "${relPath}" is not readable as text (detected media type: ${info.mediaType}).`;
		}
		if (!content.trim()) return `File "${relPath}" is empty.`;
		return `File: ${relPath}\n\n${content}`;
	})
});
