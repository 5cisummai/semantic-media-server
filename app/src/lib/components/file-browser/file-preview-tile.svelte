<script lang="ts" module>
	export type FilePreviewItem = {
		name: string;
		path?: string;
		url?: string;
		mimeType?: string;
		mediaType?: 'video' | 'audio' | 'image' | 'document' | 'other';
		viewerKind?: 'video' | 'audio' | 'image' | 'pdf' | 'text' | 'none';
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
			(item.viewerKind === 'image' ||
				item.mediaType === 'image' ||
				(item.mimeType?.startsWith('image/') ?? false) ||
				IMAGE_EXTENSIONS.has(extension))
	);
	const isVideo = $derived(
		!isDirectory &&
			(item.viewerKind === 'video' ||
				item.mediaType === 'video' ||
				(item.mimeType?.startsWith('video/') ?? false) ||
				VIDEO_EXTENSIONS.has(extension))
	);
	const isAudio = $derived(
		!isDirectory &&
			(item.viewerKind === 'audio' ||
				item.mediaType === 'audio' ||
				(item.mimeType?.startsWith('audio/') ?? false) ||
				AUDIO_EXTENSIONS.has(extension))
	);
	const isDocument = $derived(
		!isDirectory &&
			(item.viewerKind === 'pdf' ||
				item.mediaType === 'document' ||
				DOCUMENT_EXTENSIONS.has(extension))
	);

	const TileIcon = $derived.by(() => {
		if (isDirectory) return FolderIcon;
		if (isImage) return ImageIcon;
		if (isVideo) return VideoIcon;
		if (isAudio) return MusicIcon;
		if (isDocument) return FileTextIcon;
		return FileIcon;
	});

	/** Thumbnail preview only for images; everything else uses icons to keep grid memory low. */
	const showImagePreview = $derived(isImage && !!mediaUrl);
</script>

<article class={`group flex min-h-0 min-w-0 flex-col gap-1 ${className}`}>
	{#if showImagePreview}
		<div
			class="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-muted/25 transition-colors group-hover:bg-muted/40"
		>
			<img
				src={mediaUrl}
				alt={normalizedName}
				class="h-full w-full object-cover"
				loading="lazy"
				decoding="async"
			/>
		</div>
	{:else}
		<div
			class="relative min-h-0 flex-1 overflow-hidden rounded-lg text-muted-foreground transition-colors group-hover:text-foreground"
			aria-hidden="true"
		>
			<TileIcon class="absolute top-2 left-2 block size-[calc(100%-1rem)]" />
		</div>
	{/if}

	<div class="w-full min-w-0 shrink-0 px-0.5">
		<p class="truncate text-center text-sm font-medium text-foreground">{normalizedName}</p>
	</div>
</article>
