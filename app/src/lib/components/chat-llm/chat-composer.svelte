<script lang="ts">
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { filterCommands, type SlashCommand } from './slash-commands';

	let {
		value = $bindable(''),
		disabled = false,
		placeholder = 'Message…',
		onSubmit,
		onCommand
	}: {
		value?: string;
		disabled?: boolean;
		placeholder?: string;
		onSubmit?: () => void;
		onCommand?: (name: string) => void;
	} = $props();

	let textareaEl = $state<HTMLElement | null>(null);
	let selectedIndex = $state(0);

	function resizeComposer() {
		const el = textareaEl;
		if (!el) return;
		el.style.height = '0px';
		const next = Math.min(Math.max(el.scrollHeight, 52), 220);
		el.style.height = `${next}px`;
	}

	// Resize whenever the value changes. $effect runs after DOM updates,
	// so the textarea element is already rendered when this fires.
	$effect(() => {
		void value;
		resizeComposer();
	});

	// Compute the slash-command query from the current value.
	const slashQuery = $derived(value.startsWith('/') ? value.slice(1) : null);
	const suggestions = $derived<SlashCommand[]>(
		slashQuery !== null ? filterCommands(slashQuery) : []
	);

	// Reset selection when suggestions change.
	$effect(() => {
		void suggestions;
		selectedIndex = 0;
	});

	function selectCommand(cmd: SlashCommand) {
		value = '';
		onCommand?.(cmd.name);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (suggestions.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedIndex = (selectedIndex + 1) % suggestions.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
				return;
			}
			if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
				const cmd = suggestions[selectedIndex];
				if (cmd) {
					e.preventDefault();
					selectCommand(cmd);
					return;
				}
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				value = '';
				return;
			}
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSubmit?.();
		}
	}
</script>

<div class="relative mx-auto w-full max-w-3xl">
	{#if suggestions.length > 0}
		<div
			class="absolute right-0 bottom-full left-0 z-50 mb-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-md"
			role="listbox"
			aria-label="Slash commands"
		>
			{#each suggestions as cmd, i (cmd.name)}
				<button
					type="button"
					role="option"
					aria-selected={i === selectedIndex}
					class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 {i ===
					selectedIndex
						? 'bg-muted/60'
						: ''}"
					onmousedown={(e) => {
						e.preventDefault();
						selectCommand(cmd);
					}}
					onmouseenter={() => {
						selectedIndex = i;
					}}
				>
					<span class="font-medium text-foreground">/{cmd.name}</span>
					<span class="text-muted-foreground">{cmd.description}</span>
				</button>
			{/each}
		</div>
	{/if}

	<form
		onsubmit={(e) => {
			e.preventDefault();
			onSubmit?.();
		}}
	>
		<div class="flex items-end gap-2 rounded-2xl border border-border bg-muted/20 px-3 py-2">
			<Textarea
				bind:ref={textareaEl}
				bind:value
				oninput={resizeComposer}
				onkeydown={handleKeydown}
				{placeholder}
				rows={1}
				{disabled}
				class="max-h-48 flex-1 resize-none border-0 bg-transparent! shadow-none focus-visible:ring-0"
			/>

			<Button
				type="submit"
				size="icon"
				disabled={disabled || !value.trim() || suggestions.length > 0}
				class="mb-0.5 size-8 shrink-0 rounded-xl bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
				aria-label="Send"
			>
				<ArrowUpIcon class="size-4" />
			</Button>
		</div>
	</form>
</div>
