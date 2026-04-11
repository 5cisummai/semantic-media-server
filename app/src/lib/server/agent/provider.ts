// ---------------------------------------------------------------------------
// agent/provider.ts — Configure the @openai/agents SDK provider from env vars
//
// Call configureAgentProvider() once at module load before running agents.
// Supports both the official OpenAI API and Ollama (via its OpenAI-compatible
// /v1 endpoint) based on the same LLM_* environment variables used elsewhere.
// ---------------------------------------------------------------------------

import { env } from '$env/dynamic/private';
import {
	setDefaultOpenAIClient,
	setDefaultOpenAIKey,
	setOpenAIAPI,
	setTracingDisabled
} from '@openai/agents';
import OpenAI from 'openai';

let configured = false;

/**
 * Configure the SDK provider from environment variables.
 * Idempotent — safe to call multiple times.
 *
 * Env vars:
 *   LLM_PROVIDER   — "openai" (default) or "ollama"
 *   LLM_BASE_URL   — override API base URL
 *   LLM_API_KEY    — API key (required for real OpenAI; use any string for Ollama)
 *   LLM_MODEL      — model name to use in Agent definitions
 */
export function configureAgentProvider(): void {
	if (configured) return;
	configured = true;

	const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase();

	// Disable OpenAI tracing by default (avoids unintended data export)
	setTracingDisabled(true);

	if (provider === 'ollama') {
		// Ollama exposes an OpenAI-compatible Chat Completions endpoint at /v1
		const baseURL = env.LLM_BASE_URL
			? `${env.LLM_BASE_URL.replace(/\/+$/, '')}/v1`
			: 'http://127.0.0.1:11434/v1';
		const client = new OpenAI({
			baseURL,
			apiKey: env.LLM_API_KEY ?? 'ollama'
		});
		setDefaultOpenAIClient(client);
		setOpenAIAPI('chat_completions');
	} else {
		// Standard OpenAI-compatible provider
		const baseURL = env.LLM_BASE_URL ?? undefined;
		const apiKey = env.LLM_API_KEY ?? 'no-key';
		const client = new OpenAI({ baseURL, apiKey });
		setDefaultOpenAIClient(client);
		// Use Chat Completions for broad compatibility with OpenAI-compatible backends
		setOpenAIAPI('chat_completions');
		if (env.LLM_API_KEY) {
			setDefaultOpenAIKey(env.LLM_API_KEY);
		}
	}
}

/** The model name to use for the agent, from env or default. */
export function getAgentModel(): string {
	return env.LLM_MODEL ?? 'gpt-4.1';
}
