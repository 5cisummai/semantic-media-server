<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '$lib/components/ui/button';
	import type { ChatMessage } from './types';
	import { renderMarkdown } from './markdown';

	let {
		message,
		busy = false,
		onEdit,
		onRegenerate,
		onCopy,
		onRetry,
		onVariantPrev,
		onVariantNext
	}: {
		message: ChatMessage;
		busy?: boolean;
		onEdit?: () => void;
		onRegenerate?: () => void;
		onCopy?: () => void;
		onRetry?: () => void;
		onVariantPrev?: () => void;
		onVariantNext?: () => void;
	} = $props();

	const displayHtml = $derived.by(() => {
		const raw =
			message.role === 'assistant' && message.assistantVariants?.length
				? (() => {
						const v = message.assistantVariants!;
						const idx =
							message.variantIndex !== undefined ? message.variantIndex : v.length - 1;
						return v[Math.max(0, Math.min(idx, v.length - 1))] ?? message.content;
					})()
				: message.content;
		return renderMarkdown(raw);
	});

	const variantCount = $derived(
		message.role === 'assistant' ? (message.assistantVariants?.length ?? 0) : 0
	);
	const variantPos = $derived(
		message.role === 'assistant' && message.assistantVariants?.length
			? (message.variantIndex !== undefined
					? message.variantIndex + 1
					: message.assistantVariants!.length) ?? 1
			: 0
	);
	const showVariants = $derived(variantCount > 1);

	function onUserBlockClick(e: MouseEvent) {
		if (message.role !== 'user' || busy) return;
		const sel = typeof window !== 'undefined' ? window.getSelection() : null;
		if (sel?.toString().trim()) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('a, button')) return;
		onEdit?.();
	}
</script>

<div
	class="w-full border-b border-border/70 py-5 last:border-b-0"
	data-message-id={message.id}
>
	<div class="flex w-full flex-col gap-2">
		<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
			<span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{message.role === 'user' ? 'You' : 'Assistant'}
			</span>
			{#if message.role === 'user' && message.editedFrom}
				<span class="text-[10px] font-medium uppercase text-muted-foreground">Edited</span>
			{/if}
			{#if message.role === 'assistant' && message.model}
				<span class="text-[11px] text-muted-foreground">· {message.model}</span>
			{/if}
		</div>

		<div
			class="border-l-2 pl-3 {message.role === 'user'
				? 'border-primary/50'
				: 'border-border'}"
		>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="text-[15px] leading-relaxed {message.role === 'user' && !busy ? 'cursor-pointer' : ''}"
				title={message.role === 'user' && !busy ? 'Click to edit' : undefined}
				onclick={message.role === 'user' ? onUserBlockClick : undefined}
			>
				<div
					class="prose prose-sm dark:prose-invert prose-p:my-2 prose-p:first:mt-0 prose-p:last:mb-0 max-w-none"
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html displayHtml}
				</div>

				{#if message.sources && message.sources.length > 0}
					<div
						class="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border/60 pt-3"
					>
						<span class="shrink-0 text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
							Sources
						</span>
						{#each message.sources as source (source.fileId)}
							<span
								class="max-w-full truncate rounded border border-border/80 bg-muted/40 px-1.5 py-0.5 text-[10px] leading-tight text-foreground/90"
								title={source.filePath}
							>
								{source.filePath}
							</span>
						{/each}
					</div>
				{/if}

				{#if message.status === 'failed' && message.errorMessage}
					<p class="mt-2 text-xs text-red-600 dark:text-red-400">{message.errorMessage}</p>
				{/if}

				{#if showVariants}
					<div class="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
						<span class="text-[10px] text-muted-foreground">Versions</span>
						<div class="flex items-center gap-1">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="size-7"
								disabled={busy || (message.variantIndex ?? variantCount - 1) <= 0}
								onclick={() => onVariantPrev?.()}
								aria-label="Older version"
							>
								<ChevronLeftIcon class="size-4" />
							</Button>
							<span class="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground">
								{variantPos}/{variantCount}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="size-7"
								disabled={busy ||
									(message.variantIndex ?? variantCount - 1) >= variantCount - 1}
								onclick={() => onVariantNext?.()}
								aria-label="Newer version"
							>
								<ChevronRightIcon class="size-4" />
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</div>

		{#if message.role === 'user'}
			<div class="mt-2 flex items-center gap-0.5 pl-[calc(0.5rem+2px)]">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-7 text-muted-foreground hover:text-foreground"
					onclick={() => onCopy?.()}
					aria-label="Copy message"
				>
					<CopyIcon class="size-3.5" />
				</Button>
			</div>
		{:else}
			<div class="mt-2 flex flex-wrap items-center gap-0.5 pl-[calc(0.5rem+2px)]">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-7 text-muted-foreground hover:text-foreground"
					disabled={busy}
					onclick={() => onRegenerate?.()}
					aria-label="Regenerate response"
				>
					<RefreshCwIcon class="size-3.5" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-7 text-muted-foreground hover:text-foreground"
					onclick={() => onCopy?.()}
					aria-label="Copy response"
				>
					<CopyIcon class="size-3.5" />
				</Button>
				{#if message.status === 'failed'}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						disabled={busy}
						onclick={() => onRetry?.()}
						aria-label="Retry after error"
					>
						<RotateCcwIcon class="size-3.5" />
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>
