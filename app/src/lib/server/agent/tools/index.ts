// ---------------------------------------------------------------------------
// agent/tools/index.ts — Public API: default registry factory
// ---------------------------------------------------------------------------

export { ToolRegistry } from './registry';
export type { ToolDefinition, ToolHandler, ToolResult, ToolExecutionContext } from './types';

import { ToolRegistry } from './registry';
import { searchTool } from './search';
import { listDirectoryTool, getFileInfoTool, readFileTool } from './filesystem';
import { searchByMetadataTool } from './metadata';
import { deleteFileTool, moveFileTool, moveFilesTool, copyFileTool, mkdirTool } from './mutations';

/**
 * Create a ToolRegistry pre-loaded with all built-in tools.
 *
 * Call this once per process (or per test). The registry is stateless
 * so a singleton is fine, but the factory pattern lets tests swap tools.
 */
export function createDefaultRegistry(): ToolRegistry {
	return new ToolRegistry().registerAll([
		searchTool,
		listDirectoryTool,
		getFileInfoTool,
		readFileTool,
		searchByMetadataTool,
		deleteFileTool,
		moveFileTool,
		moveFilesTool,
		copyFileTool,
		mkdirTool
	]);
}
