<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import BotIcon from '@lucide/svelte/icons/bot';
	import FilesIcon from '@lucide/svelte/icons/files';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ScanTextIcon from '@lucide/svelte/icons/scan-text';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
	import { pinnedFolders } from '$lib/hooks/pinned-folders.svelte';
	import { dedupeChatsById } from '$lib/utils.js';
	import type { FileEntry } from '$lib/components/file-browser/file-grid.svelte';
	import FilePreviewTile from '$lib/components/file-browser/file-preview-tile.svelte';
	import ChatComposer from '$lib/components/chat-llm/chat-composer.svelte';
	import PageShell from '$lib/components/page-shell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const username = $derived(data.user?.username ?? '');

	function greeting(): string {
		const h = new Date().getHours();
		if (h < 12) return 'Good morning';
		if (h < 18) return 'Good afternoon';
		return 'Good evening';
	}

	// ── Composer ─────────────────────────────────────────────────────────────
	let composerValue = $state('');
	let composerSubmitting = $state(false);
	let composerError = $state<string | null>(null);

	async function submitComposer() {
		const q = composerValue.trim();
		if (!q || composerSubmitting) return;
		if (!workspaceStore.activeId) return;
		composerSubmitting = true;
		composerError = null;
		// Let /chat own the full brain/ask SSE stream. Starting the request here and
		// navigating after run_started cancelled the stream, so the chat page never
		// received text_delta events.
		const target = new URL(resolve('/chat'), window.location.origin);
		target.searchParams.set('q', q);
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(target.pathname + target.search);
		} catch (err) {
			composerError = err instanceof Error ? err.message : 'Failed to open chat';
			composerSubmitting = false;
		}
	}

	type QuickAction = { label: string; icon: typeof SparklesIcon };

	const quickActions: QuickAction[] = [
		{ label: 'Summarize recent docs', icon: SparklesIcon },
		{ label: 'Find unorganized photos', icon: SearchIcon },
		{ label: 'Scan for invoices', icon: ScanTextIcon },
		{ label: 'Show recent activity', icon: ZapIcon }
	];

	// ── Agent sessions ───────────────────────────────────────────────────────
	type AgentSummary = PageData['agents'][number];

	let agents = $state<AgentSummary[]>([]);

	$effect(() => {
		const chats = dedupeChatsById(data.agents);
		agents = chats;
		untrack(() => {
			agentSessions.seedFromChats(chats);
		});
	});

	function relativeTimestamp(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const diff = Date.now() - date.getTime();
		const minute = 60_000;
		const hour = 60 * minute;
		const day = 24 * hour;
		if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
		if (diff < day) return `${Math.floor(diff / hour)}h ago`;
		return `${Math.floor(diff / day)}d ago`;
	}

	function openNewAgent() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/chat`);
	}

	// ── File tree ─────────────────────────────────────────────────────────────
	type BrowseNode = {
		name?: string;
		title?: string;
		path?: string;
		type?: 'file' | 'directory' | 'folder';
		children?: BrowseNode[];
	};

	const fileTree = $derived((data.fileTree ?? []) as BrowseNode[]);

	function toFileEntries(nodes: BrowseNode[]): FileEntry[] {
		return nodes.map((node, index) => {
			const name = node.name ?? node.title ?? `Item ${index + 1}`;
			const path = node.path ?? name;
			const isDirectory =
				node.type === 'file'
					? false
					: node.type === 'directory' || node.type === 'folder' || node.children != null;
			return {
				id: path,
				name,
				path,
				type: isDirectory ? 'directory' : 'file',
				children: node.children ? toFileEntries(node.children) : []
			};
		});
	}

	function flattenEntries(entries: FileEntry[]): FileEntry[] {
		return entries.flatMap((e) => [e, ...(e.children ? flattenEntries(e.children) : [])]);
	}

	const topLevelEntries = $derived(toFileEntries(fileTree));
	const allEntries = $derived(flattenEntries(topLevelEntries));
	const topLevelDirs = $derived(topLevelEntries.filter((e) => e.type === 'directory'));

	const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;
	const DOC_RE = /\.(pdf|md|txt|docx?|xlsx?|pptx?|epub|cbz|cbr)$/i;
	const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i;

	const visualFiles = $derived(
		allEntries
			.filter(
				(e) =>
					e.type === 'file' && (IMAGE_RE.test(e.path ?? e.name) || VIDEO_RE.test(e.path ?? e.name))
			)
			.slice(0, 16)
	);

	const docFiles = $derived(
		allEntries.filter((e) => e.type === 'file' && DOC_RE.test(e.path ?? e.name)).slice(0, 8)
	);

	const hasAnyContent = $derived(visualFiles.length > 0 || docFiles.length > 0);

	function streamUrl(path: string) {
		return `/api/stream/${path}`;
	}

	function openInBrowser(path: string) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/browse/media?file=${encodeURIComponent(path)}`);
	}

	// ── Pinned folders ────────────────────────────────────────────────────────
	let showFolderPicker = $state(false);

	function pinFolder(entry: FileEntry) {
		pinnedFolders.pin(entry.path, entry.name);
		showFolderPicker = false;
	}

	function openPinned(path: string) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/browse?path=${encodeURIComponent(path)}`);
	}

	// ── Storage ───────────────────────────────────────────────────────────────
	type DriveInfo = PageData['drives'][number];

	const drives = $derived((data.drives ?? []) as DriveInfo[]);

	function formatBytes(bytes: number): string {
		if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
		return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	}
</script>

<PageShell
	eyebrow="Command Center"
	title={greeting() + (username ? `, ${username}` : '')}
	description="Your agentic workspace hub."
	containerClass="max-w-none"
>
	<!-- ① Command Composer ─────────────────────────────────────────────────── -->
	<section class="flex w-full flex-col items-center gap-4">
		<div class="w-full max-w-2xl">
			<ChatComposer
				bind:value={composerValue}
				disabled={composerSubmitting}
				placeholder="Ask anything about your media library…"
				onSubmit={() => void submitComposer()}
			/>
			{#if composerError}
				<p class="mt-2 text-xs text-destructive">{composerError}</p>
			{/if}
		</div>

		<!-- Quick Action chips -->
		<div class="flex flex-wrap justify-center gap-2">
			{#each quickActions as action (action.label)}
				{@const Icon = action.icon}
				<button
					type="button"
					disabled={composerSubmitting}
					onclick={() => {
						composerValue = action.label;
						void submitComposer();
					}}
					class="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
				>
					<Icon class="size-3 text-primary/60" />
					{action.label}
				</button>
			{/each}
		</div>
	</section>

	<!-- ② Active Intelligence Row ────────────────────────────────────────── -->
	<section class="flex w-full min-w-0 flex-col gap-3">
		<div class="flex min-w-0 items-center justify-between gap-2">
			<h2 class="section-label">What's Happening</h2>
			<Button variant="ghost" size="sm" class="gap-1.5 text-xs" onclick={openNewAgent}>
				<PlusIcon class="size-3.5" />
				New agent
			</Button>
		</div>

		{#if agents.length === 0}
			<div class="card-glass flex items-center gap-4 rounded-xl border-dashed px-4 py-4">
				<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
					<BotIcon class="size-4 text-primary/70" />
				</div>
				<div>
					<p class="text-sm font-medium">No active agents</p>
					<p class="text-xs text-muted-foreground">
						Use the search bar above to launch your first agent session.
					</p>
				</div>
			</div>
		{:else}
			<div
				class="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				{#each agents.slice(0, 8) as agent (agent.id)}
					{@const isActive =
						agentSessions.getStatus(agent.id) === 'working' || agent.status === 'working'}
					{@const isDone = !isActive && agent.status === 'done'}
					<a
						href={resolve('/chat')}
						class="card-glass card-glass-hover flex w-52 shrink-0 snap-start flex-col gap-2.5 rounded-xl p-3.5 transition-all"
						onclick={(event) => {
							event.preventDefault();
							// eslint-disable-next-line svelte/no-navigation-without-resolve
							void goto(`${resolve('/chat')}?agent=${encodeURIComponent(agent.id)}`);
						}}
					>
						<div class="flex items-start justify-between gap-2">
							<p class="line-clamp-2 text-xs leading-tight font-medium text-foreground">
								{agent.title || 'Agent session'}
							</p>
							{#if isActive}
								<LoaderCircleIcon class="size-3.5 shrink-0 animate-spin text-amber-500" />
							{:else if isDone}
								<CheckCircle2Icon class="size-3.5 shrink-0 text-green-500" />
							{:else}
								<CircleDotIcon class="size-3.5 shrink-0 text-muted-foreground/40" />
							{/if}
						</div>
						<div class="flex items-center gap-1.5">
							{#if isActive}
								<Badge
									class="gap-1 border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
								>
									<span class="size-1.5 animate-pulse rounded-full bg-amber-500"></span>
									Running
								</Badge>
							{:else if isDone}
								<Badge
									class="border-green-200 bg-green-50 text-green-600 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400"
								>
									Completed
								</Badge>
							{:else}
								<Badge variant="outline" class="text-muted-foreground">Idle</Badge>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">
							{agent.messageCount} msg{agent.messageCount === 1 ? '' : 's'} · {relativeTimestamp(
								agent.updatedAt
							)}
						</p>
					</a>
				{/each}

				<!-- New Session Card -->
				<button
					type="button"
					onclick={openNewAgent}
					class="flex w-44 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
				>
					<PlusIcon class="size-5" />
					<span class="text-xs font-medium">New Session</span>
				</button>
			</div>

			{#if agents.length > 8}
				<Button variant="ghost" size="sm" class="self-start text-xs" onclick={openNewAgent}>
					View all {agents.length} sessions →
				</Button>
			{/if}
		{/if}
	</section>

	<!-- ③ Main Body: Continue Working + Pinned ───────────────────────────── -->
	<div class="grid w-full gap-6 lg:grid-cols-3">
		<!-- Continue Working (recent files) ── 2/3 width -->
		<section class="flex min-w-0 flex-col gap-4 lg:col-span-2">
			<div class="flex min-w-0 items-center justify-between gap-2">
				<h2 class="section-label">Continue Working</h2>
				<Button
					variant="ghost"
					size="sm"
					class="gap-1.5 text-xs"
					onclick={() => goto(resolve('/browse'))}
				>
					<FilesIcon class="size-3.5" />
					Browse all
				</Button>
			</div>

			{#if !hasAnyContent}
				<Card.Root class="card-glass border-dashed">
					<Card.Content class="flex flex-col items-center gap-3 py-8 text-center">
						<div class="flex size-9 items-center justify-center rounded-full bg-muted">
							<FilesIcon class="size-4 text-muted-foreground" />
						</div>
						<div class="flex flex-col gap-1">
							<p class="text-sm font-medium">No files indexed yet</p>
							<p class="text-xs text-muted-foreground">
								Files will appear here once indexed by an agent.
							</p>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				<div class="flex flex-col gap-5">
					<!-- Visual files: images + videos — grid of square tiles -->
					{#if visualFiles.length > 0}
						<div class="flex flex-col gap-2">
							<h3 class="section-label">Media</h3>
							<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5">
								{#each visualFiles as entry (entry.path)}
									<button
										type="button"
										class="aspect-square overflow-hidden rounded-lg ring-offset-background transition outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
										onclick={() => openInBrowser(entry.path)}
									>
										<FilePreviewTile
											class="pointer-events-none size-full"
											item={{
												name: entry.name,
												path: entry.path,
												url: streamUrl(entry.path),
												type: 'file'
											}}
										/>
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Document files — compact list rows -->
					{#if docFiles.length > 0}
						<div class="flex flex-col gap-2">
							<h3 class="section-label">Documents</h3>
							<div class="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
								{#each docFiles as entry (entry.path)}
									<button
										type="button"
										class="group flex items-center gap-3 px-3 py-2.5 text-left transition hover:bg-muted/50"
										onclick={() => openInBrowser(entry.path)}
									>
										<div
											class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10"
										>
											<FilesIcon class="size-3.5 text-primary" />
										</div>
										<div class="min-w-0 flex-1">
											<p class="truncate text-xs font-medium text-foreground">
												{entry.name}
											</p>
											<p class="truncate text-xs text-muted-foreground">
												{entry.path}
											</p>
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Pinned Folders ── 1/3 width -->
		<section class="flex min-w-0 flex-col gap-3">
			<div class="flex min-w-0 items-center justify-between gap-2">
				<h2 class="section-label">Pinned</h2>
				{#if topLevelDirs.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="gap-1.5 text-xs"
						onclick={() => (showFolderPicker = !showFolderPicker)}
					>
						<PinIcon class="size-3.5" />
						Pin folder
					</Button>
				{/if}
			</div>

			<!-- Folder picker -->
			{#if showFolderPicker}
				<Card.Root class="card-glass border-primary/20">
					<Card.Content class="p-1.5">
						<p class="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">Select a folder to pin:</p>
						<div class="flex flex-col">
							{#each topLevelDirs.filter((d) => !pinnedFolders.isPinned(d.path)) as dir (dir.path)}
								<button
									type="button"
									class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/70"
									onclick={() => pinFolder(dir)}
								>
									<FolderIcon class="size-3.5 shrink-0 text-amber-500" />
									<span class="truncate font-medium">{dir.name}</span>
								</button>
							{/each}
							{#if topLevelDirs.every((d) => pinnedFolders.isPinned(d.path))}
								<p class="px-2 py-1.5 text-xs text-muted-foreground italic">
									All folders are already pinned.
								</p>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}

			{#if pinnedFolders.items.length === 0}
				<div
					class="card-glass flex flex-col items-center gap-2 rounded-xl border-dashed p-5 text-center"
				>
					<PinIcon class="size-5 text-primary/40" />
					<p class="text-xs text-muted-foreground">
						Pin folders for quick access.<br />Click "Pin folder" above to start.
					</p>
				</div>
			{:else}
				<div class="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
					{#each pinnedFolders.items as folder (folder.path)}
						<div class="group flex items-center gap-2.5 px-3 py-2.5">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
								onclick={() => openPinned(folder.path)}
							>
								<div
									class="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10"
								>
									<FolderOpenIcon class="size-3.5 text-amber-600 dark:text-amber-400" />
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-medium text-foreground">
										{folder.name}
									</p>
									<p class="truncate text-xs text-muted-foreground">
										{folder.path}
									</p>
								</div>
							</button>
							<button
								type="button"
								title="Unpin"
								class="flex size-6 items-center justify-center rounded text-transparent transition-colors group-hover:text-muted-foreground/60 hover:!text-foreground"
								onclick={() => pinnedFolders.unpin(folder.path)}
							>
								<XIcon class="size-3.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>

	<!-- ④ Storage Health ─────────────────────────────────────────────────── -->
	{#if drives.length > 0}
		<section class="flex w-full min-w-0 flex-col gap-3">
			<div class="flex items-center gap-2">
				<HardDriveIcon class="size-3.5 text-muted-foreground" />
				<h2 class="section-label">Storage</h2>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each drives as drive (drive.index)}
					<Card.Root class="card-glass overflow-hidden">
						<Card.Content class="p-4">
							<div class="mb-3 flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-2">
									<HardDriveIcon class="size-4 shrink-0 text-muted-foreground" />
									<p class="truncate text-sm font-medium">{drive.name}</p>
								</div>
								{#if drive.available}
									<span class="shrink-0 text-xs text-muted-foreground">
										{drive.usedPercent ?? 0}%
									</span>
								{:else}
									<Badge variant="destructive">Unavailable</Badge>
								{/if}
							</div>
							{#if drive.available && drive.usedBytes != null && drive.totalBytes != null}
								<Progress
									value={drive.usedPercent ?? 0}
									max={100}
									class={(drive.usedPercent ?? 0) > 90
										? '[&_[data-slot=progress-indicator]]:bg-destructive'
										: (drive.usedPercent ?? 0) > 75
											? '[&_[data-slot=progress-indicator]]:bg-amber-500'
											: ''}
								/>
								<div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
									<span>{formatBytes(drive.usedBytes)} used</span>
									<span>{formatBytes(drive.freeBytes!)} free</span>
								</div>
							{:else if !drive.available}
								<p class="text-xs text-muted-foreground">Drive is not accessible.</p>
							{/if}
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		</section>
	{/if}
</PageShell>
