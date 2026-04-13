<script lang="ts">
	import './layout.css';
	import vectraspaceLogoLight from '$lib/assets/logos/vectraspace-icon-light.png';
	import { goto } from '$app/navigation';
	import { Upload, RefreshCw, CheckCircle, AlertCircle, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { uploadManager } from '$lib/upload-manager';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner/index.js';

	let { children } = $props();

	function openUploads() {
		const destination = $uploadManager.activeDestination;
		const uploadPath = '/upload';
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(destination ? `${uploadPath}?dest=${encodeURIComponent(destination)}` : uploadPath);
	}
</script>

<svelte:head><link rel="icon" href={vectraspaceLogoLight} /></svelte:head>
<ModeWatcher />
<Toaster />
{@render children()}

{#if $uploadManager.items.length > 0 && ($uploadManager.batchPhase !== 'idle' || $uploadManager.batchMessage)}
	<div class="pointer-events-none fixed right-4 bottom-4 z-50 w-[min(24rem,calc(100vw-2rem))]">
		<div
			class="pointer-events-auto rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur"
		>
			<div class="flex items-start gap-3">
				{#if $uploadManager.batchPhase === 'uploading'}
					<Upload class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
				{:else if $uploadManager.batchPhase === 'indexing'}
					<RefreshCw class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
				{:else if $uploadManager.batchPhase === 'error'}
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
				{:else}
					<CheckCircle class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
				{/if}

				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-foreground">
						{#if $uploadManager.batchPhase === 'uploading'}
							Uploading files in the background
						{:else if $uploadManager.batchPhase === 'indexing'}
							Indexing uploaded files
						{:else if $uploadManager.batchPhase === 'error'}
							Upload batch finished with issues
						{:else}
							Upload batch finished
						{/if}
					</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{#if $uploadManager.batchPhase === 'uploading'}
							{$uploadManager.items.filter((item) => item.status === 'done').length} of {$uploadManager
								.items.length} complete
						{:else if $uploadManager.batchPhase === 'indexing'}
							Uploads are done. Semantic indexing is running now.
						{:else}
							{$uploadManager.batchMessage}
						{/if}
					</p>

					<div class="mt-3 flex gap-2">
						<Button size="sm" variant="outline" onclick={openUploads}>Open uploads</Button>
						{#if $uploadManager.batchPhase === 'complete' || $uploadManager.batchPhase === 'error'}
							<Button size="sm" variant="ghost" onclick={uploadManager.dismissBatchMessage}>
								Dismiss
							</Button>
						{/if}
					</div>
				</div>

				{#if $uploadManager.batchPhase === 'complete' || $uploadManager.batchPhase === 'error'}
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7 shrink-0"
						onclick={uploadManager.dismissBatchMessage}
					>
						<X class="h-4 w-4" />
					</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
