<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import MusicIcon from '@lucide/svelte/icons/music';
	import { Button } from '$lib/components/ui/button';

	const MEDIA_EXTENSIONS = {
		video: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogv'],
		audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'],
		image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'ico'],
		pdf: ['pdf']
	};

	function getMediaType(path: string): 'video' | 'audio' | 'image' | 'pdf' | null {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
		if (MEDIA_EXTENSIONS.audio.includes(ext)) return 'audio';
		if (MEDIA_EXTENSIONS.image.includes(ext)) return 'image';
		if (MEDIA_EXTENSIONS.pdf.includes(ext)) return 'pdf';
		return null;
	}

	const selectedFile = $derived(($page.url.searchParams.get('file') ?? '') as string);
	const mediaType = $derived(selectedFile ? getMediaType(selectedFile) : null);
	const mediaUrl = $derived(selectedFile ? `/api/stream/${selectedFile}` : '');
	const fileName = $derived(selectedFile.split('/').pop() ?? 'Unknown');

	function parentFolder(filePath: string): string {
		const parts = filePath.split('/').filter(Boolean);
		parts.pop();
		return parts.join('/');
	}

	function goBack() {
		const browse = resolve('/(app)/browse');
		const folder = selectedFile ? parentFolder(selectedFile) : '';
		const url = folder ? `${browse}?path=${encodeURIComponent(folder)}` : browse;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url, { keepFocus: true });
	}
</script>

{#if selectedFile && mediaType}
	<div class="flex h-full flex-col bg-background">
		<header class="flex shrink-0 items-center gap-4 border-b border-white/10 px-4 py-3">
			<Button
				variant="ghost"
				size="icon"
				class="text-white/70 hover:bg-white/10 hover:text-white"
				onclick={goBack}
				title="Back to browser"
			>
				<ArrowLeftIcon class="size-5" />
			</Button>
			<h1 class="truncate text-sm font-medium text-white">{fileName}</h1>
		</header>

		<main
			class="flex min-h-0 flex-1 overflow-hidden p-4 {mediaType === 'pdf'
				? 'flex-col'
				: 'items-center justify-center'}"
		>
			{#if mediaType === 'video'}
				<video src={mediaUrl} class="max-h-full max-w-full object-contain" controls autoplay>
					<track kind="captions" />
				</video>
			{:else if mediaType === 'audio'}
				<div class="flex flex-col items-center gap-6">
					<div class="flex items-center justify-center rounded-full bg-white/10 p-12">
						<MusicIcon class="size-16 text-white" />
					</div>
					<audio src={mediaUrl} controls class="w-full max-w-md">
						<track kind="captions" />
					</audio>
				</div>
			{:else if mediaType === 'image'}
				<img src={mediaUrl} alt={fileName} class="max-h-full max-w-full object-contain" />
			{:else if mediaType === 'pdf'}
				<iframe
					src={mediaUrl}
					title={fileName}
					class="min-h-0 w-full flex-1 rounded-lg border border-white/10 bg-muted/30"
				></iframe>
			{/if}
		</main>
	</div>
{:else}
	<div class="flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
		<p class="text-sm text-muted-foreground">
			{#if !selectedFile}
				No file selected.
			{:else}
				This file type is not supported for inline preview.
			{/if}
		</p>
		<Button variant="outline" onclick={goBack}>Back to browser</Button>
	</div>
{/if}
