import { env } from '$env/dynamic/private';

/** Point stored in the brain (vector + payload). Backend is currently Qdrant-compatible HTTP. */
export interface BrainPoint {
	id: string;
	vector: number[];
	payload: Record<string, unknown>;
}

export interface BrainSearchHit {
	id: string | number;
	score: number;
	payload?: Record<string, unknown>;
}

interface ScrollResponse {
	result?: {
		points?: Array<{
			id: string | number;
			payload?: Record<string, unknown>;
			vector?: number[] | Record<string, number[]>;
		}>;
		next_page_offset?: string | number | null;
	};
}

interface CollectionInfoResponse {
	result?: {
		config?: {
			params?: {
				vectors?: {
					size?: number;
				};
			};
		};
	};
}

function baseUrl(): string {
	return env.QDRANT_URL ?? 'http://127.0.0.1:6333';
}

function authHeaders(): Headers {
	const headers = new Headers();
	if (env.QDRANT_API_KEY) headers.set('api-key', env.QDRANT_API_KEY);
	return headers;
}

async function request<T>(requestPath: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers ?? {});
	headers.set('Content-Type', 'application/json');
	if (env.QDRANT_API_KEY) headers.set('api-key', env.QDRANT_API_KEY);

	const response = await fetch(`${baseUrl()}${requestPath}`, {
		...init,
		headers
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Brain request failed (${response.status}): ${message}`);
	}

	return (await response.json()) as T;
}

async function collectionExists(collection: string): Promise<boolean> {
	const response = await fetch(`${baseUrl()}/collections/${collection}`, {
		headers: authHeaders()
	});
	if (response.status === 404) return false;
	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Brain request failed (${response.status}): ${message}`);
	}
	return true;
}

async function collectionVectorSize(collection: string): Promise<number | null> {
	if (!(await collectionExists(collection))) return null;

	const info = await request<CollectionInfoResponse>(`/collections/${collection}`);
	const size = info.result?.config?.params?.vectors?.size;
	return typeof size === 'number' ? size : null;
}

async function recreateCollection(collection: string, vectorSize: number): Promise<void> {
	await request(`/collections/${collection}`, {
		method: 'DELETE'
	});

	await request(`/collections/${collection}`, {
		method: 'PUT',
		body: JSON.stringify({
			vectors: {
				size: vectorSize,
				distance: 'Cosine'
			}
		})
	});
}

/**
 * Vector index / semantic memory. HTTP API matches Qdrant today; callers use `brain` only.
 */
export const brain = {
	async ensureCollection(collection: string, vectorSize: number): Promise<void> {
		const existingSize = await collectionVectorSize(collection);
		if (existingSize !== null) {
			if (existingSize === vectorSize) {
				return;
			}

			console.warn(
				`Brain collection vector size mismatch (${existingSize} != ${vectorSize}); recreating collection '${collection}'`
			);
			await recreateCollection(collection, vectorSize);
			return;
		}

		await request(`/collections/${collection}`, {
			method: 'PUT',
			body: JSON.stringify({
				vectors: {
					size: vectorSize,
					distance: 'Cosine'
				}
			})
		});
	},

	async upsertPoints(collection: string, points: BrainPoint[]): Promise<void> {
		if (points.length === 0) return;
		await request(`/collections/${collection}/points?wait=true`, {
			method: 'PUT',
			body: JSON.stringify({ points })
		});
	},

	async scrollPointIds(collection: string): Promise<Set<string>> {
		const ids = new Set<string>();
		if (!(await collectionExists(collection))) return ids;

		let offset: string | number | null = null;

		for (;;) {
			const response: ScrollResponse = await request<ScrollResponse>(
				`/collections/${collection}/points/scroll`,
				{
					method: 'POST',
					body: JSON.stringify({
						limit: 512,
						offset,
						with_vector: false,
						with_payload: false
					})
				}
			);

			const points = response.result?.points ?? [];
			for (const point of points) ids.add(String(point.id));
			offset = response.result?.next_page_offset ?? null;
			if (!offset) break;
		}

		return ids;
	},

	async deletePoints(collection: string, ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		await request(`/collections/${collection}/points/delete?wait=true`, {
			method: 'POST',
			body: JSON.stringify({ points: ids })
		});
	},

	async scrollWithFilter(
		collection: string,
		params?: {
			limit?: number;
			offset?: string | number | null;
			filter?: { must: Array<Record<string, unknown>> };
			withPayload?: boolean;
		}
	): Promise<{
		points: Array<{ id: string | number; payload?: Record<string, unknown> }>;
		nextOffset: string | number | null;
	}> {
		const response: ScrollResponse = await request<ScrollResponse>(
			`/collections/${collection}/points/scroll`,
			{
				method: 'POST',
				body: JSON.stringify({
					limit: params?.limit ?? 64,
					offset: params?.offset ?? null,
					with_vector: false,
					with_payload: params?.withPayload ?? true,
					filter: params?.filter
				})
			}
		);

		return {
			points: (response.result?.points ?? []).map((p) => ({ id: p.id, payload: p.payload })),
			nextOffset: response.result?.next_page_offset ?? null
		};
	},

	async search(
		collection: string,
		params: {
			vector: number[];
			limit: number;
			filter?: { must: Array<Record<string, unknown>> };
		}
	): Promise<BrainSearchHit[]> {
		const response = await request<{ result?: BrainSearchHit[] }>(
			`/collections/${collection}/points/search`,
			{
				method: 'POST',
				body: JSON.stringify({
					vector: params.vector,
					limit: params.limit,
					with_payload: true,
					with_vector: false,
					filter: params.filter
				})
			}
		);

		return response.result ?? [];
	}
};
