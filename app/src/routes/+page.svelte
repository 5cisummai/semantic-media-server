<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		Home,
		HardDrive,
		Server,
		Upload,
		Grid,
		List,
		AlertCircle,
		Search,
		RefreshCw,
		X,
		FolderPlus
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import MediaIcon from '$lib/components/media-icon.svelte';
	import { page } from '$app/stores';
	type MediaType = 'video' | 'audio' | 'image' | 'document' | 'other';

	interface Entry {
		name: string;
		path: string;
		type: 'file' | 'directory';
		mediaType?: MediaType;
		mimeType?: string;
		size?: number;
		modified?: string;
	}

	interface SearchResponseItem {
		name: string;
		path: string;
		type: 'file';
		mediaType?: MediaType;
		mimeType?: string;
		size?: number;
		modified?: string;
	}

	interface SearchResponse {
		results: SearchResponseItem[];
	}

	interface DriveInfo {
		index: number;
		name: string;
		available: boolean;
	}

	let entries = $state<Entry[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let viewMode = $state<'grid' | 'list'>('grid');
	let currentPath = $state('');
	let drives = $state<DriveInfo[]>([]);

	let semanticQuery = $state('');
	let semanticMediaType = $state('');
	let semanticRoot = $state('');
	let semanticResults = $state<Entry[]>([]);
	let semanticLoading = $state(false);
	let semanticError = $state<string | null>(null);
	let reindexing = $state(false);
	let reindexMessage = $state<string | null>(null);
	let selectedPaths = $state<string[]>([]);
	let selectionAnchorPath = $state<string | null>(null);
	let deletingPath = $state<string | null>(null);
	let deletingSelected = $state(false);
	let creatingFolder = $state(false);

	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let searchAbortController: AbortController | null = null;

	let isSemanticMode = $derived(semanticQuery.trim().length > 0);
	let canCreateFolder = $derived(!isSemanticMode && currentPath !== '');
	let displayEntries = $derived(isSemanticMode ? semanticResults : entries);
	let selectedPathSet = $derived(new Set(selectedPaths));
	let selectedCount = $derived(selectedPaths.length);
	let selectedEntries = $derived(displayEntries.filter((entry) => selectedPathSet.has(entry.path)));
	let hasVisibleImages = $derived(
		displayEntries.some((entry) => entry.type === 'file' && entry.mediaType === 'image')
	);

	let breadcrumbs = $derived.by(() => {
		if (!currentPath) return [];
		const parts = currentPath.split('/').filter(Boolean);
		return parts.map((part, i) => ({
			name: i === 0 ? 'Drive ' + part : part,
			path: parts.slice(0, i + 1).join('/')
		}));
	});

	async function browse(path: string) {
		loading = true;
		error = null;
		currentPath = path;
		selectedPaths = [];
		selectionAnchorPath = null;
		try {
			const res = await fetch(`/api/browse${path ? '/' + path : ''}`);
			if (!res.ok) throw new Error(await res.text());
			entries = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	async function loadDrives() {
		try {
			const res = await fetch('/api/storage');
			if (!res.ok) return;
			const data = (await res.json()) as DriveInfo[];
			drives = data.filter((drive) => drive.available);
		} catch {
			// Drive list is optional for semantic root filter.
		}
	}

	function toEntry(item: SearchResponseItem): Entry {
		return {
			name: item.name,
			path: item.path,
			type: 'file',
			mediaType: item.mediaType,
			mimeType: item.mimeType,
			size: item.size,
			modified: item.modified
		};
	}

	function clearSemanticSearch() {
		semanticResults = [];
		semanticError = null;
		semanticLoading = false;
		selectedPaths = [];
		selectionAnchorPath = null;
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = null;
		}
		if (searchAbortController) {
			searchAbortController.abort();
			searchAbortController = null;
		}
	}

	async function runSemanticSearch() {
		const query = semanticQuery.trim();
		if (!query) {
			clearSemanticSearch();
			return;
		}

		if (searchAbortController) searchAbortController.abort();
		const controller = new AbortController();
		searchAbortController = controller;

		const params = [`q=${encodeURIComponent(query)}`];
		if (semanticMediaType) params.push(`mediaType=${encodeURIComponent(semanticMediaType)}`);
		if (semanticRoot) params.push(`root=${encodeURIComponent(semanticRoot)}`);

		semanticLoading = true;
		semanticError = null;

		try {
			const res = await fetch(`/api/search?${params.join('&')}`, {
				signal: controller.signal
			});
			if (!res.ok) throw new Error(await res.text());
			const body = (await res.json()) as SearchResponse;
			semanticResults = (body.results ?? []).map(toEntry);
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') return;
			semanticError = e instanceof Error ? e.message : 'Semantic search failed';
			semanticResults = [];
		} finally {
			if (searchAbortController === controller) {
				semanticLoading = false;
				searchAbortController = null;
			}
		}
	}

	function queueSemanticSearch() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		if (!semanticQuery.trim()) {
			clearSemanticSearch();
			return;
		}
		searchDebounceTimer = setTimeout(() => {
			searchDebounceTimer = null;
			void runSemanticSearch();
		}, 250);
	}

	function handleSemanticInput() {
		reindexMessage = null;
		selectedPaths = [];
		selectionAnchorPath = null;
		queueSemanticSearch();
	}

	function handleSemanticFilterChange() {
		reindexMessage = null;
		selectedPaths = [];
		selectionAnchorPath = null;
		if (isSemanticMode) queueSemanticSearch();
	}

	function canDeleteEntry(entry: Entry) {
		if (entry.type === 'file') return true;
		if (entry.type !== 'directory') return false;
		return !isDriveRootEntry(entry);
	}

	function canSelectEntry(entry: Entry) {
		return entry.type === 'file';
	}

	function isDriveRootEntry(entry: Entry) {
		if (entry.type !== 'directory') return false;
		return /^\d+$/.test(entry.path);
	}

	function isSelected(path: string) {
		return selectedPathSet.has(path);
	}

	function selectEntry(entry: Entry) {
		if (!canSelectEntry(entry)) return;
		selectedPaths = [entry.path];
		selectionAnchorPath = entry.path;
	}

	function selectRangeTo(entry: Entry) {
		if (!canSelectEntry(entry)) return;

		const selectableEntries = displayEntries.filter(canSelectEntry);
		const targetIndex = selectableEntries.findIndex((item) => item.path === entry.path);
		const anchorIndex = selectionAnchorPath
			? selectableEntries.findIndex((item) => item.path === selectionAnchorPath)
			: -1;

		if (targetIndex === -1 || anchorIndex === -1) {
			selectEntry(entry);
			return;
		}

		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);
		selectedPaths = selectableEntries.slice(start, end + 1).map((item) => item.path);
		selectionAnchorPath = entry.path;
	}

	function toggleSelection(entry: Entry) {
		if (!canSelectEntry(entry)) return;
		const nextSelectedPaths = isSelected(entry.path)
			? selectedPaths.filter((path) => path !== entry.path)
			: [...selectedPaths, entry.path];
		selectedPaths = nextSelectedPaths;
		selectionAnchorPath = nextSelectedPaths.includes(entry.path)
			? entry.path
			: nextSelectedPaths[nextSelectedPaths.length - 1] ?? null;
	}

	function handleEntryClick(event: MouseEvent, entry: Entry) {
		if (!canSelectEntry(entry)) {
			openEntry(entry);
			return;
		}

		if (event.shiftKey) {
			selectRangeTo(entry);
			return;
		}

		if (isSelected(entry.path)) {
			openEntry(entry);
			return;
		}

		selectEntry(entry);
	}

	function clearSelection() {
		selectedPaths = [];
		selectionAnchorPath = null;
	}

	function selectAllVisible() {
		const visiblePaths = displayEntries.filter(canSelectEntry).map((entry) => entry.path);
		selectedPaths = Array.from(new Set([...selectedPaths, ...visiblePaths]));
		selectionAnchorPath = visiblePaths[visiblePaths.length - 1] ?? selectionAnchorPath;
	}

	function selectVisibleImages() {
		const visibleImagePaths = displayEntries
			.filter((entry) => entry.type === 'file' && entry.mediaType === 'image')
			.map((entry) => entry.path);
		if (visibleImagePaths.length === 0) return;
		selectedPaths = Array.from(new Set([...selectedPaths, ...visibleImagePaths]));
		selectionAnchorPath = visibleImagePaths[visibleImagePaths.length - 1] ?? selectionAnchorPath;
	}

	async function deletePath(relativePath: string) {
		const res = await fetch(`/api/delete/${encodeURI(relativePath)}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(await res.text());
	}

	async function refreshCurrentView() {
		if (isSemanticMode) {
			await runSemanticSearch();
		} else {
			await browse(currentPath);
		}
	}

	async function deleteEntry(entry: Entry) {
		if (!canDeleteEntry(entry) || deletingPath || deletingSelected) return;

		const confirmed = window.confirm(
			entry.type === 'directory'
				? `Delete folder "${entry.name}" and everything inside it? This cannot be undone.`
				: `Delete "${entry.name}"? This cannot be undone.`
		);
		if (!confirmed) return;

		deletingPath = entry.path;
		try {
			await deletePath(entry.path);
			selectedPaths = selectedPaths.filter((path) => path !== entry.path);
			if (selectionAnchorPath === entry.path) {
				selectionAnchorPath = selectedPaths[selectedPaths.length - 1] ?? null;
			}
			await refreshCurrentView();
		} catch (e) {
			if (isSemanticMode) {
				semanticError = e instanceof Error ? e.message : 'Delete failed';
			} else {
				error = e instanceof Error ? e.message : 'Delete failed';
			}
		} finally {
			deletingPath = null;
		}
	}

	async function deleteSelectedEntries() {
		if (deletingPath || deletingSelected || selectedEntries.length === 0) return;

		const confirmed = window.confirm(
			`Delete ${selectedEntries.length} selected item${selectedEntries.length === 1 ? '' : 's'}? This cannot be undone.`
		);
		if (!confirmed) return;

		deletingSelected = true;
		try {
			const results = await Promise.allSettled(selectedEntries.map((entry) => deletePath(entry.path)));
			const failures = results.filter((result) => result.status === 'rejected');
			clearSelection();
			await refreshCurrentView();

			if (failures.length > 0) {
				const message = `${failures.length} selected item${failures.length === 1 ? '' : 's'} failed to delete`;
				if (isSemanticMode) {
					semanticError = message;
				} else {
					error = message;
				}
			}
		} catch (e) {
			if (isSemanticMode) {
				semanticError = e instanceof Error ? e.message : 'Delete selected failed';
			} else {
				error = e instanceof Error ? e.message : 'Delete selected failed';
			}
		} finally {
			deletingSelected = false;
		}
	}

	async function createFolder() {
		if (!canCreateFolder || creatingFolder) return;
		const name = window.prompt('New folder name:');
		if (!name || !name.trim()) return;
		const folderName = name.trim();
		if (/[\/\\]/.test(folderName)) {
			window.alert('Folder name cannot contain slashes.');
			return;
		}
		creatingFolder = true;
		const newPath = [currentPath, folderName].filter(Boolean).join('/');
		try {
			const res = await fetch(`/api/mkdir/${encodeURI(newPath)}`, { method: 'POST' });
			if (!res.ok) throw new Error(await res.text());
			await browse(currentPath);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create folder';
		} finally {
			creatingFolder = false;
		}
	}

	async function reindexSemantic() {
		reindexing = true;
		reindexMessage = null;
		try {
			const res = await fetch('/api/search/reindex', {
				method: 'POST',
			});
			if (!res.ok) throw new Error(await res.text());
			const body = (await res.json()) as {
				summary?: { indexed?: number; deleted?: number; skipped?: number };
			};
			const indexed = body.summary?.indexed ?? 0;
			const deleted = body.summary?.deleted ?? 0;
			const skipped = body.summary?.skipped ?? 0;
			reindexMessage = `Reindex complete: ${indexed} indexed, ${deleted} deleted, ${skipped} skipped.`;
			if (isSemanticMode) {
				void runSemanticSearch();
			}
		} catch (e) {
			reindexMessage = e instanceof Error ? e.message : 'Reindex failed';
		} finally {
			reindexing = false;
		}
	}

	function openEntry(entry: Entry) {
		if (entry.type === 'directory') {
			browse(entry.path);
		} else {
			goto(resolve(`/media/${entry.path}`));
		}
	}

	function formatSize(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

	function getBadgeVariant(entry: Entry): BadgeVariant {
		if (entry.type === 'directory') return 'secondary';
		switch (entry.mediaType) {
			case 'video':
				return 'default';
			case 'audio':
				return 'outline';
			case 'image':
				return 'secondary';
			case 'document':
				return 'destructive';
			default:
				return 'outline';
		}
	}

	function getBadgeLabel(entry: Entry): string {
		if (entry.type === 'directory') return 'folder';
		return entry.mediaType ?? 'file';
	}

	onMount(() => {
		const initialPath = $page.url.searchParams.get('browse') ?? '';
		browse(initialPath);
		void loadDrives();

		return () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
			if (searchAbortController) searchAbortController.abort();
		};
	});
</script>

<div class="min-h-screen bg-background text-foreground">
	<!-- Topbar -->
	<header class="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
		<div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
			<HardDrive class="h-5 w-5 text-primary" />
			<span class="font-semibold tracking-tight">Vectraspace</span>

			<Separator orientation="vertical" class="mx-1 h-5" />

			<!-- Breadcrumbs -->
			<Breadcrumb.Root class="min-w-0 flex-1">
				<Breadcrumb.List>
					<Breadcrumb.Item>
						<Breadcrumb.Link
							class="flex items-center gap-1"
							onclick={() => browse('')}
							href={undefined}
						>
							<Home class="h-3.5 w-3.5" />
							Home
						</Breadcrumb.Link>
					</Breadcrumb.Item>

					{#each breadcrumbs as crumb, i (crumb.path)}
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							{#if i === breadcrumbs.length - 1}
								<Breadcrumb.Page>{crumb.name}</Breadcrumb.Page>
							{:else}
								<Breadcrumb.Link onclick={() => browse(crumb.path)} href={undefined}>
									{crumb.name}
								</Breadcrumb.Link>
							{/if}
						</Breadcrumb.Item>
					{/each}
				</Breadcrumb.List>
			</Breadcrumb.Root>

			<!-- Actions -->
			<div class="flex items-center gap-2">
				{#if canCreateFolder}
					<Button size="sm" variant="outline" onclick={createFolder} disabled={creatingFolder}>
						<FolderPlus class="mr-2 h-3.5 w-3.5" />
						New Folder
					</Button>
				{/if}
				<Button size="sm" onclick={() => goto(resolve(`/upload?dest=${currentPath}`))}>
					<Upload class="mr-2 h-3.5 w-3.5" />
					Upload
				</Button>
				<Separator orientation="vertical" class="h-5" />
				<div class="flex rounded-md border border-border">
					<Button
						variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
						size="icon"
						class="h-8 w-8 rounded-r-none"
						onclick={() => (viewMode = 'grid')}
					>
						<Grid class="h-4 w-4" />
					</Button>
					<Button
						variant={viewMode === 'list' ? 'secondary' : 'ghost'}
						size="icon"
						class="h-8 w-8 rounded-l-none"
						onclick={() => (viewMode = 'list')}
					>
						<List class="h-4 w-4" />
					</Button>
					<Separator orientation="vertical" class="h-5" />
					<Button
						variant="ghost"
						size="icon"
						class="h-8 w-8"
						onclick={() => goto(resolve('/settings'))}
					>
						<Server class="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-7xl px-4 py-6">
		<div class="mb-4 rounded-lg border border-border bg-card p-3">
			<div class="flex flex-col gap-3 md:flex-row md:items-center">
				<div class="relative flex-1">
					<Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						value={semanticQuery}
						oninput={(e) => {
							semanticQuery = (e.currentTarget as HTMLInputElement).value;
							handleSemanticInput();
						}}
						placeholder="Semantic search (for example: cinematic sunset over ocean)"
						class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-9 text-sm outline-none ring-0 focus:border-primary"
					/>
					{#if isSemanticMode}
						<Button
							variant="ghost"
							size="icon"
							class="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
							onclick={() => {
								semanticQuery = '';
								semanticMediaType = '';
								semanticRoot = '';
								clearSemanticSearch();
							}}
						>
							<X class="h-4 w-4" />
						</Button>
					{/if}
				</div>

				<div class="flex gap-2">
					<select
						bind:value={semanticMediaType}
						onchange={handleSemanticFilterChange}
						class="h-9 rounded-md border border-border bg-background px-2 text-sm"
					>
						<option value="">All types</option>
						<option value="image">Images</option>
						<option value="video">Videos</option>
						<option value="audio">Audio</option>
						<option value="document">Documents</option>
						<option value="other">Other</option>
					</select>

					<select
						bind:value={semanticRoot}
						onchange={handleSemanticFilterChange}
						class="h-9 rounded-md border border-border bg-background px-2 text-sm"
					>
						<option value="">All drives</option>
						{#each drives as drive (drive.index)}
							<option value={String(drive.index)}>{drive.name}</option>
						{/each}
					</select>

					{#if hasVisibleImages}
						<Button variant="outline" size="sm" onclick={selectVisibleImages}>
							Select images
						</Button>
					{/if}
				</div>
			</div>

			{#if selectedCount > 0}
				<div class="mt-3 flex flex-col gap-2 rounded-md border border-border bg-background/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
					<span class="text-xs text-muted-foreground">
						{selectedCount} selected
					</span>
					<div class="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onclick={selectAllVisible}>
							Select all visible
						</Button>
						<Button variant="outline" size="sm" onclick={clearSelection}>
							Clear selection
						</Button>
						<Button variant="destructive" size="sm" onclick={deleteSelectedEntries} disabled={deletingSelected}>
							Delete selected
						</Button>
					</div>
				</div>
			{/if}

			<div class="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
				{#if isSemanticMode}
					<span>{displayEntries.length} semantic result{displayEntries.length === 1 ? '' : 's'}</span>
				{/if}
				{#if semanticLoading}
					<span>Searching...</span>
				{/if}
				{#if reindexMessage}
					<span>{reindexMessage}</span>
				{/if}
			</div>
		</div>

		<!-- Error state -->
		{#if error}
			<div
				class="mb-6 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
			>
				<AlertCircle class="h-4 w-4 shrink-0" />
				{error}
			</div>
		{/if}

		{#if semanticError}
			<div
				class="mb-6 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
			>
				<AlertCircle class="h-4 w-4 shrink-0" />
				{semanticError}
			</div>
		{/if}

		<!-- Loading state -->
		{#if loading}
			{#if viewMode === 'grid'}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
					{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
						<Skeleton class="h-28 rounded-xl" />
					{/each}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each Array.from({ length: 8 }, (_, i) => i) as i (i)}
						<Skeleton class="h-12 rounded-lg" />
					{/each}
				</div>
			{/if}

			<!-- Empty state -->
		{:else if displayEntries.length === 0}
			<div class="flex flex-col items-center gap-3 py-24 text-muted-foreground">
				<HardDrive class="h-12 w-12 opacity-30" />
				<p class="text-sm">{isSemanticMode ? 'No semantic matches found' : 'No media found here'}</p>
				{#if isSemanticMode}
					<p class="text-xs">Try broader wording or adjust filters.</p>
				{:else}
					<Button variant="outline" size="sm" onclick={() => browse('')}>Go home</Button>
				{/if}
			</div>

			<!-- Grid view -->
		{:else if viewMode === 'grid'}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each displayEntries as entry (entry.path)}
					<div class="relative">
						{#if isSelected(entry.path)}
							<input
								type="checkbox"
								checked={true}
								onclick={(e) => { e.stopPropagation(); toggleSelection(entry); }}
								aria-label={`Deselect ${entry.name}`}
								class="absolute left-2 top-2 z-20 h-4 w-4 cursor-pointer rounded border-border text-primary shadow"
							/>
						{/if}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										onclick={(event) => handleEntryClick(event, entry)}
										class="group block w-full overflow-hidden rounded-xl border bg-card text-left transition-all duration-150 hover:border-primary/50 {isSelected(entry.path) ? 'border-primary ring-1 ring-primary/40' : 'border-border'}"
									>
										<!-- Full-bleed media area -->
										<div class="aspect-square w-full overflow-hidden bg-muted">
											{#if entry.type === 'file' && entry.mediaType === 'image'}
												<img
													src="/api/stream/{entry.path}"
													alt={entry.name}
													class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
													loading="lazy"
												/>
											{:else if entry.type === 'file' && entry.mediaType === 'video'}
												<video
													src="/api/stream/{entry.path}#t=0.001"
													class="h-full w-full object-cover"
													preload="metadata"
													muted
													playsinline
												></video>
											{:else}
												<div class="flex h-full w-full items-center justify-center">
													<MediaIcon
														entryType={entry.type}
														mediaType={entry.mediaType}
														class="h-12 w-12
															{entry.type === 'directory' ? 'text-amber-400' : ''}
															{entry.mediaType === 'audio' ? 'text-purple-400' : ''}
															{entry.mediaType === 'document' ? 'text-red-400' : ''}
															{entry.mediaType === 'other' ? 'text-muted-foreground' : ''}"
													/>
												</div>
											{/if}
										</div>
										<!-- Info strip -->
										<div class="flex items-center gap-1.5 px-2 py-1.5">
											<span class="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-foreground">{entry.name}</span>
											<Badge variant={getBadgeVariant(entry)} class="shrink-0 text-[10px]">
												{getBadgeLabel(entry)}
											</Badge>
										</div>
									</button>
								{/snippet}
							</ContextMenu.Trigger>
							<ContextMenu.Content class="w-52">
								<ContextMenu.Item onSelect={() => openEntry(entry)}>Open</ContextMenu.Item>
								{#if canSelectEntry(entry)}
									<ContextMenu.Item onSelect={() => toggleSelection(entry)}>
										{isSelected(entry.path) ? 'Deselect' : 'Select'}
									</ContextMenu.Item>
								{/if}
								{#if selectedCount > 0}
									<ContextMenu.Item variant="destructive" onSelect={deleteSelectedEntries}>
										Delete selected ({selectedCount})
									</ContextMenu.Item>
								{/if}
								{#if canDeleteEntry(entry)}
									<ContextMenu.Separator />
									<ContextMenu.Item variant="destructive" onSelect={() => deleteEntry(entry)}>
										{entry.type === 'directory' ? 'Delete folder' : 'Delete'}
									</ContextMenu.Item>
								{/if}
							</ContextMenu.Content>
						</ContextMenu.Root>
					</div>
				{/each}
			</div>

			<!-- List view -->
		{:else}
			<div class="overflow-hidden rounded-lg border border-border">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-border bg-muted/50">
							<th class="w-10 px-3 py-2.5"></th>
							<th class="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
							<th
								class="hidden px-4 py-2.5 text-left font-medium text-muted-foreground sm:table-cell"
								>Type</th
							>
							<th
								class="hidden px-4 py-2.5 text-right font-medium text-muted-foreground md:table-cell"
								>Size</th
							>
							<th
								class="hidden px-4 py-2.5 text-right font-medium text-muted-foreground lg:table-cell"
								>Modified</th
							>
						</tr>
					</thead>
					<tbody>
						{#each displayEntries as entry, i (entry.path)}
							<ContextMenu.Root>
								<ContextMenu.Trigger>
									{#snippet child({ props })}
										<tr
											{...props}
											onclick={(event) => handleEntryClick(event, entry)}
											class={`cursor-pointer border-border transition-colors hover:bg-muted/50 ${
												isSelected(entry.path) ? 'bg-primary/5' : ''
											}${i !== displayEntries.length - 1 ? ' border-b' : ''}`}
										>
											<td class="w-10 px-3 py-3">
												{#if isSelected(entry.path)}
													<input
														type="checkbox"
														checked={true}
														onclick={(e) => {
															e.stopPropagation();
															toggleSelection(entry);
														}}
														aria-label={`Deselect ${entry.name}`}
														class="h-4 w-4 cursor-pointer rounded border-border text-primary shadow-sm"
													/>
												{/if}
											</td>
											<td class="flex items-center gap-3 px-4 py-3">
												{#if entry.type === 'file' && entry.mediaType === 'image'}
													<div class="h-8 w-8 shrink-0 overflow-hidden rounded border border-border">
														<img
															src="/api/stream/{entry.path}"
															alt={entry.name}
															class="h-full w-full object-cover"
															loading="lazy"
														/>
													</div>
												{:else if entry.type === 'file' && entry.mediaType === 'video'}
													<div class="h-8 w-8 shrink-0 overflow-hidden rounded border border-border">
														<video
															src="/api/stream/{entry.path}#t=0.001"
															class="h-full w-full object-cover"
															preload="metadata"
															muted
															playsinline
														></video>
													</div>
												{:else}
													<MediaIcon
														entryType={entry.type}
														mediaType={entry.mediaType}
														class="h-4 w-4 shrink-0
															{entry.type === 'directory' ? 'text-amber-400' : ''}
															{entry.mediaType === 'video' ? 'text-blue-400' : ''}
															{entry.mediaType === 'audio' ? 'text-purple-400' : ''}
															{entry.mediaType === 'image' ? 'text-green-400' : ''}
															{entry.mediaType === 'document' ? 'text-red-400' : ''}
															{entry.mediaType === 'other' ? 'text-muted-foreground' : ''}"
													/>
												{/if}
												<span class="truncate font-medium text-foreground">{entry.name}</span>
											</td>
											<td class="hidden px-4 py-3 sm:table-cell">
												<Badge variant={getBadgeVariant(entry)} class="text-[10px]">
													{getBadgeLabel(entry)}
												</Badge>
											</td>
											<td class="hidden px-4 py-3 text-right text-muted-foreground md:table-cell">
												{entry.size ? formatSize(entry.size) : '—'}
											</td>
											<td class="hidden px-4 py-3 text-right text-muted-foreground lg:table-cell">
												{entry.modified ? formatDate(entry.modified) : '—'}
											</td>
										</tr>
									{/snippet}
								</ContextMenu.Trigger>
								<ContextMenu.Content class="w-52">
									<ContextMenu.Item onSelect={() => openEntry(entry)}>Open</ContextMenu.Item>
									{#if canSelectEntry(entry)}
										<ContextMenu.Item onSelect={() => toggleSelection(entry)}>
											{isSelected(entry.path) ? 'Deselect' : 'Select'}
										</ContextMenu.Item>
									{/if}
									{#if selectedCount > 0}
										<ContextMenu.Item variant="destructive" onSelect={deleteSelectedEntries}>
											Delete selected ({selectedCount})
										</ContextMenu.Item>
									{/if}
									{#if canDeleteEntry(entry)}
										<ContextMenu.Separator />
										<ContextMenu.Item variant="destructive" onSelect={() => deleteEntry(entry)}>
											{entry.type === 'directory' ? 'Delete folder' : 'Delete'}
										</ContextMenu.Item>
									{/if}
								</ContextMenu.Content>
							</ContextMenu.Root>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</main>
</div>
