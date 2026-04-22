<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import MusicIcon from '@lucide/svelte/icons/music';
	import SaveIcon from '@lucide/svelte/icons/save';
	import { Editor, Workspace, type File as CodeFile } from '@umaranis/svelte-code-editor';
	import '$lib/styles/media-code-editor-host.css';
	import { Button } from '$lib/components/ui/button';
	import { apiFetch } from '$lib/api-fetch';
	import { isTextEditorExtension } from '$lib/media-text-extensions';

	const MEDIA_EXTENSIONS = {
		video: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogv'],
		audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'],
		image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'ico'],
		pdf: ['pdf']
	};

	function getMediaType(path: string): 'video' | 'audio' | 'image' | 'pdf' | 'text' | null {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
		if (MEDIA_EXTENSIONS.audio.includes(ext)) return 'audio';
		if (MEDIA_EXTENSIONS.image.includes(ext)) return 'image';
		if (MEDIA_EXTENSIONS.pdf.includes(ext)) return 'pdf';
		if (isTextEditorExtension(ext)) return 'text';
		return null;
	}

	const selectedFile = $derived(($page.url.searchParams.get('file') ?? '') as string);
	const mediaType = $derived(selectedFile ? getMediaType(selectedFile) : null);
	const mediaUrl = $derived(selectedFile ? `/api/stream/${selectedFile}` : '');
	const writeUrl = $derived(selectedFile ? `/api/write/${selectedFile}` : '');
	const fileName = $derived(selectedFile.split('/').pop() ?? 'Unknown');
	let textContent = $state('');
	let textDraft = $state('');
	let textLoadError = $state<string | null>(null);
	let textLoaded = $state(false);
	let textSaving = $state(false);
	let textSaveError = $state<string | null>(null);
	const textDirty = $derived(mediaType === 'text' && textLoaded && textDraft !== textContent);

	let editorLoadToken = $state(0);
	let codeWorkspace = $state<Workspace | undefined>(undefined);

	$effect(() => {
		if (mediaType !== 'text' || !mediaUrl) {
			textContent = '';
			textDraft = '';
			textLoadError = null;
			textLoaded = false;
			textSaving = false;
			textSaveError = null;
			return;
		}

		const controller = new AbortController();
		textLoadError = null;
		textSaveError = null;
		textContent = '';
		textDraft = '';
		textLoaded = false;

		void fetch(mediaUrl, { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				return res.text();
			})
			.then((text) => {
				textContent = text;
				textDraft = text;
				textLoaded = true;
				editorLoadToken += 1;
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				textLoadError = err instanceof Error ? err.message : 'Could not load text preview';
			});

		return () => controller.abort();
	});

	$effect(() => {
		if (mediaType !== 'text' || !textLoaded) {
			codeWorkspace = undefined;
			return;
		}

		void editorLoadToken;
		const path = selectedFile;
		const base = fileName;
		const contents = untrack(() => textContent);

		const file: CodeFile = {
			type: 'file',
			name: path,
			basename: base,
			contents,
			text: true
		};

		codeWorkspace = new Workspace([file], {
			initial: path,
			svelte_version: 'latest',
			allowNewFile: false,
			onupdate: (f) => {
				textDraft = f.contents;
			}
		});
	});

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

	async function saveTextFile() {
		if (mediaType !== 'text' || !textDirty || !writeUrl || textSaving) return;
		textSaving = true;
		textSaveError = null;
		try {
			const res = await apiFetch(writeUrl, {
				method: 'PUT',
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				body: textDraft
			});
			if (!res.ok) {
				const message = (await res.text()) || `HTTP ${res.status}`;
				throw new Error(message);
			}
			textContent = textDraft;
			codeWorkspace?.mark_saved();
		} catch (err: unknown) {
			textSaveError = err instanceof Error ? err.message : 'Could not save file';
		} finally {
			textSaving = false;
		}
	}

	function onEditorKeydown(event: KeyboardEvent) {
		if (mediaType !== 'text') return;
		if (event.key.toLowerCase() !== 's') return;
		if (!event.metaKey && !event.ctrlKey) return;
		event.preventDefault();
		void saveTextFile();
	}
</script>

<svelte:window onkeydown={onEditorKeydown} />

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
			{#if mediaType === 'text'}
				<div class="ml-auto flex items-center gap-2">
					{#if textDirty}
						<span class="text-xs text-amber-300">Unsaved changes</span>
					{/if}
					<Button
						variant="outline"
						size="sm"
						class="border-white/20 bg-transparent text-white hover:bg-white/10"
						disabled={!textDirty || textSaving || !textLoaded}
						onclick={saveTextFile}
					>
						<SaveIcon class="size-4" />
						{textSaving ? 'Saving...' : 'Save'}
					</Button>
				</div>
			{/if}
		</header>

		<main
			class="flex min-h-0 flex-1 overflow-hidden p-4 {mediaType === 'pdf' || mediaType === 'text'
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
			{:else if mediaType === 'text'}
				<div
					class="min-h-0 w-full flex-1 overflow-auto rounded-lg border border-white/10 bg-muted/20 p-4"
				>
					{#if textLoadError}
						<p class="text-sm text-destructive">Could not load preview: {textLoadError}</p>
					{:else if !textLoaded}
						<p class="text-sm text-muted-foreground">Loading text preview...</p>
					{:else if codeWorkspace}
						{#key editorLoadToken}
							<div
								class="media-code-editor-root flex h-full min-h-[320px] flex-1 flex-col overflow-hidden rounded-md border border-white/10 bg-background/80"
							>
								<Editor workspace={codeWorkspace} />
							</div>
						{/key}
					{:else}
						<p class="text-sm text-muted-foreground">Preparing editor…</p>
					{/if}
					{#if textLoaded && textSaveError}
						<p class="mt-2 text-sm text-destructive">Could not save file: {textSaveError}</p>
					{/if}
				</div>
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
