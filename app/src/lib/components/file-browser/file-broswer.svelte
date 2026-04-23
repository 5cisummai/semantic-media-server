<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { createEventDispatcher, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import Redo2Icon from '@lucide/svelte/icons/redo-2';
	import FileBrowserSidebar from './file-browser-sidebar.svelte';
	import FileGrid from './file-grid.svelte';
	import { fsHistory } from '$lib/hooks/fs-history.svelte';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import { IsSmallMobile } from '$lib/hooks/is-small-mobile.svelte.js';

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
	let searchQuery = $state('');
	let recursiveSearchEntries = $state<FileEntry[]>([]);
	let recursiveSearchLoaded = $state(false);

	$effect(() => {
		void currentPath;
		gridLocalSelectedPaths = [];
		searchQuery = '';
		recursiveSearchEntries = [];
		recursiveSearchLoaded = false;
	});

	const normalizedSearchQuery = $derived(searchQuery.trim().toLowerCase());

	const SEMANTIC_GROUPS = {
		image: [
			'image',
			'images',
			'photo',
			'photos',
			'pic',
			'pics',
			'picture',
			'pictures',
			'screenshot'
		],
		video: ['video', 'videos', 'movie', 'movies', 'clip', 'clips', 'film', 'films'],
		audio: ['audio', 'song', 'songs', 'music', 'track', 'tracks', 'sound', 'sounds', 'voice'],
		document: ['document', 'documents', 'doc', 'docs', 'pdf', 'text', 'note', 'notes'],
		directory: ['directory', 'directories', 'folder', 'folders', 'dir', 'collection']
	} as const;

	const SEMANTIC_LOOKUP = (() => {
		const map = new Map<string, Set<string>>();
		for (const values of Object.values(SEMANTIC_GROUPS)) {
			const group = new Set(values);
			for (const value of values) map.set(value, group);
		}
		return map;
	})();

	function tokenize(value: string): string[] {
		return value
			.toLowerCase()
			.replace(/[_\-./\\]+/g, ' ')
			.split(/\s+/)
			.filter(Boolean);
	}

	function expandSemanticTokens(tokens: string[]): Set<string> {
		const expanded = new Set<string>(tokens);
		for (const token of tokens) {
			const semanticGroup = SEMANTIC_LOOKUP.get(token);
			if (!semanticGroup) continue;
			for (const synonym of semanticGroup) expanded.add(synonym);
		}
		return expanded;
	}

	function scoreEntry(entry: FileEntry, query: string): number {
		const queryTokens = tokenize(query);
		if (queryTokens.length === 0) return 0;

		const nameLower = entry.name.toLowerCase();
		const pathLower = entry.path.toLowerCase();
		const nameTokens = tokenize(entry.name);
		const pathTokens = tokenize(entry.path);
		const kindToken = entry.type === 'directory' ? 'directory' : 'document';
		const mediaTokens = tokenize(`${entry.mediaType ?? ''} ${entry.mimeType ?? ''} ${kindToken}`);

		const entryConcepts = expandSemanticTokens([...nameTokens, ...pathTokens, ...mediaTokens]);
		const queryConcepts = expandSemanticTokens(queryTokens);

		let score = 0;

		// Lexical matching signals (word/substring/path).
		for (const token of queryTokens) {
			if (nameLower.includes(token)) score += 60;
			if (pathLower.includes(token)) score += 30;
			if (nameTokens.includes(token)) score += 25;
		}

		// Semantic overlap signal.
		for (const concept of queryConcepts) {
			if (entryConcepts.has(concept)) score += 18;
		}

		// Slight boost for full-query contiguous match.
		if (nameLower.includes(query)) score += 40;
		if (pathLower.includes(query)) score += 20;

		return score;
	}

	function flattenEntries(nodes: FileEntry[]): FileEntry[] {
		const flattened: FileEntry[] = [];
		for (const node of nodes) {
			flattened.push(node);
			if (node.type === 'directory' && node.children && node.children.length > 0) {
				flattened.push(...flattenEntries(node.children));
			}
		}
		return flattened;
	}

	$effect(() => {
		if (!browser || !normalizedSearchQuery) {
			recursiveSearchEntries = [];
			recursiveSearchLoaded = false;
			return;
		}

		const controller = new AbortController();
		recursiveSearchLoaded = false;
		const encoded = encodeBrowseSegments(currentPath);
		const url = encoded ? `/api/browse/${encoded}?recursive=1` : '/api/browse?recursive=1';

		void fetch(url, { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return (await res.json()) as FileEntry[];
			})
			.then((entries) => {
				recursiveSearchEntries = flattenEntries(entries);
				recursiveSearchLoaded = true;
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				recursiveSearchEntries = [];
				recursiveSearchLoaded = true;
			});

		return () => controller.abort();
	});

	const filteredFolderContents = $derived.by(() => {
		if (!normalizedSearchQuery) return folderContents;
		const source = recursiveSearchLoaded ? recursiveSearchEntries : folderContents;
		return source
			.map((entry) => ({ entry, score: scoreEntry(entry, normalizedSearchQuery) }))
			.filter((result) => result.score > 0)
			.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
			.map((result) => result.entry);
	});

	/** Parent may pin a single path; otherwise grid owns multi-select state. */
	const effectiveGridSelectedPaths = $derived(
		selectedPath != null && selectedPath !== '' ? [selectedPath] : gridLocalSelectedPaths
	);

	const GRID_TILE_SIZE_KEY = 'fileBrowser.gridTileSize';
	const FILE_VIEW_MODE_KEY = 'fileBrowser.viewMode';

	type FileViewMode = 'grid' | 'list';

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

	function readStoredViewMode(): FileViewMode {
		if (!browser) return 'grid';
		try {
			const raw = localStorage.getItem(FILE_VIEW_MODE_KEY);
			return raw === 'list' ? 'list' : 'grid';
		} catch {
			return 'grid';
		}
	}

	let gridTileSize = $state(42);
	let gridTileSizeReady = $state(false);
	let viewMode = $state<FileViewMode>('grid');
	let viewModeReady = $state(false);
	const isMobile = new IsMobile();
	const isSmallMobile = new IsSmallMobile();
	let showSmallMobileSearch = $state(false);

	$effect(() => {
		if (!browser || !gridTileSizeReady) return;
		localStorage.setItem(GRID_TILE_SIZE_KEY, String(gridTileSize));
	});

	$effect(() => {
		if (!browser || !viewModeReady) return;
		localStorage.setItem(FILE_VIEW_MODE_KEY, viewMode);
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
		viewMode = readStoredViewMode();
		viewModeReady = true;
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
	<header
		class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2 sm:px-4"
	>
		<Breadcrumb.Root class="min-w-0 flex-1 max-sm:order-1 max-sm:w-full sm:order-1">
			<Breadcrumb.List class="justify-start gap-1 text-left">
				<Breadcrumb.Item>
					<Button
						variant="link"
						class="h-auto p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
						onclick={() => navigateTo('')}
					>
						Root
					</Button>
				</Breadcrumb.Item>
				{#each pathSegments as segment, index (index)}
					<Breadcrumb.Separator />
					<Breadcrumb.Item>
						{#if index === pathSegments.length - 1}
							<Breadcrumb.Page class="text-sm font-semibold">{segment}</Breadcrumb.Page>
						{:else}
							<Button
								variant="link"
								class="h-auto p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
								onclick={() => navigateTo(pathSegments.slice(0, index + 1).join('/'))}
							>
								{segment}
							</Button>
						{/if}
					</Breadcrumb.Item>
				{/each}
			</Breadcrumb.List>
		</Breadcrumb.Root>

		<div
			class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:order-2 sm:order-2"
		>
			{#if !isSmallMobile.current && viewMode === 'grid'}
				<ButtonGroup title="Tile size — drag to show more or fewer columns">
					<div
						data-slot="button-group-text"
						class="flex max-w-44 min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/70 px-2.5 py-1 text-sm font-medium shadow-xs sm:max-w-52 [&_svg:not([class*='size-'])]:size-4"
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
			{/if}

			<ButtonGroup title="View mode">
				<Button
					type="button"
					variant={viewMode === 'grid' ? 'default' : 'outline'}
					size="icon-sm"
					title="Grid view"
					aria-label="Grid view"
					onclick={() => {
						viewMode = 'grid';
					}}
				>
					<LayoutGridIcon class="size-4" />
				</Button>
				<Button
					type="button"
					variant={viewMode === 'list' ? 'default' : 'outline'}
					size="icon-sm"
					title="List view"
					aria-label="List view"
					onclick={() => {
						viewMode = 'list';
					}}
				>
					<ListIcon class="size-4" />
				</Button>
			</ButtonGroup>

			<ButtonGroup>
				{#if isSmallMobile.current}
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						title={showSmallMobileSearch ? 'Hide search' : 'Show search'}
						aria-label={showSmallMobileSearch ? 'Hide search' : 'Show search'}
						onclick={() => {
							showSmallMobileSearch = !showSmallMobileSearch;
						}}
					>
						<SearchIcon class="size-4" />
					</Button>
				{/if}
				<Button
					type="button"
					variant="outline"
					size={isSmallMobile.current ? 'icon-sm' : 'sm'}
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
					size={isSmallMobile.current ? 'icon-sm' : 'sm'}
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
					size={isSmallMobile.current ? 'icon-sm' : 'sm'}
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

		{#if !isSmallMobile.current}
			<div
				class="flex min-w-56 shrink-0 items-center justify-end gap-2 max-sm:order-3 sm:order-3 sm:w-72"
			>
				<div class="relative w-full">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						bind:value={searchQuery}
						placeholder="Search this folder..."
						class="h-8 w-full rounded-lg border-border/70 bg-muted/40 pl-8"
						aria-label="Search files in this folder"
					/>
				</div>
			</div>
		{/if}

		{#if isSmallMobile.current && showSmallMobileSearch}
			<div class="order-3 w-full">
				<div class="relative w-full">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						bind:value={searchQuery}
						placeholder="Search this folder..."
						class="h-8 w-full rounded-lg border-border/70 bg-muted/40 pl-8"
						aria-label="Search files in this folder"
					/>
				</div>
			</div>
		{/if}
	</header>

	{#if isSmallMobile.current}
		<div class="flex-1 overflow-hidden">
			{#if refreshing}
				<div class="flex h-full items-center justify-center p-8 text-muted-foreground">
					Loading...
				</div>
			{:else}
				<FileGrid
					bind:this={fileGrid}
					fileTree={filteredFolderContents}
					{viewMode}
					{gridMinTilePx}
					selectedPaths={effectiveGridSelectedPaths}
					{currentPath}
					on:highlight={handleGridHighlight}
					on:activate={handleGridActivate}
					on:refresh={handleGridRefresh}
				/>
			{/if}
		</div>
	{:else}
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
						fileTree={filteredFolderContents}
						{viewMode}
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
	{/if}
</div>
