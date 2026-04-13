import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';

export type EmbeddingProvider = 'multimodal' | 'ollama' | 'openai';

/** Whether text is a search query or a document passage being indexed. */
export type EmbeddingRole = 'query' | 'passage';

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

/** Mean-pool token embeddings (Jina fork uses --pooling none; server returns one vector per token). */
function meanPoolRows(rows: number[][]): number[] {
	if (rows.length === 0) return [];
	const dim = rows[0].length;
	const out = new Array<number>(dim).fill(0);
	for (const row of rows) {
		for (let j = 0; j < dim; j++) out[j] += row[j] ?? 0;
	}
	const n = rows.length;
	for (let j = 0; j < dim; j++) out[j] /= n;
	return out;
}

function isNumberMatrix(x: unknown): x is number[][] {
	return (
		Array.isArray(x) &&
		x.length > 0 &&
		Array.isArray(x[0]) &&
		x[0].every((v) => typeof v === 'number')
	);
}

/**
 * Extract a single embedding vector from a Jina/OAI embedding response.
 *
 * Handles all known response shapes:
 *   1. OAI format: `{ data: [{ embedding: number[] }] }`
 *   2. Jina non-OAI: `{ embedding: number[] }` (single flat vector, e.g. with --pooling mean)
 *   3. Jina token-level: `{ data: [{ embedding: number[][] }] }` or `{ embedding: number[][] }`
 *      (one vector per token when --pooling none; client must mean-pool)
 *   4. Nested results array: `{ results: [{ embedding: number[] }] }`
 */
function embeddingFromMultimodalResponse(body: unknown): number[] {
	const o = body as {
		data?: Array<{ embedding?: unknown }>;
		embedding?: unknown;
		results?: Array<{ embedding?: unknown }>;
	};

	// Try multiple locations where the embedding might live
	const candidates = [
		o.data?.[0]?.embedding,
		o.embedding,
		o.results?.[0]?.embedding
	];

	for (const raw of candidates) {
		if (raw === undefined || raw === null) continue;

		// Flat vector: number[]
		if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
			return raw as number[];
		}
		// Token-level matrix: number[][] → mean-pool
		if (isNumberMatrix(raw)) {
			return meanPoolRows(raw);
		}
	}

	// Provide a useful error with the actual response shape
	const keys = typeof body === 'object' && body !== null ? Object.keys(body) : [];
	throw new Error(
		`Multimodal embedding response did not include a recognizable embedding vector. ` +
			`Response keys: [${keys.join(', ')}]`
	);
}

export function getEmbeddingProvider(): EmbeddingProvider {
	const provider = (
		env.EMBEDDING_PROVIDER ?? (env.MULTIMODAL_EMBEDDING_URL ? 'multimodal' : 'ollama')
	).toLowerCase();
	if (provider === 'openai') return 'openai';
	if (provider === 'multimodal' || provider === 'qwen-vl') return 'multimodal';
	return 'ollama';
}

function guessMimeType(filename?: string): string {
	if (!filename) return 'image/jpeg';
	const ext = (filename.split('.').pop() ?? '').toLowerCase();
	const map: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
		tiff: 'image/tiff',
		tif: 'image/tiff',
		avif: 'image/avif',
		heic: 'image/heic',
		heif: 'image/heif'
	};
	return map[ext] ?? 'image/jpeg';
}

type MultimodalInput =
	| { type: 'text'; text: string; role?: EmbeddingRole }
	| { type: 'image'; imageBase64: string; filename?: string }
	| {
			type: 'text+image';
			text: string;
			imageBase64: string;
			filename?: string;
			role?: EmbeddingRole;
	  };

/**
 * Calls Jina llama-server POST /embeddings (non-OAI handler).
 *
 * The fork rejects `--pooling mean` for embedding tasks ("use token-level embeddings only").
 * Start llama-server with `--pooling none` and mean-pool token vectors here to match Jina v4.
 *
 * Non-OAI JSON uses `content` (not `prompt`) plus optional `image` data URI — see
 * jina-ai/llama.cpp `handle_embeddings_impl` (oaicompat false → data.at("content")).
 */
async function embedWithMultimodal(input: MultimodalInput): Promise<number[]> {
	const rawUrl = env.MULTIMODAL_EMBEDDING_URL;
	if (!rawUrl) {
		throw new Error('MULTIMODAL_EMBEDDING_URL is required when EMBEDDING_PROVIDER=multimodal');
	}

	// Normalize base URL: strip trailing slashes
	const base = rawUrl.trim().replace(/\/+$/, '');

	// Resolve the endpoint: always use the non-OAI `/embeddings` path for Jina fork
	// (full token matrix for client-side mean pooling). Strip any existing path suffix first.
	let endpoint: string;
	if (base.endsWith('/embeddings')) {
		endpoint = base;
	} else if (base.endsWith('/v1/embeddings')) {
		endpoint = `${base.slice(0, -'/v1/embeddings'.length)}/embeddings`;
	} else if (base.endsWith('/v1')) {
		endpoint = `${base.slice(0, -'/v1'.length)}/embeddings`;
	} else {
		endpoint = `${base}/embeddings`;
	}

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (env.MULTIMODAL_EMBEDDING_API_KEY) {
		headers.Authorization = `Bearer ${env.MULTIMODAL_EMBEDDING_API_KEY}`;
	}

	const model = env.MULTIMODAL_EMBEDDING_MODEL?.trim();

	const payload: Record<string, unknown> = {};

	if (input.type === 'text') {
		const prefix = (input.role ?? 'passage') === 'query' ? 'Query: ' : 'Passage: ';
		payload.content = prefix + input.text;
	} else if (input.type === 'image') {
		const mime = guessMimeType(input.filename);
		const imagePrompt =
			env.MULTIMODAL_IMAGE_PROMPT?.trim() ||
			'Describe the image.';
		payload.content = imagePrompt;
		payload.image = `data:${mime};base64,${input.imageBase64}`;
	} else {
		const prefix = (input.role ?? 'passage') === 'query' ? 'Query: ' : 'Passage: ';
		const mime = guessMimeType(input.filename);
		payload.content = prefix + input.text;
		payload.image = `data:${mime};base64,${input.imageBase64}`;
	}

	if (model) payload.model = model;

	let response: globalThis.Response;
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload)
		});
	} catch (fetchErr) {
		const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
		throw new Error(
			`Multimodal embedding server unreachable at ${endpoint}: ${msg}. ` +
				`Ensure the Jina llama-server is running (startup.sh) and MULTIMODAL_EMBEDDING_URL is correct.`
		);
	}

	if (!response.ok) {
		let detail = '';
		try {
			const text = await response.text();
			if (text) {
				try {
					const parsed = JSON.parse(text) as {
						detail?: unknown;
						error?: { message?: string };
					};
					detail =
						typeof parsed.detail === 'string'
							? parsed.detail
							: typeof parsed.error?.message === 'string'
								? parsed.error.message
								: JSON.stringify(parsed.detail ?? parsed.error ?? parsed);
				} catch {
					detail = text.length > 800 ? `${text.slice(0, 800)}…` : text;
				}
			}
		} catch {
			/* ignore body-read errors */
		}
		const kind = input.type;
		const fileHint = 'filename' in input && input.filename ? `, ${input.filename}` : '';
		const sizeHint =
			input.type === 'image'
				? ` base64Length=${input.imageBase64.length}`
				: input.type === 'text'
					? ` textLength=${input.text.length}`
					: '';
		throw new Error(
			`Multimodal embedding request failed: ${response.status} ${response.statusText} (${kind}${fileHint})${sizeHint}${detail ? ` — ${detail}` : ''}`
		);
	}

	const resBody = await response.json();
	const embedding = embeddingFromMultimodalResponse(resBody);
	return normalizeVector(embedding);
}

/** When false, skip image embedding and fall back to metadata-only text vectors. */
function semanticImageEmbeddingEnabled(): boolean {
	const v = env.SEMANTIC_IMAGE_EMBEDDING?.trim().toLowerCase();
	if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
	return false;
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
		throw new Error(
			'OPENAI_EMBED_MODEL (or OPENAI_MODEL) is required when EMBEDDING_PROVIDER=openai'
		);
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
		throw new Error(
			`OpenAI-compatible embedding request failed: ${response.status} ${response.statusText}`
		);
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

/**
 * Embed a text string.
 *
 * @param role - 'query' for search queries (prefixed "Query: "),
 *               'passage' for documents being indexed (prefixed "Passage: ").
 *               Only applied for the multimodal provider; other providers ignore it.
 */
export async function embedText(
	input: string,
	role: EmbeddingRole = 'passage'
): Promise<EmbeddingResult> {
	const provider = getEmbeddingProvider();
	let vector: number[];

	if (provider === 'multimodal') {
		vector = await embedWithMultimodal({ type: 'text', text: input, role });
	} else if (provider === 'openai') {
		vector = await embedTextWithOpenAICompatible(input);
	} else {
		vector = await embedTextWithOllama(input);
	}

	return { vector, provider };
}

/**
 * Embed an image file.
 *
 * Returns null if the provider is not multimodal or if
 * SEMANTIC_IMAGE_EMBEDDING is not enabled.
 */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB — skip anything larger

export async function embedImage(filePath: string): Promise<number[] | null> {
	const provider = getEmbeddingProvider();
	if (provider !== 'multimodal') return null;
	if (!semanticImageEmbeddingEnabled()) return null;

	const stat = await fs.stat(filePath);
	if (stat.size > MAX_IMAGE_BYTES) {
		console.warn(`[embedding] skipping oversized image (${(stat.size / 1024 / 1024).toFixed(1)} MB): ${filePath}`);
		return null;
	}

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

/**
 * Check if the configured embedding provider is reachable.
 * Returns `{ ok: true }` or `{ ok: false, error: string }`.
 */
export async function checkEmbeddingHealth(): Promise<{ ok: boolean; error?: string }> {
	const provider = getEmbeddingProvider();
	try {
		if (provider === 'multimodal') {
			const rawUrl = env.MULTIMODAL_EMBEDDING_URL;
			if (!rawUrl) return { ok: false, error: 'MULTIMODAL_EMBEDDING_URL is not set' };
			// Strip path components (/embeddings, /v1/embeddings, etc.) to reach server root /health
			const urlObj = new URL(rawUrl.trim());
			const response = await fetch(`${urlObj.origin}/health`, { signal: AbortSignal.timeout(5000) });
			if (!response.ok) return { ok: false, error: `Health check returned ${response.status}` };
			return { ok: true };
		}
		if (provider === 'ollama') {
			const baseUrl = env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
			const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
			if (!response.ok) return { ok: false, error: `Ollama returned ${response.status}` };
			return { ok: true };
		}
		// openai — just assume reachable (no standard health endpoint)
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
