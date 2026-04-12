<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import BotIcon from '@lucide/svelte/icons/bot';
	import FilesIcon from '@lucide/svelte/icons/files';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Card from '$lib/components/ui/card/index.js';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import { dedupeChatsById } from '$lib/utils.js';
	import type { FileEntry } from '$lib/components/file-browser/file-grid.svelte';
	import FilePreviewTile from '$lib/components/file-browser/file-preview-tile.svelte';
	import AgentStatusItem from '$lib/components/agent-status-item.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const username = $derived(data.user?.username ?? '');

	function greeting(): string {
		const h = new Date().getHours();
		if (h < 12) return 'Good morning';
		if (h < 18) return 'Good afternoon';
		return 'Good evening';
	}

	let composerValue = $state('');
	let textareaEl = $state<HTMLElement | null>(null);

	function resizeComposer() {
		const el = textareaEl;
		if (!el) return;
		el.style.height = '0px';
		const next = Math.min(Math.max(el.scrollHeight, 52), 220);
		el.style.height = `${next}px`;
	}

	$effect(() => {
		void composerValue;
		resizeComposer();
	});

	function submitComposer() {
		const q = composerValue.trim();
		if (!q) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/chat?q=${encodeURIComponent(q)}`);
	}

	const suggestions = [
		'What files are in my library?',
		'Find all video files',
		'Organize my music by artist',
		'Show me recently added files'
	];

	// ── Recent agent sessions ─────────────────────────────────────────────────
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

	// ── Media library ─────────────────────────────────────────────────────────
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
				node.type === 'directory' || node.type === 'folder' || !!node.children?.length;
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

	const allEntries = $derived(flattenEntries(toFileEntries(fileTree)));

	const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;
	const DOC_RE = /\.(pdf|md|txt|docx?|xlsx?|pptx?|epub|cbz|cbr)$/i;
	const AUDIO_RE = /\.(mp3|wav|m4a|aac|flac|ogg|wma)$/i;
	const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i;

	type MediaSection = { title: string; empty: string; aria: string; files: FileEntry[] };

	const mediaSections = $derived<MediaSection[]>([
		{
			title: 'Documents',
			empty: 'No documents found.',
			aria: 'Documents',
			files: allEntries.filter((e) => e.type === 'file' && DOC_RE.test(e.path ?? e.name))
		},
		{
			title: 'Images',
			empty: 'No images found.',
			aria: 'Images',
			files: allEntries.filter((e) => e.type === 'file' && IMAGE_RE.test(e.path ?? e.name))
		},
		{
			title: 'Videos',
			empty: 'No videos found.',
			aria: 'Videos',
			files: allEntries.filter((e) => e.type === 'file' && VIDEO_RE.test(e.path ?? e.name))
		},
		{
			title: 'Audio',
			empty: 'No audio files found.',
			aria: 'Audio files',
			files: allEntries.filter((e) => e.type === 'file' && AUDIO_RE.test(e.path ?? e.name))
		}
	]);

	const hasAnyMedia = $derived(mediaSections.some((s) => s.files.length > 0));

	function streamUrl(path: string) {
		return `/api/stream/${path}`;
	}

	function openInBrowser(path: string) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/browse/media?file=${encodeURIComponent(path)}`);
	}
</script>

<div class="min-h-full min-w-0 bg-background text-foreground">
	<main class="mx-auto flex w-full min-w-0 flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
		<div class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-10">
			<section class="flex w-full min-w-0 flex-col items-center gap-6 text-center">
				<div class="flex flex-col gap-1">
					<p class="text-sm text-muted-foreground">
						{greeting()}{username ? `, ${username}` : ''}
					</p>
					<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">What can I help with?</h1>
				</div>

				<!-- Composer -->
				<form
					onsubmit={(e) => {
						e.preventDefault();
						submitComposer();
					}}
					class="w-full"
				>
					<div
						class="flex items-end gap-2 rounded-2xl border border-border bg-muted/20 px-3 py-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40"
					>
						<Textarea
							bind:ref={textareaEl}
							bind:value={composerValue}
							oninput={resizeComposer}
							onkeydown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									submitComposer();
								}
							}}
							placeholder="Ask anything about your media library…"
							rows={1}
							class="max-h-48 flex-1 resize-none border-0 bg-transparent! shadow-none focus-visible:ring-0"
						/>
						<Button
							type="submit"
							size="icon"
							disabled={!composerValue.trim()}
							class="mb-0.5 size-8 shrink-0 rounded-xl bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
							aria-label="Send"
						>
							<ArrowUpIcon class="size-4" />
						</Button>
					</div>
				</form>

				<!-- Suggestion chips -->
				<div class="flex flex-wrap justify-center gap-2">
					{#each suggestions as s (s)}
						<button
							type="button"
							onclick={() => {
								composerValue = s;
								submitComposer();
							}}
							class="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
						>
							{s}
						</button>
					{/each}
				</div>
			</section>

			<!-- ── Recent agent sessions ────────────────────────────────────────── -->
			<section class="flex w-full min-w-0 flex-col gap-4">
				<div class="flex min-w-0 items-center justify-between gap-2">
					<h2 class="text-sm font-semibold">Recent sessions</h2>
					<Button variant="ghost" size="sm" class="gap-1.5 text-xs" onclick={openNewAgent}>
						<BotIcon class="size-3.5" />
						New agent
					</Button>
				</div>

				{#if agents.length === 0}
					<Card.Root class="border-dashed">
						<Card.Content class="flex flex-col items-center gap-3 py-10 text-center">
							<div class="flex size-10 items-center justify-center rounded-full bg-muted">
								<BotIcon class="size-5 text-muted-foreground" />
							</div>
							<div class="flex flex-col gap-1">
								<p class="text-sm font-medium">No agent sessions yet</p>
								<p class="text-xs text-muted-foreground">
									Ask a question above to start your first session.
								</p>
							</div>
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="flex flex-col divide-y divide-border rounded-xl border">
						{#each agents.slice(0, 6) as agent (agent.id)}
							<AgentStatusItem
								chatId={agent.id}
								name={agent.title || 'Agent session'}
								description="{agent.messageCount} message{agent.messageCount === 1
									? ''
									: 's'} · {relativeTimestamp(agent.updatedAt)}"
								sessionStatus={agent.status}
								href="/chat?agent={encodeURIComponent(agent.id)}"
								size="sm"
							/>
						{/each}
					</div>
					{#if agents.length > 6}
						<Button variant="ghost" size="sm" class="self-start text-xs" onclick={openNewAgent}>
							View all {agents.length} sessions →
						</Button>
					{/if}
				{/if}
			</section>
		</div>

		<!-- ── Media library ────────────────────────────────────────────────── -->
		<section class="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
			<div class="flex min-w-0 items-center justify-between gap-2">
				<h2 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Library</h2>
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

			{#if !hasAnyMedia}
				<p class="text-sm text-muted-foreground">No media files indexed yet.</p>
			{:else}
				{#each mediaSections.filter((s) => s.files.length > 0) as s (s.title)}
					<div class="flex min-w-0 flex-col gap-3">
						<h3 class="text-sm font-medium">{s.title}</h3>
						<div
							class="-mx-1 flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-visible mask-[linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:mask-none [&::-webkit-scrollbar]:hidden"
							role="region"
							aria-label={s.aria}
						>
							{#each s.files as entry (entry.path)}
								<button
									type="button"
									class="w-36 shrink-0 snap-start rounded-lg text-left ring-offset-background transition outline-none hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring"
									onclick={() => openInBrowser(entry.path)}
								>
									<FilePreviewTile
										class="pointer-events-none"
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
				{/each}
			{/if}
		</section>
	</main>
</div>
