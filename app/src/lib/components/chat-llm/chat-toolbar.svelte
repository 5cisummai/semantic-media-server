<script lang="ts">
	import type { Snippet } from 'svelte';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { Button } from '$lib/components/ui/button';
	import {
		Popover,
		PopoverContent,
		PopoverHeader,
		PopoverTitle,
		PopoverTrigger
	} from '$lib/components/ui/popover';
	import { Separator } from '$lib/components/ui/separator';
	import * as Select from '$lib/components/ui/select/index.js';

	let {
		maxHistoryMessages = $bindable(40),
		onExportJson,
		onExportMarkdown,
		onStopAgent,
		showStop = false,
		disabled = false,
		leading
	}: {
		maxHistoryMessages?: number;
		onExportJson?: () => void;
		onExportMarkdown?: () => void;
		onStopAgent?: () => void;
		showStop?: boolean;
		disabled?: boolean;
		/** Optional controls shown before the toolbar actions (e.g. chat list toggle). */
		leading?: Snippet;
	} = $props();

	const presets = [10, 20, 40, 80];
	let optionsOpen = $state(false);
</script>

<div
	class="flex flex-wrap items-center gap-2 border-border/50 px-3 py-2 text-xs text-muted-foreground"
>
	<div class="me-auto flex min-w-0 flex-wrap items-center gap-2">
		{@render leading?.()}
	</div>
	<div class="flex flex-wrap items-center justify-end gap-2">
		{#if showStop}
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
				aria-label="Stop agent"
				onclick={() => onStopAgent?.()}
			>
				<SquareIcon class="size-3.5 fill-current" />
				<span class="hidden sm:inline">Stop</span>
			</Button>
		{/if}
		<Popover bind:open={optionsOpen}>
			<PopoverTrigger class="inline-flex" aria-label="Chat options">
				<Button type="button" variant="ghost" size="sm" class="h-8 gap-1.5" {disabled}>
					<Settings2Icon class="size-3.5" />
					<span class="hidden sm:inline">Options</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" class="w-80 gap-0 p-0">
				<PopoverHeader class="gap-1 border-b border-border/60 px-4 py-3">
					<PopoverTitle class="text-base">Options</PopoverTitle>
					<p class="text-xs font-normal text-muted-foreground">
						Context for the model and exporting this conversation.
					</p>
				</PopoverHeader>

				<div class="flex flex-col gap-4 px-4 py-4">
					<section class="flex flex-col gap-2" aria-labelledby="ctx-heading">
						<div
							class="flex items-center gap-2 text-sm font-medium text-foreground"
							id="ctx-heading"
						>
							<SlidersHorizontalIcon class="size-4 shrink-0 text-muted-foreground" />
							Context window
						</div>
						<p class="text-xs leading-relaxed text-muted-foreground">
							How many prior user/assistant messages are sent to the model on the next request.
						</p>
						<Select.Root
							type="single"
							value={String(maxHistoryMessages)}
							onValueChange={(v: string) => {
								if (v) maxHistoryMessages = Number(v);
							}}
							{disabled}
						>
							<Select.Trigger class="w-full" aria-label="History depth">
								Last {maxHistoryMessages} messages
							</Select.Trigger>
							<Select.Content>
								{#each presets as p (p)}
									<Select.Item value={String(p)} label={`Last ${p} messages`} />
								{/each}
							</Select.Content>
						</Select.Root>
					</section>

					<Separator />

					<section class="flex flex-col gap-2" aria-labelledby="export-heading">
						<div
							class="flex items-center gap-2 text-sm font-medium text-foreground"
							id="export-heading"
						>
							<DownloadIcon class="size-4 shrink-0 text-muted-foreground" />
							Export
						</div>
						<p class="text-xs leading-relaxed text-muted-foreground">
							Download the current thread as a file.
						</p>
						<div class="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								class="min-w-24 flex-1"
								{disabled}
								onclick={() => {
									onExportJson?.();
									optionsOpen = false;
								}}
							>
								JSON
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								class="min-w-24 flex-1"
								{disabled}
								onclick={() => {
									onExportMarkdown?.();
									optionsOpen = false;
								}}
							>
								Markdown
							</Button>
						</div>
					</section>
				</div>
			</PopoverContent>
		</Popover>
	</div>
</div>
