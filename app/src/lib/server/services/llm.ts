import { env } from '$env/dynamic/private';

export type LlmProvider = 'ollama' | 'openai';

export interface LlmMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	name?: string;
	tool_calls?: unknown;
}

export interface LlmResponse {
	message: string;
	finishReason: string;
}

export interface ChatOptions {
	model?: string;
	timeout?: number;
	/** Lower = more grounded; default from env or 0.25 for RAG. */
	temperature?: number;
	top_p?: number;
}

function getProvider(): LlmProvider {
	const provider = (env.LLM_PROVIDER ?? 'ollama').toLowerCase();
	if (provider === 'openai') return 'openai';
	return 'ollama';
}

function getTimeout(options?: ChatOptions): number {
	const timeout = options?.timeout ?? Number.parseInt(env.LLM_TIMEOUT ?? '120000', 10);
	return Number.isFinite(timeout) ? timeout : 120000;
}

function getTemperature(options?: ChatOptions): number {
	const t = options?.temperature ?? Number.parseFloat(env.LLM_TEMPERATURE ?? '0.25');
	return Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : 0.25;
}

function getTopP(options?: ChatOptions): number | undefined {
	const p = options?.top_p ?? (env.LLM_TOP_P ? Number.parseFloat(env.LLM_TOP_P) : undefined);
	if (p === undefined || !Number.isFinite(p)) return undefined;
	return Math.min(1, Math.max(0, p));
}

function mapMessagesForOpenAI(messages: LlmMessage): {
	role: string;
	content: string;
	tool_call_id?: string;
	name?: string;
	tool_calls?: unknown;
} {
	return {
		role: messages.role,
		content: messages.content,
		...(messages.tool_call_id ? { tool_call_id: messages.tool_call_id } : {}),
		...(messages.name ? { name: messages.name } : {}),
		...(messages.tool_calls ? { tool_calls: messages.tool_calls } : {})
	};
}

async function chatWithOllama(
	messages: LlmMessage[],
	model: string,
	timeout: number,
	options?: ChatOptions
): Promise<LlmResponse> {
	const baseUrl = env.LLM_BASE_URL ?? 'http://127.0.0.1:11434';

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const temperature = getTemperature(options);
		const topP = getTopP(options);
		const response = await fetch(`${baseUrl}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				messages: messages.map((m) => ({ role: m.role, content: m.content })),
				stream: false,
				options: {
					temperature,
					...(topP !== undefined ? { top_p: topP } : {})
				}
			}),
			signal: controller.signal
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
		}

		const body = (await response.json()) as {
			message?: { content?: string };
			done?: boolean;
		};

		return {
			message: body.message?.content ?? '',
			finishReason: body.done === true ? 'stop' : 'length'
		};
	} catch (err) {
		clearTimeout(timeoutId);
		throw err;
	}
}

async function chatWithOpenAI(
	messages: LlmMessage[],
	model: string,
	timeout: number,
	options?: ChatOptions
): Promise<LlmResponse> {
	const baseUrl = env.LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1';

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (env.LLM_API_KEY) {
		headers.Authorization = `Bearer ${env.LLM_API_KEY}`;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const temperature = getTemperature(options);
		const topP = getTopP(options);
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model,
				messages: messages.map((m) => ({ role: m.role, content: m.content })),
				temperature,
				...(topP !== undefined ? { top_p: topP } : {})
			}),
			signal: controller.signal
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(
				`OpenAI-compatible request failed: ${response.status} ${response.statusText}`
			);
		}

		const body = (await response.json()) as {
			choices?: Array<{
				message?: { content?: string };
				finish_reason?: string;
			}>;
		};

		const choice = body.choices?.[0];
		return {
			message: choice?.message?.content ?? '',
			finishReason: choice?.finish_reason ?? 'stop'
		};
	} catch (err) {
		clearTimeout(timeoutId);
		throw err;
	}
}

/**
 * Stream assistant text tokens (UTF-8). No tools — final answer only. Ollama and OpenAI-compatible.
 */
export async function* streamText(
	messages: LlmMessage[],
	options?: ChatOptions
): AsyncGenerator<string, void, undefined> {
	const provider = getProvider();
	const model = options?.model ?? env.LLM_MODEL ?? 'llama3.2';
	const timeout = getTimeout(options);
	const temperature = getTemperature(options);
	const topP = getTopP(options);

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		if (provider === 'openai') {
			yield* streamTextOpenAI(messages, model, temperature, topP, controller.signal);
			return;
		}
		yield* streamTextOllama(messages, model, temperature, topP, controller.signal);
	} finally {
		clearTimeout(timeoutId);
	}
}

function mapMessagesForOllamaChat(m: LlmMessage): Record<string, unknown> {
	return {
		role: m.role,
		content: m.content,
		...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
		...(m.name ? { name: m.name } : {}),
		...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
	};
}

export async function chat(messages: LlmMessage[], options?: ChatOptions): Promise<LlmResponse> {
	const provider = getProvider();
	const model = options?.model ?? env.LLM_MODEL ?? 'llama3.2';
	const timeout = getTimeout(options);
	if (provider === 'openai') {
		return chatWithOpenAI(messages, model, timeout, options);
	}
	return chatWithOllama(messages, model, timeout, options);
}

async function* streamTextOllama(
	messages: LlmMessage[],
	model: string,
	temperature: number,
	topP: number | undefined,
	signal: AbortSignal
): AsyncGenerator<string, void, undefined> {
	const baseUrl = env.LLM_BASE_URL ?? 'http://127.0.0.1:11434';

	const response = await fetch(`${baseUrl}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: messages.map(mapMessagesForOllamaChat),
			stream: true,
			options: {
				temperature,
				...(topP !== undefined ? { top_p: topP } : {})
			}
		}),
		signal
	});

	if (!response.ok) {
		throw new Error(`Ollama stream failed: ${response.status} ${response.statusText}`);
	}
	if (!response.body) {
		throw new Error('Ollama stream: empty body');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const json = JSON.parse(trimmed) as {
						message?: { content?: string };
						done?: boolean;
					};
					const piece = json.message?.content;
					if (piece) yield piece;
					if (json.done === true) return;
				} catch {
					// ignore partial JSON lines
				}
			}
		}
		if (buffer.trim()) {
			try {
				const json = JSON.parse(buffer.trim()) as {
					message?: { content?: string };
					done?: boolean;
				};
				const piece = json.message?.content;
				if (piece) yield piece;
				if (json.done === true) return;
			} catch {
				// ignore
			}
		}
	} finally {
		reader.releaseLock();
	}
}

async function* streamTextOpenAI(
	messages: LlmMessage[],
	model: string,
	temperature: number,
	topP: number | undefined,
	signal: AbortSignal
): AsyncGenerator<string, void, undefined> {
	const baseUrl = env.LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1';

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (env.LLM_API_KEY) {
		headers.Authorization = `Bearer ${env.LLM_API_KEY}`;
	}

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model,
			messages: messages.map(mapMessagesForOpenAI),
			stream: true,
			temperature,
			...(topP !== undefined ? { top_p: topP } : {})
		}),
		signal
	});

	if (!response.ok) {
		throw new Error(`OpenAI stream failed: ${response.status} ${response.statusText}`);
	}
	if (!response.body) {
		throw new Error('OpenAI stream: empty body');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split('\n\n');
			buffer = parts.pop() ?? '';
			for (const part of parts) {
				const line = part.trim();
				if (!line.startsWith('data:')) continue;
				const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
				const trimmed = data.trim();
				if (trimmed === '[DONE]') return;
				try {
					const json = JSON.parse(trimmed) as {
						choices?: Array<{ delta?: { content?: string } }>;
					};
					const c = json.choices?.[0]?.delta?.content;
					if (c) yield c;
				} catch {
					// skip
				}
			}
		}
		if (buffer.trim()) {
			for (const part of buffer.split('\n\n')) {
				const line = part.trim();
				if (!line.startsWith('data:')) continue;
				const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
				if (data.trim() === '[DONE]') return;
				try {
					const json = JSON.parse(data.trim()) as {
						choices?: Array<{ delta?: { content?: string } }>;
					};
					const c = json.choices?.[0]?.delta?.content;
					if (c) yield c;
				} catch {
					// ignore
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

export async function chatText(
	prompt: string,
	system?: string,
	options?: ChatOptions
): Promise<string> {
	const messages: LlmMessage[] = [];
	if (system) messages.push({ role: 'system', content: system });
	messages.push({ role: 'user', content: prompt });

	const response = await chat(messages, options);
	return response.message;
}

export async function chatFast(prompt: string, system?: string): Promise<string> {
	return chatText(prompt, system, { model: env.LLM_FAST_MODEL });
}

const CHAT_TITLE_SYSTEM = `You label chat sessions. Respond with only a short title: a few words (3-4) that summarize the user's message. No quotes. No explanation. One line.`;

/**
 * Turn the first user message into a concise chat title via the configured LLM (see llm.ts / chatText).
 */
export async function summarizePromptAsChatTitle(userMessage: string): Promise<string> {
	const text = userMessage.replace(/\s+/g, ' ').trim().slice(0, 8000);
	if (!text) return '';
	return chatText(text, CHAT_TITLE_SYSTEM, {
		model: env.LLM_FAST_MODEL ?? env.LLM_MODEL,
		temperature: 0.4,
		timeout: 20_000
	});
}

export async function isAvailable(): Promise<boolean> {
	const provider = getProvider();
	if (provider === 'openai') {
		return (await fetch(`${env.LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1'}/models`)).ok;
	}
	return (await fetch(`${env.LLM_BASE_URL ?? 'http://127.0.0.1:11434'}/api/chat`)).ok;
}
