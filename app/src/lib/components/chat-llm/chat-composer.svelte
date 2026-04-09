<script lang="ts">
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';

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

	let textareaEl = $state<HTMLTextAreaElement | null>(null);

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
	<div class="flex items-end gap-2 border-t border-border bg-background pt-3">
		<textarea
			bind:this={textareaEl}
			bind:value
			oninput={resizeComposer}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					onSubmit?.();
				}
			}}
			{placeholder}
			rows="1"
			{disabled}
			class="flex-1 resize-none text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
		></textarea>

		<button
			type="submit"
			disabled={disabled || !value.trim()}
			class="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background disabled:opacity-40"
			aria-label="Send"
		>
			<ArrowUpIcon class="h-4 w-4" />
		</button>
	</div>
</form>
