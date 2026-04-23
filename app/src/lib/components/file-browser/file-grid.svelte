<script lang="ts" module>
	export type FileEntry = {
		id?: string;
		name: string;
		path: string;
		type: 'file' | 'directory';
		mediaType?: 'video' | 'audio' | 'image' | 'document' | 'other';
		mimeType?: string;
		modified?: string;
		viewerKind?: 'video' | 'audio' | 'image' | 'pdf' | 'text' | 'none';
		/** Synthetic merged-root row: show trash icon. */
		rootEntryKind?: 'trash';
		children?: FileEntry[];
	};
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { createEventDispatcher } from 'svelte';
	import { Grid } from 'svelte-virtual';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import { apiFetch } from '$lib/api-fetch';
	import { uploadManager } from '$lib/upload-manager';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
	import { fsHistory } from '$lib/hooks/fs-history.svelte';
	import { isMediaTrashSubtreePath } from '$lib/media-trash-path';
	import FilePreviewTile from './file-preview-tile.svelte';

	let {
		fileTree = [],
		selectedPaths = [],
		currentPath = '',
		gridMinTilePx = 176
	}: {
		fileTree?: FileEntry[];
		selectedPaths?: string[];
		currentPath?: string;
		/** Minimum column width — larger values produce bigger tiles and fewer columns. */
		gridMinTilePx?: number;
	} = $props();

	const dispatch = createEventDispatcher<{
		highlight: { paths: string[] };
		activate: FileEntry;
		refresh: void;
	}>();

	/** Last non-shift anchor for shift+click range selection (folder listing order). */
	let rangeAnchorPath = $state<string | null>(null);

	$effect(() => {
		void currentPath;
		rangeAnchorPath = null;
	});

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

	let gridViewportEl = $state<HTMLDivElement | undefined>();
	let viewportH = $state(400);
	let viewportW = $state(600);

	$effect(() => {
		if (!browser || !gridViewportEl) return;
		const el = gridViewportEl;
		const ro = new ResizeObserver(() => {
			viewportH = el.clientHeight;
			viewportW = el.clientWidth;
		});
		ro.observe(el);
		viewportH = el.clientHeight;
		viewportW = el.clientWidth;
		return () => ro.disconnect();
	});

	const gridColumnCount = $derived(
		Math.max(1, Math.floor(viewportW / Math.max(gridMinTilePx, 88)))
	);
	const cellWidth = $derived(Math.max(40, viewportW / gridColumnCount));
	const cellHeight = $derived(Math.ceil(cellWidth + 48));
	const gridHeight = $derived(Math.max(200, viewportH));

	function encodeMediaPath(relativePath: string): string {
		return relativePath
			.split('/')
			.filter((s) => s.length > 0)
			.map((seg) => encodeURIComponent(seg))
			.join('/');
	}

	function buildThumbnailUrl(entry: FlatEntry): string {
		const encodedPath = encodeMediaPath(entry.path);
		const version = entry.modified ? encodeURIComponent(entry.modified) : '';
		const query = version ? `?w=320&h=320&fit=cover&v=${version}` : '?w=320&h=320&fit=cover';
		return `/api/thumb/${encodedPath}${query}`;
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

	/** Right-clicked tile: use all selected if this tile is part of a multi-select; otherwise the tile alone. */
	function contextMenuTargets(clicked: FlatEntry): FlatEntry[] {
		if (selectedPaths.length > 1 && selectedPaths.includes(clicked.path)) {
			const inSelection = new Set(selectedPaths);
			return items.filter((i) => inSelection.has(i.path));
		}
		return [clicked];
	}

	function onTileContextMenuOpen(clicked: FlatEntry, open: boolean) {
		if (!open) return;
		if (!selectedPaths.includes(clicked.path)) {
			setSelection([clicked.path]);
		}
	}

	function setSelection(paths: string[]) {
		dispatch('highlight', { paths });
	}

	function activateEntry(entry: FlatEntry) {
		dispatch('activate', entry);
	}

	function onTileClick(entry: FlatEntry, e: MouseEvent) {
		const idx = items.findIndex((i) => i.path === entry.path);
		if (idx < 0) return;

		if (e.shiftKey) {
			const anchorIdx =
				rangeAnchorPath != null ? items.findIndex((i) => i.path === rangeAnchorPath) : idx;
			const start = anchorIdx >= 0 ? anchorIdx : idx;
			const lo = Math.min(start, idx);
			const hi = Math.max(start, idx);
			const paths = items.slice(lo, hi + 1).map((i) => i.path);
			setSelection(paths);
			return;
		}

		if (e.metaKey || e.ctrlKey) {
			const next = selectedPaths.includes(entry.path)
				? selectedPaths.filter((p) => p !== entry.path)
				: [...selectedPaths, entry.path];
			rangeAnchorPath = entry.path;
			setSelection(next);
			return;
		}

		const onlySelected = selectedPaths.length === 1 && selectedPaths[0] === entry.path;
		if (onlySelected) {
			activateEntry(entry);
			return;
		}

		if (selectedPaths.length > 1 && selectedPaths.includes(entry.path)) {
			setSelection([entry.path]);
			rangeAnchorPath = entry.path;
			return;
		}

		rangeAnchorPath = entry.path;
		setSelection([entry.path]);
	}

	function onTileKeydown(entry: FlatEntry, e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		if (selectedPaths.length > 1 && selectedPaths.includes(entry.path)) {
			e.preventDefault();
			activateEntry(entry);
		}
	}

	function clearSelection() {
		rangeAnchorPath = null;
		setSelection([]);
	}

	function shouldIgnoreEscapeTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return true;
		if (target.closest('[role="dialog"]')) return true;
		if (target.closest('[role="alertdialog"]')) return true;
		const tag = target.tagName.toLowerCase();
		if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
			return true;
		}
		return false;
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (selectedPaths.length === 0) return;
		if (shouldIgnoreEscapeTarget(e.target)) return;
		if (document.activeElement && shouldIgnoreEscapeTarget(document.activeElement)) return;
		e.preventDefault();
		clearSelection();
	}

	function onPanePointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('button')) return;
		if (target.closest('[role="menu"]')) return;
		if (target.closest('[data-slot="dialog-content"]')) return;
		if (selectedPaths.length === 0) return;
		clearSelection();
	}

	async function copyPathsForTargets(clicked: FlatEntry) {
		const paths = contextMenuTargets(clicked).map((e) => e.path);
		if (paths.length === 0) return;
		try {
			await navigator.clipboard.writeText(paths.join('\n'));
			toast(paths.length === 1 ? 'Path copied' : `${paths.length} paths copied`);
		} catch {
			toast.error('Could not copy', { description: paths.join('\n') });
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
			const mkdirHeaders: Record<string, string> = {};
			if (workspaceStore.activeId) mkdirHeaders['X-Workspace-Id'] = workspaceStore.activeId;
			const res = await apiFetch(`/api/mkdir/${encodeMediaPath(newPath)}`, {
				method: 'POST',
				headers: mkdirHeaders
			});
			if (!res.ok) {
				newFolderError = await readErrorMessage(res);
				return;
			}

			newFolderDialogOpen = false;
			toast.success('Folder created', {
				description: trimmed
			});
			fsHistory.refresh();
			notifyRefresh();
		} finally {
			newFolderSubmitting = false;
		}
	}

	let deleteDialogOpen = $state(false);
	let deleteSubmitting = $state(false);
	let deleteError = $state<string | null>(null);
	let pendingDeleteEntries = $state<FlatEntry[]>([]);

	function fileAndFolderCounts(entries: FlatEntry[]) {
		let files = 0;
		let dirs = 0;
		for (const e of entries) {
			if (e.type === 'directory') dirs += 1;
			else files += 1;
		}
		return { files, dirs };
	}

	function formatFileFolderPhrase(
		files: number,
		dirs: number,
		join: 'comma' | 'and'
	): string {
		if (files > 0 && dirs === 0) {
			return `${files} file${files === 1 ? '' : 's'}`;
		}
		if (dirs > 0 && files === 0) {
			return `${dirs} folder${dirs === 1 ? '' : 's'}`;
		}
		if (files > 0 && dirs > 0) {
			const f = `${files} file${files === 1 ? '' : 's'}`;
			const d = `${dirs} folder${dirs === 1 ? '' : 's'}`;
			return join === 'and' ? `${f} and ${d}` : `${f}, ${d}`;
		}
		return '0 items';
	}

	function entriesAreTrashPurge(entries: FlatEntry[]): boolean {
		return entries.length > 0 && entries.every((e) => isMediaTrashSubtreePath(e.path));
	}

	function deleteMenuLabel(targets: FlatEntry[]): string {
		const n = targets.length;
		if (n === 0) return 'Delete';
		const perm = entriesAreTrashPurge(targets);
		if (perm) {
			if (n === 1) {
				return targets[0].type === 'directory' ? 'Delete folder permanently' : 'Delete permanently';
			}
			const { files, dirs } = fileAndFolderCounts(targets);
			return `Permanently delete ${formatFileFolderPhrase(files, dirs, 'comma')}`;
		}
		if (n === 1) {
			return targets[0].type === 'directory' ? 'Delete folder' : 'Delete file';
		}
		const { files, dirs } = fileAndFolderCounts(targets);
		return `Delete ${formatFileFolderPhrase(files, dirs, 'comma')}`;
	}

	function deletedToastDescription(entries: FlatEntry[]): string {
		if (entries.length === 1) return entries[0].name;
		const { files, dirs } = fileAndFolderCounts(entries);
		return formatFileFolderPhrase(files, dirs, 'and');
	}

	/** @returns `null` on success, or an error message to display. */
	async function performDeleteEntries(entries: FlatEntry[]): Promise<string | null> {
		if (entries.length === 0) return null;
		const deleteHeaders: Record<string, string> = {};
		if (workspaceStore.activeId) deleteHeaders['X-Workspace-Id'] = workspaceStore.activeId;
		for (const entry of entries) {
			const res = await apiFetch(`/api/delete/${encodeMediaPath(entry.path)}`, {
				method: 'DELETE',
				headers: deleteHeaders
			});
			if (!res.ok) {
				return await readErrorMessage(res);
			}
		}
		const permanent = entriesAreTrashPurge(entries);
		toast.success(permanent ? 'Permanently deleted' : 'Moved to Trash', {
			description: deletedToastDescription(entries)
		});
		fsHistory.refresh();
		notifyRefresh();
		return null;
	}

	async function requestDelete(clicked: FlatEntry) {
		const entries = contextMenuTargets(clicked);
		const inTrash = entriesAreTrashPurge(entries);
		const { dirs } = fileAndFolderCounts(entries);
		if (!inTrash && dirs === 0) {
			const err = await performDeleteEntries(entries);
			if (err) {
				toast.error('Could not delete', { description: err });
			}
			return;
		}
		pendingDeleteEntries = entries;
		deleteError = null;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (pendingDeleteEntries.length === 0) return;

		deleteSubmitting = true;
		deleteError = null;
		try {
			const err = await performDeleteEntries(pendingDeleteEntries);
			if (err) {
				deleteError = err;
				return;
			}
			deleteDialogOpen = false;
			pendingDeleteEntries = [];
		} finally {
			deleteSubmitting = false;
		}
	}

	const pendingPermanentPurge = $derived(entriesAreTrashPurge(pendingDeleteEntries));

	const deleteDialogTitle = $derived.by(() => {
		const list = pendingDeleteEntries;
		const n = list.length;
		if (n === 0) return 'Delete';
		const perm = list.every((e) => isMediaTrashSubtreePath(e.path));
		if (perm) {
			if (n === 1) {
				return list[0].type === 'directory' ? 'Delete folder permanently?' : 'Delete permanently?';
			}
			const { files, dirs } = fileAndFolderCounts(list);
			return `Permanently delete ${formatFileFolderPhrase(files, dirs, 'comma')}?`;
		}
		if (n === 1) {
			return list[0].type === 'directory' ? 'Delete folder' : 'Delete file';
		}
		const { files, dirs } = fileAndFolderCounts(list);
		return `Delete ${formatFileFolderPhrase(files, dirs, 'comma')}`;
	});

	const deleteDialogDescription = $derived.by(() => {
		const list = pendingDeleteEntries;
		const n = list.length;
		const perm = n > 0 && list.every((e) => isMediaTrashSubtreePath(e.path));
		const permanentWarning =
			'This cannot be undone. The selection will be removed from disk and will not be recoverable through this app.';
		if (perm) {
			if (n === 1) {
				return list[0].type === 'directory'
					? `Permanently delete folder \`${list[0].name}\` and everything inside it? ${permanentWarning}`
					: `Permanently delete \`${list[0].name}\`? ${permanentWarning}`;
			}
			const { files, dirs } = fileAndFolderCounts(list);
			const hasDirs = dirs > 0;
			return `This will permanently remove ${formatFileFolderPhrase(
				files,
				dirs,
				'and'
			)}.${hasDirs ? ' Selected folders and everything inside them will be permanently deleted.' : ''} ${permanentWarning}`;
		}
		const undoHint =
			' You can restore with Undo (Ctrl+Z) or open Trash from the root folder (trash icon).';
		if (n === 0) return `Items are moved to the Trash folder on disk.${undoHint}`;
		if (n === 1) {
			return list[0].type === 'directory'
				? `Move folder \`${list[0].name}\` and its contents to Trash?${undoHint}`
				: `Move \`${list[0].name}\` to Trash?${undoHint}`;
		}
		const { files, dirs } = fileAndFolderCounts(list);
		const hasDirs = dirs > 0;
		return `This will move ${formatFileFolderPhrase(
			files,
			dirs,
			'and'
		)} to Trash.${hasDirs ? ' Selected folders and everything inside them are included.' : ''}${undoHint}`;
	});

	let fileInput: HTMLInputElement | undefined = $state();
	/** Bound to the grid background context menu so we can close it after opening the file picker. */
	let gridContextMenuOpen = $state(false);

	function openUploadPicker() {
		if (!requireDirectory()) return;
		fileInput?.click();
	}

	/**
	 * Opening a hidden file input from a context menu item must not close the menu in the same
	 * turn: bits-ui closes the menu after select, which can unmount the portal and cancel the
	 * native file picker (no change event, no `/api/upload` request). We prevent that close,
	 * trigger the picker, then dismiss the menu on a microtask.
	 */
	function onUploadMenuSelect(e: Event) {
		if (!requireDirectory()) return;
		e.preventDefault();
		fileInput?.click();
		queueMicrotask(() => {
			gridContextMenuOpen = false;
		});
	}

	/** Header / toolbar “Upload” triggers the same file picker as the context menu. */
	export function triggerUpload() {
		openUploadPicker();
	}

	/** Header / toolbar “New folder” opens the same dialog as the grid context menu. */
	export function triggerNewFolder() {
		newFolder();
	}

	async function onUploadPicked(event: Event) {
		const input = event.target as HTMLInputElement;
		// Clone files to preserve them before resetting input
		const fileArray = input.multiple
			? Array.from(input.files || [])
			: input.files
				? [input.files[0]]
				: [];

		// Reset input to allow re-selecting same files
		input.value = '';

		if (!fileArray.length) {
			toast('No files selected');
			return;
		}
		if (!currentPath?.trim()) {
			toast('Pick a location', { description: 'Open a folder first' });
			return;
		}

		const fileList = new DataTransfer();
		fileArray.forEach((f) => fileList.items.add(f));
		uploadManager.addFiles(currentPath, fileList.files, workspaceStore.activeId);
		uploadManager.uploadAll();
		fsHistory.refresh();
		notifyRefresh();
		toast('Uploading', { description: `${fileArray.length} file(s)` });
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
	tabindex={-1}
	onchange={onUploadPicked}
/>

<svelte:window onkeydown={onWindowKeydown} />

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
			<Dialog.Title>{deleteDialogTitle}</Dialog.Title>
			<Dialog.Description>
				{deleteDialogDescription}
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
				{deleteSubmitting
					? 'Deleting...'
					: pendingPermanentPurge
						? 'Delete permanently'
						: 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<ContextMenu.Root bind:open={gridContextMenuOpen}>
	<ContextMenu.Trigger class="flex h-full flex-col p-3">
		<div
			class="flex min-h-0 min-w-0 flex-1 flex-col"
			role="presentation"
			onpointerdown={onPanePointerDown}
		>
			<div class="mb-3 flex shrink-0 items-center justify-between">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Files</p>
				<p class="text-xs text-muted-foreground">{items.length} items</p>
			</div>

			<div class="min-h-0 min-w-0 flex-1" bind:this={gridViewportEl}>
				{#if items.length === 0}
					<div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
						This folder is empty.
					</div>
				{:else}
					<Grid
						itemCount={items.length}
						itemHeight={cellHeight}
						itemWidth={cellWidth}
						height={gridHeight}
						columnCount={gridColumnCount}
						overScan={2}
						class="rounded-md"
						role="listbox"
						aria-multiselectable="true"
						getKey={(index) => items[index]?.path ?? index}
					>
						{#snippet item({ index, style })}
							{@const item = items[index]}
							{#if item}
								{@const targets = contextMenuTargets(item)}
								<div role="presentation" class="box-border min-h-0 min-w-0 p-0.5" {style}>
									<ContextMenu.Root onOpenChange={(open) => onTileContextMenuOpen(item, open)}>
										<ContextMenu.Trigger class="block h-full min-h-0 w-full">
											<Button
												type="button"
												variant="ghost"
												role="option"
												aria-selected={selectedPaths.includes(item.path)}
												class="aspect-square h-full min-h-0 w-full flex-col items-stretch justify-start gap-1 rounded-xl p-1 text-center whitespace-normal {selectedPaths.includes(
													item.path
												)
													? 'bg-muted'
													: ''}"
												onclick={(e) => onTileClick(item, e)}
												onkeydown={(e) => onTileKeydown(item, e)}
											>
												<FilePreviewTile
													class="h-full min-h-0 w-full"
													item={{
														name: item.name,
														path: item.path,
														url: buildThumbnailUrl(item),
														type: item.type,
														mimeType: item.mimeType,
														viewerKind: item.viewerKind,
														rootEntryKind: item.rootEntryKind
													}}
												/>
											</Button>
										</ContextMenu.Trigger>
										<ContextMenu.Content class="w-56">
											{#if targets.length === 1}
												<ContextMenu.Item onclick={() => activateEntry(targets[0])}
													>Open</ContextMenu.Item
												>
												<ContextMenu.Item onclick={renameNotSupported}>Rename</ContextMenu.Item>
											{/if}
											<ContextMenu.Item onclick={() => copyPathsForTargets(item)}
												>{targets.length === 1 ? 'Copy path' : `Copy ${targets.length} paths`}</ContextMenu.Item
											>
											<ContextMenu.Separator />
											<ContextMenu.Item
												variant="destructive"
												onclick={() => requestDelete(item)}
											>
												{deleteMenuLabel(targets)}
											</ContextMenu.Item>
										</ContextMenu.Content>
									</ContextMenu.Root>
								</div>
							{/if}
						{/snippet}
					</Grid>
				{/if}
			</div>
		</div>
	</ContextMenu.Trigger>

	<ContextMenu.Content class="w-48">
		<ContextMenu.Item onclick={newFolder}>New folder</ContextMenu.Item>
		<ContextMenu.Item onSelect={onUploadMenuSelect}>Upload file</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item onclick={refresh}>Refresh</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
