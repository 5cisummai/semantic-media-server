// ---------------------------------------------------------------------------
// agent/tools/mutations.ts — File-mutating tools (SDK tool() + Zod + needsApproval)
// ---------------------------------------------------------------------------

import { tool } from '@openai/agents';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import {
	deleteMediaPath,
	moveMediaPath,
	moveManyMediaPaths,
	copyMediaPath,
	mkdirMediaPath
} from '$lib/server/media-mutations';
import type { AgentAppContext } from '../context';
import { shouldAutoApproveTool } from '../auto-approve-tools';
import { summarizeToolResult } from '../loop-utils';

// ---------------------------------------------------------------------------
// Helper — wrap mutating tool with event emission + needsApproval callback
// ---------------------------------------------------------------------------

function makeMutatingExecute<T extends Record<string, unknown>>(
	toolName: string,
	fn: (args: T, ctx: AgentAppContext) => Promise<string>
) {
	return async (args: T, runContext?: RunContext<unknown>): Promise<string> => {
		const ctx = runContext?.context as AgentAppContext | undefined;
		if (!ctx) return `Error: "${toolName}" requires an authenticated user context.`;
		ctx.onEvent?.({ type: 'tool_start', tool: toolName, args: args as Record<string, unknown> });
		const output = await fn(args, ctx);
		const summary = summarizeToolResult(output);
		ctx.toolCalls.push({ tool: toolName, args: args as Record<string, unknown>, resultSummary: summary });
		ctx.onEvent?.({ type: 'tool_done', tool: toolName, resultSummary: summary });
		return output;
	};
}

function makeNeedsApproval(toolName: string) {
	return async (runContext: RunContext<unknown>, _input: unknown): Promise<boolean> => {
		const ctx = runContext.context as AgentAppContext;
		return !shouldAutoApproveTool(ctx.autoApproveToolNames, toolName);
	};
}

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

export const deleteFileTool = tool({
	name: 'delete_file',
	description:
		'Permanently delete a file or folder under a media root. Requires user confirmation before it runs.',
	parameters: z.object({
		path: z
			.string()
			.describe('Path in rootIndex/path format (e.g. "0/photos/old.jpg").')
	}),
	needsApproval: makeNeedsApproval('delete_file'),
	execute: makeMutatingExecute('delete_file', async ({ path: relPath }, ctx) => {
		if (!relPath) return 'Error: delete_file requires a non-empty "path" string.';
		return deleteMediaPath(relPath, { userId: ctx.userId, isAdmin: ctx.isAdmin });
	})
});

// ---------------------------------------------------------------------------
// move_file
// ---------------------------------------------------------------------------

export const moveFileTool = tool({
	name: 'move_file',
	description:
		'Move or rename a file or folder within the same media root. Destination must not exist. Requires user confirmation.',
	parameters: z.object({
		source_path: z.string().describe('Current path in rootIndex/path format.'),
		destination_path: z
			.string()
			.describe('New path in the same root (e.g. move "0/a.txt" to "0/archive/a.txt").')
	}),
	needsApproval: makeNeedsApproval('move_file'),
	execute: makeMutatingExecute('move_file', async ({ source_path, destination_path }, ctx) => {
		if (!source_path || !destination_path)
			return 'Error: move_file requires "source_path" and "destination_path".';
		return moveMediaPath(source_path, destination_path, { userId: ctx.userId, isAdmin: ctx.isAdmin });
	})
});

// ---------------------------------------------------------------------------
// move_files (bulk)
// ---------------------------------------------------------------------------

export const moveFilesTool = tool({
	name: 'move_files',
	description:
		'Move many files/folders into a destination directory within the same media root in one action. Each source keeps its original name. Requires user confirmation.',
	parameters: z.object({
		source_paths: z
			.array(z.string())
			.describe(
				'List of source paths in rootIndex/path format (e.g. ["0/inbox/a.mp4", "0/inbox/b.mp4"]).'
			),
		destination_directory: z
			.string()
			.describe('Existing destination directory in rootIndex/path format (e.g. "0/archive").')
	}),
	needsApproval: makeNeedsApproval('move_files'),
	execute: makeMutatingExecute('move_files', async ({ source_paths, destination_directory }, ctx) => {
		if (!source_paths.length || !destination_directory)
			return 'Error: move_files requires "source_paths" (string[]) and "destination_directory" (string).';
		return moveManyMediaPaths(source_paths, destination_directory, { userId: ctx.userId, isAdmin: ctx.isAdmin });
	})
});

// ---------------------------------------------------------------------------
// copy_file
// ---------------------------------------------------------------------------

export const copyFileTool = tool({
	name: 'copy_file',
	description:
		'Copy a file or folder to a new path within the same root. Destination must not exist. Requires user confirmation.',
	parameters: z.object({
		source_path: z.string().describe('Source path in rootIndex/path format.'),
		destination_path: z.string().describe('Destination path in the same root.')
	}),
	needsApproval: makeNeedsApproval('copy_file'),
	execute: makeMutatingExecute('copy_file', async ({ source_path, destination_path }, ctx) => {
		if (!source_path || !destination_path)
			return 'Error: copy_file requires "source_path" and "destination_path".';
		return copyMediaPath(source_path, destination_path, { userId: ctx.userId, isAdmin: ctx.isAdmin });
	})
});

// ---------------------------------------------------------------------------
// mkdir
// ---------------------------------------------------------------------------

export const mkdirTool = tool({
	name: 'mkdir',
	description:
		'Create a new directory under a media root. Parent must exist. Requires user confirmation.',
	parameters: z.object({
		path: z.string().describe('Directory path to create (e.g. "0/incoming/2026").')
	}),
	needsApproval: makeNeedsApproval('mkdir'),
	execute: makeMutatingExecute('mkdir', async ({ path: relPath }) => {
		if (!relPath) return 'Error: mkdir requires a non-empty "path" string.';
		return mkdirMediaPath(relPath);
	})
});


