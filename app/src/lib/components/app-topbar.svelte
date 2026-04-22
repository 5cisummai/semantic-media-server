<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { page } from '$app/state';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import CommandIcon from '@lucide/svelte/icons/command';

	import { toggleMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';

	interface Props {
		class?: string;
		left?: Snippet;
		center?: Snippet;
		right?: Snippet;
	}

	let { class: className, left, center, right }: Props = $props();

	const PAGE_LABELS: Record<string, string> = {
		'/home': 'Home',
		'/browse': 'Browser',
		'/chat': 'Agent',
		'/settings': 'Settings',
		'/workspace': 'Workspace'
	};

	const pageName = $derived(() => {
		const pathname = page.url.pathname;
		for (const [prefix, label] of Object.entries(PAGE_LABELS)) {
			if (pathname === prefix || pathname.startsWith(prefix + '/')) return label;
		}
		return null;
	});

	const workspaceName = $derived(workspaceStore.active?.name ?? null);
</script>

<header
	class={cn(
		'sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md',
		className
	)}
>
	<div class="flex items-center gap-2 px-4 py-2.5">
		{#if left}
			{@render left()}
		{/if}

		<!-- Page breadcrumb context -->
		<div class="flex min-w-0 flex-1 items-center gap-2">
			{#if center}
				<div class="min-w-0 flex-1">{@render center()}</div>
			{:else if pageName() || workspaceName}
				<div class="flex min-w-0 items-center gap-1.5 text-sm">
					{#if workspaceName}
						<span class="truncate font-mono text-xs text-muted-foreground/70">{workspaceName}</span>
						{#if pageName()}
							<span class="text-border select-none">/</span>
						{/if}
					{/if}
					{#if pageName()}
						<span class="truncate font-medium text-foreground/90">{pageName()}</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Right side actions -->
		<div class="flex shrink-0 items-center gap-1">
			{#if right}
				{@render right()}
				<Separator.Root orientation="vertical" class="mx-1 h-4 data-[orientation=vertical]:h-4" />
			{/if}

			<!-- Cmd+K hint -->
			<button
				type="button"
				class="hidden items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground/60 transition-colors hover:border-primary/30 hover:text-muted-foreground sm:flex"
				onclick={() => {
					const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true });
					document.dispatchEvent(event);
				}}
				aria-label="Open command palette"
			>
				<CommandIcon class="size-2.5" />
				<span>K</span>
			</button>

			<Button
				onclick={toggleMode}
				variant="ghost"
				size="icon"
				class="size-8 text-muted-foreground hover:text-foreground"
			>
				<SunIcon
					class="h-[1.1rem] w-[1.1rem] scale-100 rotate-0 transition-all! dark:scale-0 dark:-rotate-90"
				/>
				<MoonIcon
					class="absolute h-[1.1rem] w-[1.1rem] scale-0 rotate-90 transition-all! dark:scale-100 dark:rotate-0"
				/>
				<span class="sr-only">Toggle theme</span>
			</Button>
		</div>
	</div>
</header>
