<script lang="ts" module>
	export type FileEntry = {
		id?: string;
		name: string;
		path: string;
		type: 'file' | 'directory';
		children?: FileEntry[];
	};
</script>

<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import { apiFetch } from '$lib/api-fetch';
	import { uploadManager } from '$lib/upload-manager';
	import FilePreviewTile from './file-preview-tile.svelte';

	let {
		fileTree = [],
		selectedPath = null,
		currentPath = ''
	}: { fileTree?: FileEntry[]; selectedPath?: string | null; currentPath?: string } = $props();

	const dispatch = createEventDispatcher<{ select: FileEntry; refresh: void }>();

	type FlatEntry = FileEntry & { path: string };

	function flattenEntries(entries: FileEntry[] | undefined, parentPath = ''): FlatEntry[] {
		if (!entries) return [];

		return entries.flatMap((entry) => {
			const fullPath = entry.path ?? (parentPath ? `${parentPath}/${entry.name}` : entry.name);
			const current = { ...entry, path: fullPath };
			return [current, ...(entry.children ? flattenEntries(entry.children, fullPath) : [])];
		});
	}

	const items = $derived(flattenEntries(fileTree));

	function encodeMediaPath(relativePath: string): string {
		return relativePath
			.split('/')
			.filter((s) => s.length > 0)
			.map((seg) => encodeURIComponent(seg))
			.join('/');
	}

	async function readErrorMessage(res: Response): Promise<string> {
		const text = await res.text();
		try {
			const j = JSON.parse(text) as { message?: string };
			return j.message ?? text;
		} catch {
			return text || res.statusText;
		}
	}

	function notifyRefresh() {
		dispatch('refresh');
	}

	function selectEntry(entry: FlatEntry) {
		dispatch('select', entry);
	}

	function openEntry(entry: FlatEntry) {
		selectEntry(entry);
	}

	async function copyPath(path: string) {
		try {
			await navigator.clipboard.writeText(path);
			toast('Path copied');
		} catch {
			toast.error('Could not copy', { description: path });
		}
	}

	function renameNotSupported() {
		toast.info('Rename is not available yet');
	}

	function requireDirectory(): boolean {
		if (!currentPath?.trim()) {
			toast('Pick a location', {
				description: 'Open a drive or folder in the sidebar or breadcrumb first.'
			});
			return false;
		}
		return true;
	}

	let newFolderDialogOpen = $state(false);
	let newFolderName = $state('');
	let newFolderSubmitting = $state(false);
	let newFolderError = $state<string | null>(null);

	function newFolder() {
		if (!requireDirectory()) return;
		newFolderName = '';
		newFolderError = null;
		newFolderDialogOpen = true;
	}

	async function createFolderFromDialog(event?: SubmitEvent) {
		event?.preventDefault();
		const trimmed = newFolderName.trim().replace(/[/\\]/g, '');
		if (!trimmed) {
			newFolderError = 'Enter a valid folder name.';
			return;
		}

		newFolderSubmitting = true;
		newFolderError = null;
		try {
			const newPath = `${currentPath}/${trimmed}`;
			const res = await apiFetch(`/api/mkdir/${encodeMediaPath(newPath)}`, { method: 'POST' });
			if (!res.ok) {
				newFolderError = await readErrorMessage(res);
				return;
			}

			newFolderDialogOpen = false;
			toast.success('Folder created', {
				description: trimmed
			});
			notifyRefresh();
		} finally {
			newFolderSubmitting = false;
		}
	}

	let deleteDialogOpen = $state(false);
	let deleteSubmitting = $state(false);
	let deleteError = $state<string | null>(null);
	let pendingDeleteEntry = $state<FlatEntry | null>(null);

	function requestDelete(entry: FlatEntry) {
		pendingDeleteEntry = entry;
		deleteError = null;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDeleteEntry) return;

		deleteSubmitting = true;
		deleteError = null;
		try {
			const res = await apiFetch(`/api/delete/${encodeMediaPath(pendingDeleteEntry.path)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				deleteError = await readErrorMessage(res);
				return;
			}

			const deletedName = pendingDeleteEntry.name;
			deleteDialogOpen = false;
			pendingDeleteEntry = null;
			toast.success('Deleted', {
				description: deletedName
			});
			notifyRefresh();
		} finally {
			deleteSubmitting = false;
		}
	}

	let fileInput: HTMLInputElement | undefined = $state();

	function openUploadPicker() {
		if (!requireDirectory()) return;
		fileInput?.click();
	}

	/** Header / toolbar “Upload” triggers the same file picker as the context menu. */
	export function triggerUpload() {
		openUploadPicker();
	}

	async function onUploadPicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = input.files;
		input.value = '';
		if (!files?.length || !currentPath?.trim()) return;

		uploadManager.addFiles(currentPath, files);
		uploadManager.uploadAll();
		notifyRefresh();
	}

	function refresh() {
		toast('Refreshed');
		notifyRefresh();
	}
</script>

<input
	bind:this={fileInput}
	type="file"
	class="sr-only"
	multiple
	aria-hidden="true"
	tabindex={-1}
	onchange={onUploadPicked}
/>

<Dialog.Root bind:open={newFolderDialogOpen}>
	<Dialog.Content showCloseButton={!newFolderSubmitting}>
		<Dialog.Header>
			<Dialog.Title>New folder</Dialog.Title>
			<Dialog.Description>Create a folder inside `{currentPath || 'Root'}`.</Dialog.Description>
		</Dialog.Header>

		<form class="space-y-3" onsubmit={createFolderFromDialog}>
			<div class="space-y-2">
				<Label for="new-folder-name">Folder name</Label>
				<Input
					id="new-folder-name"
					placeholder="e.g. vacation-photos"
					bind:value={newFolderName}
					disabled={newFolderSubmitting}
					autofocus
				/>
			</div>
			{#if newFolderError}
				<p class="text-sm text-destructive">{newFolderError}</p>
			{/if}

			<Dialog.Footer>
				<Button
					variant="outline"
					disabled={newFolderSubmitting}
					onclick={() => (newFolderDialogOpen = false)}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={newFolderSubmitting}>
					{newFolderSubmitting ? 'Creating...' : 'Create folder'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content showCloseButton={!deleteSubmitting}>
		<Dialog.Header>
			<Dialog.Title>Delete item</Dialog.Title>
			<Dialog.Description>
				Delete `{pendingDeleteEntry?.name ?? 'this item'}`? This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>

		{#if deleteError}
			<p class="text-sm text-destructive">{deleteError}</p>
		{/if}

		<Dialog.Footer>
			<Button
				variant="outline"
				disabled={deleteSubmitting}
				onclick={() => (deleteDialogOpen = false)}
			>
				Cancel
			</Button>
			<Button variant="destructive" onclick={confirmDelete} disabled={deleteSubmitting}>
				{deleteSubmitting ? 'Deleting...' : 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<ContextMenu.Root>
	<ContextMenu.Trigger class="flex h-full flex-col p-3">
		<div class="mb-3 flex shrink-0 items-center justify-between">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Files</p>
			<p class="text-xs text-muted-foreground">{items.length} items</p>
		</div>

		<div class="flex-1 overflow-auto">
			<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
				{#each items as item (item.path)}
					<li>
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<Button
									variant="ghost"
									class="h-auto w-full rounded-xl p-1 text-left {selectedPath === item.path
										? 'bg-muted ring-1 ring-ring/60'
										: ''}"
									onclick={() => selectEntry(item)}
								>
									<FilePreviewTile
										class="w-full"
										item={{
											name: item.name,
											path: item.path,
											url: `/api/stream/${item.path}`,
											type: item.type
										}}
									/>
								</Button>
							</ContextMenu.Trigger>
							<ContextMenu.Content class="w-48">
								<ContextMenu.Item onclick={() => openEntry(item)}>Open</ContextMenu.Item>
								<ContextMenu.Item onclick={renameNotSupported}>Rename</ContextMenu.Item>
								<ContextMenu.Item onclick={() => copyPath(item.path)}>Copy path</ContextMenu.Item>
								<ContextMenu.Separator />
								<ContextMenu.Item variant="destructive" onclick={() => requestDelete(item)}>
									Delete
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Root>
					</li>
				{/each}
			</ul>
		</div>
	</ContextMenu.Trigger>

	<ContextMenu.Content class="w-48">
		<ContextMenu.Item onclick={newFolder}>New folder</ContextMenu.Item>
		<ContextMenu.Item onclick={openUploadPicker}>Upload file</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item onclick={refresh}>Refresh</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
