<script lang="ts" module>
	export type FilePreviewItem = {
		name: string;
		path?: string;
		url?: string;
		mimeType?: string;
		type?: 'file' | 'directory';
	};
</script>

<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import ImageIcon from '@lucide/svelte/icons/image';
	import MusicIcon from '@lucide/svelte/icons/music';
	import VideoIcon from '@lucide/svelte/icons/video';

	let {
		item,
		class: className = ''
	}: {
		item: FilePreviewItem;
		class?: string;
	} = $props();

	const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff']);
	const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv']);
	const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']);
	const DOCUMENT_EXTENSIONS = new Set([
		'pdf',
		'txt',
		'md',
		'doc',
		'docx',
		'xls',
		'xlsx',
		'ppt',
		'pptx',
		'epub',
		'cbz',
		'cbr'
	]);

	const normalizedName = $derived(item.name ?? item.path ?? 'Untitled');
	const mediaUrl = $derived(item.url ?? item.path ?? '');
	const extension = $derived(normalizedName.split('.').pop()?.toLowerCase() ?? '');
	const isDirectory = $derived(item.type === 'directory');

	const isImage = $derived(
		!isDirectory &&
			((item.mimeType?.startsWith('image/') ?? false) || IMAGE_EXTENSIONS.has(extension))
	);
	const isVideo = $derived(
		!isDirectory &&
			((item.mimeType?.startsWith('video/') ?? false) || VIDEO_EXTENSIONS.has(extension))
	);
	const isAudio = $derived(
		!isDirectory &&
			((item.mimeType?.startsWith('audio/') ?? false) || AUDIO_EXTENSIONS.has(extension))
	);
	const isDocument = $derived(!isDirectory && DOCUMENT_EXTENSIONS.has(extension));

	const TileIcon = $derived.by(() => {
		if (isDirectory) return FolderIcon;
		if (isImage) return ImageIcon;
		if (isVideo) return VideoIcon;
		if (isAudio) return MusicIcon;
		if (isDocument) return FileTextIcon;
		return FileIcon;
	});

	/** Thumbnail preview only for raster/visual media; folders/docs/audio use icons only. */
	const showImagePreview = $derived(isImage && !!mediaUrl);
	const showVideoPreview = $derived(isVideo && !!mediaUrl);
</script>

<article class={`group flex min-w-0 flex-col gap-2 ${className}`}>
	{#if showImagePreview}
		<div
			class="relative aspect-square overflow-hidden rounded-lg bg-muted/25 transition-colors group-hover:bg-muted/40"
		>
			<img
				src={mediaUrl}
				alt={normalizedName}
				class="h-full w-full object-cover"
				loading="lazy"
				decoding="async"
			/>
		</div>
	{:else if showVideoPreview}
		<div
			class="relative aspect-square overflow-hidden rounded-lg bg-muted/25 transition-colors group-hover:bg-muted/40"
		>
			<video
				src={mediaUrl}
				class="h-full w-full object-cover"
				muted
				preload="metadata"
				playsinline
				controls={false}
			></video>
		</div>
	{:else}
		<div
			class="flex aspect-square items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:text-foreground"
			aria-hidden="true"
		>
			<TileIcon class="size-12 shrink-0" />
		</div>
	{/if}

	<div class="min-w-0">
		<p class="truncate text-sm font-medium text-foreground">{normalizedName}</p>
	</div>
</article>
