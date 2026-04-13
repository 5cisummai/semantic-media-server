<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';

	import { toggleMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		class?: string;
		left?: Snippet;
		center?: Snippet;
		right?: Snippet;
	}

	let { class: className, left, center, right }: Props = $props();
</script>

<header
	class={cn('sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur', className)}
>
	<div class="mx-auto flex items-center gap-3 px-4 py-3">
		{#if left}
			{@render left()}
		{/if}

		{#if center}
			<div class="min-w-0 flex-1">
				{@render center()}
			</div>
		{/if}

		{#if right}
			<div class="flex items-center gap-2">
				{@render right()}
			</div>
		{/if}
		<Button onclick={toggleMode} variant="outline" size="icon">
			<SunIcon
				class="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all! dark:scale-0 dark:-rotate-90"
			/>
			<MoonIcon
				class="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all! dark:scale-100 dark:rotate-0"
			/>
			<span class="sr-only">Toggle theme</span>
		</Button>
	</div>
</header>
