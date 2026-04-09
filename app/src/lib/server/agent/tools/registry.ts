// ---------------------------------------------------------------------------
// agent/tools/registry.ts — Central tool registry
// ---------------------------------------------------------------------------

import type { LlmToolDefinition } from '$lib/server/services/llm';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types';
import { toLlmToolDefinition } from './types';
import { ToolError } from '../errors';

/**
 * Registry-based tool system. Tools are registered once at startup and
 * looked up by name at execution time. No switch statements, no hardcoded
 * tool lists in the execution path.
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *   registry.register(searchTool);
 *   registry.register(listDirectoryTool);
 *   ...
 *   const result = await registry.execute('search', args, ctx);
 */
export class ToolRegistry {
	private tools = new Map<string, ToolDefinition>();

	/** Register a tool. Throws if a tool with the same name is already registered. */
	register(def: ToolDefinition): this {
		if (this.tools.has(def.name)) {
			throw new Error(`Tool "${def.name}" is already registered`);
		}
		this.tools.set(def.name, def);
		return this;
	}

	/** Register multiple tools at once. */
	registerAll(defs: ToolDefinition[]): this {
		for (const def of defs) this.register(def);
		return this;
	}

	/** Get a tool definition by name, or undefined. */
	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	/** Check if a tool is registered. */
	has(name: string): boolean {
		return this.tools.has(name);
	}

	/** Whether the named tool requires user confirmation before running. */
	requiresConfirmation(name: string): boolean {
		return this.tools.get(name)?.requiresConfirmation ?? false;
	}

	/** All registered tool names. */
	names(): string[] {
		return Array.from(this.tools.keys());
	}

	/** Convert all registered tools to LLM function-calling definitions. */
	toLlmDefinitions(): LlmToolDefinition[] {
		return Array.from(this.tools.values()).map(toLlmToolDefinition);
	}

	/**
	 * Execute a tool by name.
	 *
	 * @throws {ToolError} if the tool is unknown or the handler throws.
	 */
	async execute(
		name: string,
		args: Record<string, unknown>,
		ctx?: ToolExecutionContext
	): Promise<ToolResult> {
		const def = this.tools.get(name);
		if (!def) {
			throw new ToolError(name, args, `Unknown tool "${name}"`);
		}

		try {
			return await def.handler(args, ctx);
		} catch (err) {
			if (err instanceof ToolError) throw err;
			const message = err instanceof Error ? err.message : 'Unknown tool execution failure';
			throw new ToolError(name, args, message, { cause: err });
		}
	}
}
