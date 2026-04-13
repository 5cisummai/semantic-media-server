<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FileBrowser from '$lib/components/file-browser/file-broswer.svelte';
	import type { FileEntry } from '$lib/components/file-browser/file-grid.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type BrowseNode = {
		name?: string;
		title?: string;
		path?: string;
		type?: 'file' | 'directory' | 'folder';
		children?: BrowseNode[];
	};

	type BrowseEntry = PageData['folderContents'][number];

	const fileTree = $derived((data.fileTree ?? []) as BrowseNode[]);

	function toFileEntries(nodes: BrowseNode[]): FileEntry[] {
		return nodes.map((node, index) => {
			const name = node.name ?? node.title ?? `Item ${index + 1}`;
			const path = node.path ?? name;
			const isDirectory =
				node.type === 'directory' || node.type === 'folder' || !!node.children?.length;
			return {
				id: path,
				name,
				path,
				type: isDirectory ? 'directory' : 'file',
				children: node.children ? toFileEntries(node.children) : []
			};
		});
	}

	const browserTree = $derived(toFileEntries(fileTree));
	const currentPath = $derived(data.currentPath ?? '');
	const folderContents = $derived(
		data.folderContents.map((entry: BrowseEntry) => ({
			id: entry.path,
			name: entry.name,
			path: entry.path,
			type: entry.type,
			children: entry.type === 'directory' ? [] : undefined
		}))
	);

	function handlePathChange(path: string) {
		const url = new URL($page.url);
		if (path) {
			url.searchParams.set('path', path);
		} else {
			url.searchParams.delete('path');
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url.pathname + url.search, { keepFocus: true });
	}

	function handleFileSelect(event: CustomEvent<FileEntry>) {
		const media = resolve('/(app)/browse/media');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${media}?file=${encodeURIComponent(event.detail.path)}`, { keepFocus: true });
	}
</script>

<div class="h-screen w-full bg-background text-foreground">
	<FileBrowser
		fileTree={browserTree}
		{folderContents}
		selectedPath={null}
		{currentPath}
		on:select={handleFileSelect}
		on:pathChange={(e) => handlePathChange(e.detail)}
	/>
</div>
