<script lang="ts">
	import { Folder, FileVideo, FileMusic, FileImage, FileText, File } from '@lucide/svelte';

	type MediaType = 'video' | 'audio' | 'image' | 'document' | 'other';

	interface Props {
		entryType: 'file' | 'directory';
		mediaType?: MediaType;
		class?: string;
	}

	let { entryType, mediaType, class: className = '' }: Props = $props();
</script>

{#if entryType === 'directory'}
	<Folder class={className} />
{:else if mediaType === 'video'}
	<FileVideo class={className} />
{:else if mediaType === 'audio'}
	<FileMusic class={className} />
{:else if mediaType === 'image'}
	<FileImage class={className} />
{:else if mediaType === 'document'}
	<FileText class={className} />
{:else}
	<File class={className} />
{/if}
