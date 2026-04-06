<script lang="ts">
	import { goto } from '$app/navigation';
	import {
    ArrowLeft,
    Download,
    FileQuestion,
    Volume2,
    Maximize,
    Upload,
    X,
    CheckCircle,
    AlertCircle,
    File as FileIcon
} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';

	interface Props {
		data: { dest: string };
	}

	let { data }: Props = $props();

	const dest = $derived(data.dest);

	type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

	interface UploadFile {
		id: string;
		file: globalThis.File;
		status: UploadStatus;
		progress: number;
		error?: string;
	}

	let files = $state<UploadFile[]>([]);
	let dragOver = $state(false);
	let uploading = $state(false);

	function formatSize(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	}

	function createUploadId() {
		if (globalThis.crypto?.randomUUID) {
			return globalThis.crypto.randomUUID();
		}

		return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function addFiles(incoming: FileList | File[]) {
		const newFiles: UploadFile[] = Array.from(incoming).map((f) => ({
			id: createUploadId(),
			file: f,
			status: 'pending',
			progress: 0
		}));
		files = [...files, ...newFiles];
	}

	function removeFile(id: string) {
		files = files.filter((f) => f.id !== id);
	}

	function onFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files) addFiles(input.files);
		input.value = '';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function onDragLeave() {
		dragOver = false;
	}

	async function uploadFile(item: UploadFile) {
		item.status = 'uploading';
		item.progress = 0;
		files = files; // trigger reactivity

		return new Promise<void>((resolve) => {
			const formData = new FormData();
			formData.append('file', item.file);
			formData.append('destination', dest);

			const xhr = new XMLHttpRequest();

			xhr.upload.addEventListener('progress', (e) => {
				if (e.lengthComputable) {
					item.progress = Math.round((e.loaded / e.total) * 100);
					files = files; // trigger reactivity
				}
			});

			xhr.addEventListener('load', () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					item.status = 'done';
					item.progress = 100;
				} else {
					item.status = 'error';
					item.error = `Server error ${xhr.status}`;
				}
				files = files;
				resolve();
			});

			xhr.addEventListener('error', () => {
				item.status = 'error';
				item.error = 'Network error';
				files = files;
				resolve();
			});

			xhr.open('POST', '/api/upload');
			xhr.send(formData);
		});
	}

	async function uploadAll() {
		uploading = true;
		const pending = files.filter((f) => f.status === 'pending');
		for (const item of pending) {
			await uploadFile(item);
		}
		uploading = false;
	}

	function goBack() {
		goto(`/?browse=${dest}`);
	}

	const allDone = $derived(files.length > 0 && files.every((f) => f.status === 'done'));
	const hasPending = $derived(files.some((f) => f.status === 'pending'));
	const hasErrors = $derived(files.some((f) => f.status === 'error'));
</script>

<div class="min-h-screen bg-background text-foreground">
	<!-- Topbar -->
	<header class="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
		<div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
			<Button variant="ghost" size="icon" class="h-8 w-8" onclick={goBack}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<Separator orientation="vertical" class="h-5" />
			<span class="flex-1 font-medium">Upload files</span>
			{#if dest}
				<Badge variant="outline" class="font-mono text-xs">→ {dest}</Badge>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-6">

		<!-- Drop zone -->
		<Card.Root
			class="border-2 border-dashed transition-colors duration-150
				{dragOver ? 'border-primary bg-primary/5' : 'border-border'}"
		>
			<Card.Content class="flex flex-col items-center gap-4 py-16"
				ondrop={onDrop}
				ondragover={onDragOver}
				ondragleave={onDragLeave}
				role="region"
				aria-label="File drop zone"
			>
				<div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
					<Upload class="h-7 w-7 text-muted-foreground" />
				</div>
				<div class="text-center">
					<p class="font-medium">Drop files here</p>
					<p class="mt-1 text-sm text-muted-foreground">or click to browse</p>
				</div>
				<label>
					<Button variant="outline" size="sm" onclick={(e) => e.currentTarget.parentElement?.querySelector('input')?.click()}>
						Browse files
					</Button>
					<input
						type="file"
						multiple
						class="hidden"
						onchange={onFileInput}
					/>
				</label>
			</Card.Content>
		</Card.Root>

		<!-- File list -->
		{#if files.length > 0}
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">{files.length} file{files.length !== 1 ? 's' : ''} selected</span>
					<div class="flex gap-2">
						{#if hasErrors}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => files = files.filter(f => f.status !== 'error')}
							>
								Clear errors
							</Button>
						{/if}
						{#if hasPending}
							<Button size="sm" onclick={uploadAll} disabled={uploading}>
								<Upload class="mr-2 h-3.5 w-3.5" />
								Upload all
							</Button>
						{/if}
					</div>
				</div>

				<Card.Root>
					<Card.Content class="divide-y divide-border p-0">
						{#each files as item (item.id)}
							<div class="flex items-center gap-3 px-4 py-3">
								<!-- Icon -->
								<FileIcon class="h-5 w-5 shrink-0 text-muted-foreground" />

								<!-- Name + progress -->
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between gap-2">
										<span class="truncate text-sm font-medium">{item.file.name}</span>
										<span class="shrink-0 text-xs text-muted-foreground">
											{formatSize(item.file.size)}
										</span>
									</div>
									{#if item.status === 'uploading'}
										<Progress value={item.progress} class="mt-1.5 h-1.5" />
										<span class="text-xs text-muted-foreground">{item.progress}%</span>
									{:else if item.status === 'error'}
										<p class="mt-0.5 text-xs text-destructive">{item.error}</p>
									{/if}
								</div>

								<!-- Status -->
								{#if item.status === 'done'}
									<CheckCircle class="h-4 w-4 shrink-0 text-green-500" />
								{:else if item.status === 'error'}
									<AlertCircle class="h-4 w-4 shrink-0 text-destructive" />
								{:else if item.status === 'pending'}
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7 shrink-0"
										onclick={() => removeFile(item.id)}
										disabled={uploading}
									>
										<X class="h-3.5 w-3.5" />
									</Button>
								{/if}
							</div>
						{/each}
					</Card.Content>
				</Card.Root>
			</div>
		{/if}

		<!-- All done state -->
		{#if allDone}
			<div class="flex flex-col items-center gap-4 py-6 text-center">
				<CheckCircle class="h-12 w-12 text-green-500" />
				<div>
					<p class="font-medium">All files uploaded</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{files.length} file{files.length !== 1 ? 's' : ''} added to your library
					</p>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => files = []}>
						Upload more
					</Button>
					<Button onclick={goBack}>
						Back to library
					</Button>
				</div>
			</div>
		{/if}

	</main>
</div>