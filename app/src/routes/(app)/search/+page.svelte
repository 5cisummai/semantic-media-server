<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { apiFetch } from '$lib/api-fetch';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
	import type { PageData } from './$types';
	import FilePreviewTile from '$lib/components/file-browser/file-preview-tile.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	let { data }: { data: PageData } = $props();

	type SemanticSearchResult = {
		id: string;
		score: number;
		name: string;
		path: string;
		mediaType: string;
		mimeType?: string;
	};

	let inputValue = $state('');

	$effect(() => {
		inputValue = page.url.searchParams.get('q')?.trim() ?? '';
	});

	let results = $state<SemanticSearchResult[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let reindexing = $state(false);
	let reindexMessage = $state<string | null>(null);

	$effect(() => {
		const q = page.url.searchParams.get('q')?.trim() ?? '';
		const workspaceId = workspaceStore.activeId;

		if (!q || !workspaceId) {
			results = [];
			loading = false;
			error = null;
			return;
		}

		let cancelled = false;
		loading = true;
		error = null;

		(async () => {
			try {
				const params = new URLSearchParams({ q, limit: '48' });
				const res = await apiFetch(
					`/api/workspaces/${encodeURIComponent(workspaceId)}/search?${params}`
				);
				if (!res.ok) {
					const text = await res.text();
					let message = text || res.statusText;
					try {
						const j = JSON.parse(text) as { message?: string };
						if (j.message) message = j.message;
					} catch {
						/* use raw */
					}
					throw new Error(message);
				}
				const data = (await res.json()) as { results: SemanticSearchResult[] };
				if (!cancelled) results = data.results ?? [];
			} catch (e) {
				if (!cancelled) {
					results = [];
					error = e instanceof Error ? e.message : 'Search failed';
				}
			} finally {
				if (!cancelled) loading = false;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	function streamUrl(relativePath: string): string {
		const encoded = relativePath
			.split('/')
			.filter((s) => s.length > 0)
			.map((seg) => encodeURIComponent(seg))
			.join('/');
		return `/api/stream/${encoded}`;
	}

	function submitSearch(event?: Event) {
		event?.preventDefault();
		const q = inputValue.trim();
		const url = new URL(page.url.href);
		if (q) {
			url.searchParams.set('q', q);
		} else {
			url.searchParams.delete('q');
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${url.pathname}${url.search}`, { keepFocus: true, replaceState: true });
	}

	function openFile(path: string) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/browse/media?file=${encodeURIComponent(path)}`, { keepFocus: true });
	}

	async function reindexWorkspace() {
		const workspaceId = workspaceStore.activeId;
		if (!workspaceId || reindexing) return;
		reindexing = true;
		reindexMessage = null;
		try {
			const res = await apiFetch(
				`/api/workspaces/${encodeURIComponent(workspaceId)}/search/reindex`,
				{ method: 'POST' }
			);
			const data = (await res.json().catch(() => null)) as {
				summary?: { indexed?: number; totalFiles?: number };
				message?: string;
			} | null;
			if (res.ok && data?.summary) {
				reindexMessage = `Indexed ${data.summary.indexed ?? 0} of ${data.summary.totalFiles ?? 0} files.`;
			} else {
				let fallback = 'Reindex failed';
				if (res.status === 403) fallback = 'Admins only.';
				reindexMessage = data?.message ?? fallback;
			}
		} catch (e) {
			reindexMessage = e instanceof Error ? e.message : 'Reindex failed';
		} finally {
			reindexing = false;
		}
	}

	const workspaceMissing = $derived(!workspaceStore.activeId);
	const queryFromUrl = $derived(page.url.searchParams.get('q')?.trim() ?? '');
	const showEmpty = $derived(
		!loading && !error && queryFromUrl.length > 0 && results.length === 0 && !workspaceMissing
	);
</script>

<div class="min-h-full min-w-0 bg-background text-foreground">
	<div class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
		<header class="flex flex-col gap-2">
			<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Smart Search</h1>
			<p class="max-w-2xl text-sm text-muted-foreground">
				Semantic search finds files by meaning across your workspace index—describe what you are
				looking for, not just the filename.
			</p>
			{#if !workspaceMissing && data.isAdmin}
				<div class="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="gap-2"
						disabled={reindexing}
						onclick={reindexWorkspace}
					>
						{#if reindexing}
							<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
						{:else}
							<RefreshCwIcon class="size-4" aria-hidden="true" />
						{/if}
						Reindex workspace
					</Button>
					{#if reindexMessage}
						<span class="text-xs text-muted-foreground">{reindexMessage}</span>
					{/if}
				</div>
			{/if}
		</header>

		<form
			onsubmit={submitSearch}
			class="flex w-full flex-col gap-3 sm:flex-row sm:items-center"
			role="search"
			aria-label="Semantic library search"
		>
			<div class="relative flex-1">
				<SearchIcon
					class="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					type="search"
					name="q"
					autocomplete="off"
					placeholder="e.g. sunset beach photos, interviews about science…"
					class="h-11 ps-9"
					bind:value={inputValue}
					aria-label="Search query"
				/>
			</div>
			<Button type="submit" class="h-11 shrink-0 sm:min-w-28" disabled={loading}>
				{#if loading}
					<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
					<span class="ms-2">Searching</span>
				{:else}
					Search
				{/if}
			</Button>
		</form>

		{#if workspaceMissing}
			<p class="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
				Select a workspace in the header to search your library.
			</p>
		{:else if error}
			<p class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
				{error}
			</p>
		{/if}

		<section aria-live="polite" aria-busy={loading}>
			{#if loading && results.length === 0}
				<p class="text-sm text-muted-foreground">Searching indexed files…</p>
			{:else if showEmpty}
				<p class="text-sm text-muted-foreground">
					No matches above the similarity threshold. Try rephrasing or check that files are indexed.
				</p>
			{:else if results.length > 0}
				<div class="mb-3 flex items-baseline justify-between gap-2">
					<h2 class="text-sm font-medium text-foreground">Results</h2>
					<span class="text-xs text-muted-foreground">{results.length} files</span>
				</div>
				<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
					{#each results as hit (hit.id)}
						<li>
							<button
								type="button"
								class="group w-full rounded-xl p-1 text-left transition-colors hover:bg-muted/50"
								onclick={() => openFile(hit.path)}
							>
								<FilePreviewTile
									class="w-full"
									item={{
										name: hit.name,
										path: hit.path,
										url: streamUrl(hit.path),
										type: 'file',
										mimeType: hit.mimeType
									}}
								/>
								<p class="mt-1 px-0.5 text-xs text-muted-foreground tabular-nums">
									Match {(hit.score * 100).toFixed(0)}%
								</p>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
