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
		ctx.toolCalls.push({
			tool: toolName,
			args: args as Record<string, unknown>,
			resultSummary: summary
		});
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
	description: 'Permanently delete a file or folder under a media root.',
	parameters: z.object({
		path: z
			.string()
			.describe(
				'Media path: rootIndex/… (e.g. "0/photos/old.jpg") or "<username>/…" in your personal folder.'
			)
	}),
	needsApproval: makeNeedsApproval('delete_file'),
	execute: makeMutatingExecute('delete_file', async ({ path: relPath }, ctx) => {
		if (!relPath) return 'Error: delete_file requires a non-empty "path" string.';
		return deleteMediaPath(
			relPath,
			{ userId: ctx.userId, isAdmin: ctx.isAdmin },
			{ userId: ctx.userId, workspaceId: ctx.workspaceId }
		);
	})
});

// ---------------------------------------------------------------------------
// move (single path or batch into a directory)
// ---------------------------------------------------------------------------

const moveParameters = z.object({
	source_path: z
		.string()
		.optional()
		.describe(
			'Single move/rename: current path in rootIndex/path format. Omit when using batch fields.'
		),
	destination_path: z
		.string()
		.optional()
		.describe(
			'Single move/rename: new full path in the same root. Destination must not exist. Omit when using batch fields.'
		),
	source_paths: z
		.array(z.string())
		.optional()
		.describe(
			'Batch move: list of source paths (e.g. ["0/inbox/a.mp4"]). Each item keeps its basename in the destination folder.'
		),
	destination_directory: z
		.string()
		.optional()
		.describe(
			'Batch move: existing destination directory in rootIndex/path format. Omit when using single-path fields.'
		)
});

export const moveTool = tool({
	name: 'move',
	description:
		'Move or rename within the same media root. Use either (1) source_path + destination_path for one item, or (2) source_paths + destination_directory to move many items into one folder (each keeps its name).',
	parameters: moveParameters,
	needsApproval: makeNeedsApproval('move'),
	execute: makeMutatingExecute('move', async (args, ctx) => {
		const batch =
			Array.isArray(args.source_paths) &&
			args.source_paths.length > 0 &&
			typeof args.destination_directory === 'string' &&
			args.destination_directory.length > 0;
		const single =
			typeof args.source_path === 'string' &&
			args.source_path.length > 0 &&
			typeof args.destination_path === 'string' &&
			args.destination_path.length > 0;

		if (batch && single) {
			return 'Error: move: use either source_path+destination_path OR source_paths+destination_directory, not both.';
		}
		if (batch) {
			return moveManyMediaPaths(
				args.source_paths!,
				args.destination_directory!,
				{
					userId: ctx.userId,
					isAdmin: ctx.isAdmin
				},
				{ userId: ctx.userId, workspaceId: ctx.workspaceId }
			);
		}
		if (single) {
			return moveMediaPath(
				args.source_path!,
				args.destination_path!,
				{
					userId: ctx.userId,
					isAdmin: ctx.isAdmin
				},
				{ userId: ctx.userId, workspaceId: ctx.workspaceId }
			);
		}
		return 'Error: move requires either "source_path" and "destination_path", or non-empty "source_paths" and "destination_directory".';
	})
});

// ---------------------------------------------------------------------------
// copy_file
// ---------------------------------------------------------------------------

export const copyFileTool = tool({
	name: 'copy_file',
	description:
		'Copy a file or folder to a new path within the same root. Destination must not exist.',
	parameters: z.object({
		source_path: z.string().describe('Source path in rootIndex/path format.'),
		destination_path: z.string().describe('Destination path in the same root.')
	}),
	needsApproval: makeNeedsApproval('copy_file'),
	execute: makeMutatingExecute('copy_file', async ({ source_path, destination_path }, ctx) => {
		if (!source_path || !destination_path)
			return 'Error: copy_file requires "source_path" and "destination_path".';
		return copyMediaPath(
			source_path,
			destination_path,
			{ userId: ctx.userId, isAdmin: ctx.isAdmin },
			{ userId: ctx.userId, workspaceId: ctx.workspaceId }
		);
	})
});

// ---------------------------------------------------------------------------
// mkdir
// ---------------------------------------------------------------------------

export const mkdirTool = tool({
	name: 'mkdir',
	description: 'Create a new directory under a media root. Parent must exist.',
	parameters: z.object({
		path: z.string().describe('Directory path to create (e.g. "0/incoming/2026").')
	}),
	needsApproval: makeNeedsApproval('mkdir'),
	execute: makeMutatingExecute('mkdir', async ({ path: relPath }, ctx) => {
		if (!relPath) return 'Error: mkdir requires a non-empty "path" string.';
		return mkdirMediaPath(relPath, { userId: ctx.userId, workspaceId: ctx.workspaceId });
	})
});
