<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props {
		/** Short eyebrow label rendered above the title in monospaced uppercase */
		eyebrow?: string;
		/** Page heading */
		title?: string;
		/** Subtitle / description line */
		description?: string;
		/** When true the content takes full height/width with no padding container */
		fullscreen?: boolean;
		/** Optional actions rendered to the right of the header */
		headerActions?: Snippet;
		children: Snippet;
		/** Applied to the outer wrapper */
		class?: string;
		/**
		 * Applied to the inner content container instead of .page-content.
		 * When provided, max-w-5xl is NOT applied — you control the max-width.
		 * Use 'max-w-none' for full-width, 'max-w-6xl' for wider, etc.
		 */
		containerClass?: string;
	}

	let {
		eyebrow,
		title,
		description,
		fullscreen = false,
		headerActions,
		children,
		class: className,
		containerClass
	}: Props = $props();

	const hasHeader = $derived(eyebrow || title || description || headerActions);

	// Base padding utilities replicated from .page-content (minus max-w-5xl)
	const BASE_PADDING = 'mx-auto w-full px-4 py-8 sm:px-6 lg:px-8';
</script>

{#if fullscreen}
	<div class={cn('flex h-full w-full flex-col', className)}>
		{@render children()}
	</div>
{:else}
	<div class={cn('min-h-full w-full bg-background text-foreground', className)}>
		<div
			class={cn(
				containerClass ? BASE_PADDING : 'page-content',
				'flex flex-col gap-8',
				containerClass
			)}
		>
			{#if hasHeader}
				<header class="animate-page-enter flex min-w-0 items-start justify-between gap-4">
					<div class="flex flex-col gap-1.5">
						{#if eyebrow}
							<p class="section-eyebrow">{eyebrow}</p>
						{/if}
						{#if title}
							<h1 class="page-title">{title}</h1>
						{/if}
						{#if description}
							<p class="page-description">{description}</p>
						{/if}
					</div>
					{#if headerActions}
						<div class="flex shrink-0 items-center gap-2 pt-1">
							{@render headerActions()}
						</div>
					{/if}
				</header>
			{/if}

			<div class="animate-page-enter-delay-1 flex flex-col gap-8">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
