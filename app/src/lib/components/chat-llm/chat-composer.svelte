<script lang="ts">
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		value = $bindable(''),
		disabled = false,
		placeholder = 'Message…',
		onSubmit
	}: {
		value?: string;
		disabled?: boolean;
		placeholder?: string;
		onSubmit?: () => void;
	} = $props();

	let textareaEl = $state<HTMLElement | null>(null);

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
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		onSubmit?.();
	}}
	class="mx-auto w-full max-w-3xl"
>
	<div class="flex items-end gap-2 rounded-2xl border border-border bg-muted/20 px-3 py-2">
		<Textarea
			bind:ref={textareaEl}
			bind:value
			oninput={resizeComposer}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					onSubmit?.();
				}
			}}
			{placeholder}
			rows={1}
			{disabled}
			class="max-h-48 flex-1 resize-none border-0 bg-transparent! shadow-none focus-visible:ring-0"
		/>

		<Button
			type="submit"
			size="icon"
			disabled={disabled || !value.trim()}
			class="mb-0.5 size-8 shrink-0 rounded-xl bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
			aria-label="Send"
		>
			<ArrowUpIcon class="size-4" />
		</Button>
	</div>
</form>
