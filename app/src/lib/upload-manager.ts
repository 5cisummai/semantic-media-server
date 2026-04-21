import { get, writable } from 'svelte/store';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';
export type UploadBatchPhase = 'idle' | 'uploading' | 'indexing' | 'complete' | 'error';

export interface UploadFileItem {
	id: string;
	file: File;
	name: string;
	size: number;
	destination: string;
	workspaceId?: string | null;
	status: UploadStatus;
	progress: number;
	error?: string;
	relativePath?: string;
}

export interface UploadManagerState {
	items: UploadFileItem[];
	batchPhase: UploadBatchPhase;
	batchMessage: string | null;
	activeDestination: string;
	lastIndexedCount: number;
}

interface BatchIndexResponse {
	indexed: number;
	failed: number;
	failures?: string[];
}

const initialState: UploadManagerState = {
	items: [],
	batchPhase: 'idle',
	batchMessage: null,
	activeDestination: '',
	lastIndexedCount: 0
};

const state = writable<UploadManagerState>(initialState);

let activeUploadRun: Promise<void> | null = null;

function createUploadId() {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}

	return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function patchItem(id: string, patch: Partial<UploadFileItem>) {
	state.update((current) => ({
		...current,
		items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
	}));
}

function buildBatchMessage(uploadedCount: number, failedCount: number, indexedCount: number) {
	const uploadedLabel = `${uploadedCount} file${uploadedCount === 1 ? '' : 's'} uploaded`;
	const indexedLabel = `${indexedCount} indexed`;

	if (failedCount === 0) {
		return `${uploadedLabel}. ${indexedLabel}.`;
	}

	return `${uploadedLabel}, ${failedCount} failed. ${indexedLabel}.`;
}

async function uploadSingle(item: UploadFileItem): Promise<string | null> {
	patchItem(item.id, {
		status: 'uploading',
		progress: 0,
		error: undefined
	});

	return new Promise((resolve) => {
		const formData = new FormData();
		formData.append('file', item.file);
		formData.append('destination', item.destination);
		if (item.workspaceId) {
			formData.append('workspaceId', item.workspaceId);
		}

		const xhr = new XMLHttpRequest();

		xhr.upload.addEventListener('progress', (event) => {
			if (!event.lengthComputable) return;
			patchItem(item.id, {
				progress: Math.round((event.loaded / event.total) * 100)
			});
		});

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				const response = JSON.parse(xhr.responseText) as { relativePath?: string };
				patchItem(item.id, {
					status: 'done',
					progress: 100,
					relativePath: response.relativePath
				});
				resolve(response.relativePath ?? null);
				return;
			}

			patchItem(item.id, {
				status: 'error',
				error: `Server error ${xhr.status}`
			});
			resolve(null);
		});

		xhr.addEventListener('error', () => {
			patchItem(item.id, {
				status: 'error',
				error: 'Network error'
			});
			resolve(null);
		});

		xhr.open('POST', '/api/upload');
		xhr.send(formData);
	});
}

async function indexUploadedPaths(paths: string[]): Promise<BatchIndexResponse> {
	const response = await fetch('/api/upload/index', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({ paths })
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return (await response.json()) as BatchIndexResponse;
}

function addFiles(destination: string, incoming: FileList | File[], workspaceId?: string | null) {
	const nextItems = Array.from(incoming).map((file) => ({
		id: createUploadId(),
		file,
		name: file.name,
		size: file.size,
		destination,
		workspaceId: workspaceId ?? null,
		status: 'pending' as const,
		progress: 0
	}));

	if (nextItems.length === 0) return;

	state.update((current) => ({
		...current,
		items: [...current.items, ...nextItems],
		activeDestination: destination || current.activeDestination,
		batchPhase:
			current.batchPhase === 'complete' || current.batchPhase === 'error'
				? 'idle'
				: current.batchPhase,
		batchMessage:
			current.batchPhase === 'complete' || current.batchPhase === 'error'
				? null
				: current.batchMessage,
		lastIndexedCount:
			current.batchPhase === 'complete' || current.batchPhase === 'error'
				? 0
				: current.lastIndexedCount
	}));
}

function removeFile(id: string) {
	state.update((current) => ({
		...current,
		items: current.items.filter((item) => item.id !== id)
	}));
}

function clearErrors() {
	state.update((current) => ({
		...current,
		items: current.items.filter((item) => item.status !== 'error')
	}));
}

function clearFinished() {
	state.update((current) => ({
		...current,
		items: current.items.filter((item) => item.status !== 'done' && item.status !== 'error'),
		batchPhase: current.items.some(
			(item) => item.status === 'pending' || item.status === 'uploading'
		)
			? current.batchPhase
			: 'idle',
		batchMessage: null,
		lastIndexedCount: 0
	}));
}

function dismissBatchMessage() {
	state.update((current) => ({
		...current,
		batchPhase:
			current.batchPhase === 'uploading' || current.batchPhase === 'indexing'
				? current.batchPhase
				: 'idle',
		batchMessage: null,
		lastIndexedCount:
			current.batchPhase === 'uploading' || current.batchPhase === 'indexing'
				? current.lastIndexedCount
				: 0
	}));
}

async function uploadAll() {
	if (activeUploadRun) return activeUploadRun;

	const pendingItems = get(state).items.filter((item) => item.status === 'pending');
	if (pendingItems.length === 0) return;

	state.update((current) => ({
		...current,
		batchPhase: 'uploading',
		batchMessage: null,
		lastIndexedCount: 0,
		activeDestination:
			pendingItems[pendingItems.length - 1]?.destination ?? current.activeDestination
	}));

	activeUploadRun = (async () => {
		const uploadResults = await Promise.all(pendingItems.map((item) => uploadSingle(item)));
		const uploadedPaths = uploadResults.filter((path): path is string => Boolean(path));
		const failedCount = uploadResults.length - uploadedPaths.length;

		let indexedCount = 0;
		let finalPhase: UploadBatchPhase = 'complete';
		let batchMessage = buildBatchMessage(uploadedPaths.length, failedCount, indexedCount);

		if (uploadedPaths.length > 0) {
			state.update((current) => ({
				...current,
				batchPhase: 'indexing',
				batchMessage: null
			}));

			try {
				const indexResult = await indexUploadedPaths(uploadedPaths);
				indexedCount = indexResult.indexed;
				batchMessage = buildBatchMessage(uploadedPaths.length, failedCount, indexedCount);
			} catch (error) {
				finalPhase = 'error';
				batchMessage =
					error instanceof Error
						? `Uploads finished, but indexing failed: ${error.message}`
						: 'Uploads finished, but indexing failed.';
			}
		} else if (failedCount > 0) {
			finalPhase = 'error';
			batchMessage = `All ${failedCount} uploads failed.`;
		}

		state.update((current) => ({
			...current,
			items: current.items.filter((item) => item.status !== 'done'),
			batchPhase: finalPhase,
			batchMessage,
			lastIndexedCount: indexedCount
		}));
	})();

	try {
		await activeUploadRun;
	} finally {
		activeUploadRun = null;
	}
}

export const uploadManager = {
	subscribe: state.subscribe,
	addFiles,
	removeFile,
	clearErrors,
	clearFinished,
	dismissBatchMessage,
	uploadAll
};
