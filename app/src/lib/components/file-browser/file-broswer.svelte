<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { createEventDispatcher, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import Redo2Icon from '@lucide/svelte/icons/redo-2';
	import FileBrowserSidebar from './file-browser-sidebar.svelte';
	import FileGrid from './file-grid.svelte';
	import { fsHistory } from '$lib/hooks/fs-history.svelte';

	import type { FileEntry } from './file-grid.svelte';
	import type { FileTreeNode } from './file-tree.svelte';

	let {
		fileTree = [],
		folderContents = [],
		selectedPath = null,
		currentPath = ''
	}: {
		fileTree?: FileEntry[];
		folderContents?: FileEntry[];
		/** When set, overrides grid-only keyboard/mouse selection highlight. */
		selectedPath?: string | null;
		currentPath?: string;
	} = $props();

	let sidebarTree = $state<FileEntry[]>([]);

	function encodeBrowseSegments(relativePath: string): string {
		return relativePath
			.split('/')
			.filter((s) => s.length > 0)
			.map((seg) => encodeURIComponent(seg))
			.join('/');
	}

	async function fetchBrowseFolderChildren(path: string): Promise<FileTreeNode[]> {
		const encoded = encodeBrowseSegments(path);
		const url = encoded ? `/api/browse/${encoded}` : '/api/browse';
		const res = await fetch(url);
		if (!res.ok) return [];
		const rows = (await res.json()) as Array<{
			name: string;
			path: string;
			type: 'file' | 'directory';
		}>;
		return rows.map((r) => ({
			name: r.name,
			path: r.path,
			type: r.type,
			children: r.type === 'directory' ? [] : undefined
		}));
	}

	function mergeChildrenAtPath(
		nodes: FileEntry[],
		targetPath: string,
		newChildren: FileEntry[]
	): FileEntry[] {
		return nodes.map((node) => {
			if (node.path === targetPath && node.type === 'directory') {
				return { ...node, children: newChildren };
			}
			if (node.type === 'directory' && node.children != null) {
				return { ...node, children: mergeChildrenAtPath(node.children, targetPath, newChildren) };
			}
			return node;
		});
	}

	function handleFolderChildrenLoaded(path: string, children: FileTreeNode[]) {
		sidebarTree = mergeChildrenAtPath(sidebarTree, path, children as FileEntry[]);
	}

	$effect(() => {
		void fileTree;
		sidebarTree = structuredClone(fileTree);
	});

	let gridLocalSelectedPaths = $state<string[]>([]);

	$effect(() => {
		void currentPath;
		gridLocalSelectedPaths = [];
	});

	/** Parent may pin a single path; otherwise grid owns multi-select state. */
	const effectiveGridSelectedPaths = $derived(
		selectedPath != null && selectedPath !== '' ? [selectedPath] : gridLocalSelectedPaths
	);

	const GRID_TILE_SIZE_KEY = 'fileBrowser.gridTileSize';

	function readStoredGridTileSize(): number {
		if (!browser) return 42;
		try {
			const raw = localStorage.getItem(GRID_TILE_SIZE_KEY);
			if (raw == null) return 42;
			const n = Number.parseInt(raw, 10);
			if (Number.isNaN(n) || n < 0 || n > 100) return 42;
			return n;
		} catch {
			return 42;
		}
	}

	let gridTileSize = $state(42);
	let gridTileSizeReady = $state(false);

	$effect(() => {
		if (!browser || !gridTileSizeReady) return;
		localStorage.setItem(GRID_TILE_SIZE_KEY, String(gridTileSize));
	});

	/** Minimum column width (px) for the file grid — larger values yield bigger tiles. */
	const gridMinTilePx = $derived(Math.round(88 + (gridTileSize / 100) * 200));

	const dispatch = createEventDispatcher<{ select: FileEntry; pathChange: string }>();
	let fileGrid = $state<{
		triggerUpload: () => void;
		triggerNewFolder: () => void;
	} | null>(null);
	let refreshing = $state(false);

	onMount(() => {
		gridTileSize = readStoredGridTileSize();
		gridTileSizeReady = true;
		fsHistory.refresh();
	});

	function handleSidebarSelect(event: CustomEvent<{ path: string; kind: 'file' | 'directory' }>) {
		const { path, kind } = event.detail;
		if (kind === 'directory') {
			if (path) dispatch('pathChange', path);
			return;
		}
		gridLocalSelectedPaths = [];
		dispatch('select', { path, name: path.split('/').pop() ?? '', type: 'file' });
	}

	function handleGridHighlight(event: CustomEvent<{ paths: string[] }>) {
		gridLocalSelectedPaths = event.detail.paths;
	}

	function handleGridActivate(event: CustomEvent<FileEntry>) {
		const entry = event.detail;
		if (entry.type === 'directory') {
			dispatch('pathChange', entry.path);
		} else {
			dispatch('select', entry);
		}
	}

	async function handleGridRefresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	function navigateTo(path: string) {
		dispatch('pathChange', path);
	}

	async function handleUndo() {
		const result = await fsHistory.undo();
		if (result.success && result.description) {
			toast.success(result.description);
		} else if (!result.success && result.error) {
			toast.error(result.error);
		}
	}

	async function handleRedo() {
		const result = await fsHistory.redo();
		if (result.success && result.description) {
			toast.success(result.description);
		} else if (!result.success && result.error) {
			toast.error(result.error);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		const isMac = navigator.platform.toUpperCase().includes('MAC');
		const ctrlOrCmd = isMac ? event.metaKey : event.ctrlKey;
		if (!ctrlOrCmd) return;

		// Don't intercept when typing in inputs/textareas
		const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
		if (tag === 'input' || tag === 'textarea' || (event.target as HTMLElement)?.isContentEditable) {
			return;
		}

		if (event.key === 'z' && !event.shiftKey) {
			event.preventDefault();
			handleUndo();
		} else if (event.key === 'z' && event.shiftKey) {
			event.preventDefault();
			handleRedo();
		} else if (event.key === 'y') {
			event.preventDefault();
			handleRedo();
		}
	}

	const pathSegments = $derived(currentPath ? currentPath.split('/').filter(Boolean) : []);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col overflow-hidden">
	<header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
		<Breadcrumb.Root class="min-w-0 flex-1">
			<Breadcrumb.List>
				<Breadcrumb.Item>
					<Button
						variant="link"
						class="h-auto p-0 text-sm font-medium text-muted-foreground"
						onclick={() => navigateTo('')}
					>
						Root
					</Button>
				</Breadcrumb.Item>
				{#each pathSegments as segment, index (index)}
					<Breadcrumb.Separator />
					<Breadcrumb.Item>
						{#if index === pathSegments.length - 1}
							<Breadcrumb.Page class="text-sm font-medium">{segment}</Breadcrumb.Page>
						{:else}
							<Button
								variant="link"
								class="h-auto p-0 text-sm font-medium text-muted-foreground"
								onclick={() => navigateTo(pathSegments.slice(0, index + 1).join('/'))}
							>
								{segment}
							</Button>
						{/if}
					</Breadcrumb.Item>
				{/each}
			</Breadcrumb.List>
		</Breadcrumb.Root>

		<div class="flex shrink-0 flex-wrap items-center gap-2">
			<ButtonGroup title="Tile size — drag to show more or fewer columns">
				<div
					data-slot="button-group-text"
					class="flex max-w-[11rem] min-w-0 items-center gap-2 rounded-md border bg-muted px-2.5 py-1 text-sm font-medium shadow-xs sm:max-w-[13rem] [&_svg:not([class*='size-'])]:size-4"
				>
					<LayoutGridIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<input
						type="range"
						min="0"
						max="100"
						bind:value={gridTileSize}
						class="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-primary [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background"
						aria-label="File grid tile size"
					/>
				</div>
			</ButtonGroup>

			<ButtonGroup>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="gap-1.5"
					disabled={refreshing}
					title="Reload folder contents"
					aria-label="Refresh"
					onclick={() => handleGridRefresh()}
				>
					<RefreshCwIcon class={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
					<span class="hidden sm:inline">Refresh</span>
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="gap-1.5"
					disabled={refreshing}
					title="Create a new folder in the current path"
					aria-label="New folder"
					onclick={() => fileGrid?.triggerNewFolder()}
				>
					<FolderPlusIcon class="size-4" />
					<span class="hidden sm:inline">New folder</span>
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="gap-1.5"
					disabled={refreshing}
					title="Upload files"
					aria-label="Upload"
					onclick={() => fileGrid?.triggerUpload()}
				>
					<UploadIcon class="size-4" />
					<span class="hidden sm:inline">Upload</span>
				</Button>
			</ButtonGroup>

			<ButtonGroup title="History">
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					disabled={!fsHistory.canUndo || fsHistory.loading}
					title="Undo (Ctrl+Z)"
					aria-label="Undo"
					onclick={handleUndo}
				>
					<Undo2Icon class="size-4" />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					disabled={!fsHistory.canRedo || fsHistory.loading}
					title="Redo (Ctrl+Shift+Z)"
					aria-label="Redo"
					onclick={handleRedo}
				>
					<Redo2Icon class="size-4" />
				</Button>
			</ButtonGroup>
		</div>
	</header>

	<Resizable.PaneGroup direction="horizontal" class="flex-1">
		<Resizable.Pane defaultSize={20} minSize={15} maxSize={40} class="overflow-hidden">
			<div class="h-full overflow-hidden">
				<FileBrowserSidebar
					tree={sidebarTree}
					activePath={currentPath}
					folderChildrenLoader={fetchBrowseFolderChildren}
					mergeFolderChildren={handleFolderChildrenLoaded}
					on:select={handleSidebarSelect}
				/>
			</div>
		</Resizable.Pane>
		<Resizable.Handle withHandle />
		<Resizable.Pane class="overflow-hidden">
			{#if refreshing}
				<div class="flex h-full items-center justify-center p-8 text-muted-foreground">
					Loading...
				</div>
			{:else}
				<FileGrid
					bind:this={fileGrid}
					fileTree={folderContents}
					{gridMinTilePx}
					selectedPaths={effectiveGridSelectedPaths}
					{currentPath}
					on:highlight={handleGridHighlight}
					on:activate={handleGridActivate}
					on:refresh={handleGridRefresh}
				/>
			{/if}
		</Resizable.Pane>
	</Resizable.PaneGroup>
</div>
