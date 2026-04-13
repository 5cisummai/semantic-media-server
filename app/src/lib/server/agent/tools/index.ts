// ---------------------------------------------------------------------------
// agent/tools/index.ts — Public API: flat SDK tool array factory
// ---------------------------------------------------------------------------

import type { Tool } from '@openai/agents';
import type { AgentAppContext } from '../context';
import { searchTool } from './search';
import { listDirectoryTool, getFileInfoTool, readFileTool } from './filesystem';
import { searchByMetadataTool } from './metadata';
import { deleteFileTool, moveTool, copyFileTool, mkdirTool } from './mutations';

export function createDefaultTools(): Tool<AgentAppContext>[] {
	return [
		searchTool,
		listDirectoryTool,
		getFileInfoTool,
		readFileTool,
		searchByMetadataTool,
		deleteFileTool,
		moveTool,
		copyFileTool,
		mkdirTool
	];
}
