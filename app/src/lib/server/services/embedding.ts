import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type EmbeddingProvider = 'multimodal' | 'ollama' | 'openai';

export interface EmbeddingResult {
	vector: number[];
	provider: EmbeddingProvider;
}

function normalizeVector(vector: number[]): number[] {
	let norm = 0;
	for (const value of vector) norm += value * value;
	norm = Math.sqrt(norm);
	if (norm === 0) return vector;
	return vector.map((value) => value / norm);
}

export function getEmbeddingProvider(): EmbeddingProvider {
	const provider = (env.EMBEDDING_PROVIDER ?? (env.MULTIMODAL_EMBEDDING_URL ? 'multimodal' : 'ollama')).toLowerCase();
	if (provider === 'openai') return 'openai';
	if (provider === 'multimodal' || provider === 'qwen-vl') return 'multimodal';
	return 'ollama';
}

async function embedWithMultimodal(input: {
	type: 'text' | 'image';
	text?: string;
	imageBase64?: string;
	filename?: string;
}): Promise<number[]> {
	const endpoint = env.MULTIMODAL_EMBEDDING_URL;
	if (!endpoint) {
		throw new Error('MULTIMODAL_EMBEDDING_URL is required when EMBEDDING_PROVIDER=multimodal');
	}

	const model = env.MULTIMODAL_EMBEDDING_MODEL ?? 'Qwen/Qwen3-VL-Embedding-2B';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (env.MULTIMODAL_EMBEDDING_API_KEY) {
		headers.Authorization = `Bearer ${env.MULTIMODAL_EMBEDDING_API_KEY}`;
	}

	const response = await fetch(endpoint, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model,
			...input
		})
	});

	if (!response.ok) {
		let detail = '';
		try {
			const text = await response.text();
			if (text) {
				try {
					const parsed = JSON.parse(text) as { detail?: unknown };
					detail =
						typeof parsed.detail === 'string'
							? parsed.detail
							: JSON.stringify(parsed.detail ?? parsed);
				} catch {
					detail = text.length > 800 ? `${text.slice(0, 800)}…` : text;
				}
			}
		} catch {
			/* ignore body read errors */
		}
		const kind = input.type === 'image' ? 'image' : 'text';
		const filename = input.filename ?? '(no filename)';
		const extra =
			input.type === 'image' && input.imageBase64
				? ` base64Length=${input.imageBase64.length}`
				: input.type === 'text' && input.text
					? ` textLength=${input.text.length}`
					: '';
		throw new Error(
			`Multimodal embedding request failed: ${response.status} ${response.statusText} (${kind}, ${filename})${extra}${detail ? ` — ${detail}` : ''}`
		);
	}

	const body = (await response.json()) as { embedding?: number[] };
	if (!Array.isArray(body.embedding)) {
		throw new Error('Multimodal embedding response did not include an embedding vector');
	}

	return normalizeVector(body.embedding);
}

async function embedTextWithOllama(input: string): Promise<number[]> {
	const baseUrl = env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
	const model = env.OLLAMA_EMBED_MODEL ?? env.OLLAMA_MODEL ?? 'nomic-embed-text';

	const response = await fetch(`${baseUrl}/api/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, prompt: input })
	});

	if (!response.ok) {
		throw new Error(`Ollama embedding request failed: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as { embedding?: number[] };
	if (!Array.isArray(body.embedding)) {
		throw new Error('Ollama embedding response did not include an embedding vector');
	}

	return normalizeVector(body.embedding);
}

async function embedTextWithOpenAICompatible(input: string): Promise<number[]> {
	const baseUrl = env.OPENAI_BASE_URL ?? 'http://127.0.0.1:1234/v1';
	const model = env.OPENAI_EMBED_MODEL ?? env.OPENAI_MODEL;
	if (!model) {
		throw new Error('OPENAI_EMBED_MODEL (or OPENAI_MODEL) is required when EMBEDDING_PROVIDER=openai');
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (env.OPENAI_API_KEY) headers.Authorization = `Bearer ${env.OPENAI_API_KEY}`;

	const response = await fetch(`${baseUrl}/embeddings`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model,
			input
		})
	});

	if (!response.ok) {
		throw new Error(`OpenAI-compatible embedding request failed: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as {
		data?: Array<{ embedding?: number[] }>;
	};

	const embedding = body.data?.[0]?.embedding;
	if (!Array.isArray(embedding)) {
		throw new Error('OpenAI-compatible embedding response did not include an embedding vector');
	}

	return normalizeVector(embedding);
}

export async function embedText(input: string): Promise<EmbeddingResult> {
	const provider = getEmbeddingProvider();
	let vector: number[];

	if (provider === 'multimodal') {
		vector = await embedWithMultimodal({ type: 'text', text: input });
	} else if (provider === 'openai') {
		vector = await embedTextWithOpenAICompatible(input);
	} else {
		vector = await embedTextWithOllama(input);
	}

	return { vector, provider };
}

export async function embedImage(filePath: string): Promise<number[] | null> {
	const provider = getEmbeddingProvider();
	if (provider !== 'multimodal') return null;

	const bytes = await fs.readFile(filePath);
	return embedWithMultimodal({
		type: 'image',
		imageBase64: bytes.toString('base64'),
		filename: path.basename(filePath)
	});
}

export function createPointId(relativePath: string): string {
	const digest = createHash('sha1').update(relativePath).digest();
	const bytes = Buffer.from(digest.subarray(0, 16));
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}