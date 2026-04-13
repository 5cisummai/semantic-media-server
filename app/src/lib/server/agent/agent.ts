// ---------------------------------------------------------------------------
// agent/agent.ts — SDK Agent definition
// ---------------------------------------------------------------------------

import { Agent } from '@openai/agents';
import type { AgentAppContext } from './context';
import { createDefaultTools } from './tools';
import { getAgentModel } from './provider';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const AGENT_SYSTEM_PROMPT = `You are an intelligent assistant for a personal file workspace.
You have tools to search, browse, read, move, copy, create folders, and delete the user's files.
Destructive or mutating actions (delete, move, copy, mkdir) normally require explicit user approval in the UI. The user may enable auto-approval for specific action types in their browser; when enabled, those tools run without a confirmation prompt.
Use tools to find accurate information before answering.
For directory questions use list_directory not search.
For content questions use search first.
For specific file questions use read_file.
Always cite which files your answer draws from.
Never guess — use a tool if you need information.`;

// ---------------------------------------------------------------------------
// Singleton agent (lazy, recreated if model config changes at module reload)
// ---------------------------------------------------------------------------

let _agent: Agent<AgentAppContext> | null = null;

export function getMediaAgent(): Agent<AgentAppContext> {
	if (!_agent) {
		_agent = new Agent<AgentAppContext>({
			name: 'media-assistant',
			instructions: AGENT_SYSTEM_PROMPT,
			tools: createDefaultTools(),
			model: getAgentModel()
		});
	}
	return _agent;
}
