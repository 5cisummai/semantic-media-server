<script lang="ts" module>
	export interface FileTreeItem {
		id?: string;
		name?: string;
		title?: string;
		path?: string;
		type?: 'file' | 'directory' | 'folder';
		children?: FileTreeNode[];
	}

	export type FileTreeNode = string | FileTreeItem | Array<FileTreeNode>;
</script>

<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FileIcon from '@lucide/svelte/icons/file';
	import { createEventDispatcher } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import FileTreeSelf from './file-tree.svelte';

	let {
		tree = [],
		activePath = null,
		parentPath = '',
		isSubTree = false
	}: {
		tree: FileTreeNode[];
		activePath: string | null;
		parentPath: string;
		isSubTree?: boolean;
	} = $props();

	const dispatch = createEventDispatcher<{ select: string }>();
	let expandedFolders: string[] = [];

	function getName(item: FileTreeNode) {
		if (typeof item === 'string') return item;
		if (Array.isArray(item)) return String(item[0] ?? 'Untitled');
		return item.name ?? item.title ?? item.id ?? item.path ?? 'Untitled';
	}

	function getPath(item: FileTreeNode) {
		if (typeof item === 'string') return parentPath ? `${parentPath}/${item}` : item;
		if (Array.isArray(item)) return parentPath ? `${parentPath}/${getName(item)}` : getName(item);
		return item.path ?? (parentPath ? `${parentPath}/${getName(item)}` : getName(item));
	}

	function getChildren(item: FileTreeNode) {
		if (typeof item === 'string') return [];
		if (Array.isArray(item)) return (item.slice(1) as FileTreeNode[]).filter(isFolder);
		return (item.children ?? []).filter(isFolder);
	}

	function getKey(item: FileTreeNode, index: number) {
		if (typeof item === 'string') return item;
		if (Array.isArray(item)) return `${getName(item)}-${index}`;
		return item.id ?? item.path ?? `${getName(item)}-${index}`;
	}

	function isFolder(item: FileTreeNode) {
		if (Array.isArray(item)) return true;
		if (typeof item === 'string') return false;
		return item.type === 'directory' || item.type === 'folder' || !!item.children?.length;
	}

	function isExpanded(path: string) {
		return expandedFolders.includes(path);
	}

	function toggle(path: string) {
		expandedFolders = isExpanded(path)
			? expandedFolders.filter((v) => v !== path)
			: [...expandedFolders, path];
	}

	function select(path: string) {
		dispatch('select', path);
	}

	function handleSelect(path: string) {
		dispatch('select', path);
	}
</script>

{#each tree as item, index (getKey(item, index))}
	{@const name = getName(item)}
	{@const path = getPath(item)}
	{#if isFolder(item)}
		{@const children = getChildren(item)}
		{#if children.length > 0}
			<Collapsible.Root open={isExpanded(path)} class="group/collapsible">
				<Collapsible.Trigger
					class={isSubTree
						? 'flex w-full items-center gap-2 truncate rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground'
						: 'flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground'}
				>
					<ChevronRightIcon
						class="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
					/>
					<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
					<span class="truncate">{name}</span>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class={isSubTree ? 'ps-4' : 'ps-2'}>
						<FileTreeSelf
							tree={children}
							{activePath}
							parentPath={path}
							isSubTree={true}
							on:select={(e) => handleSelect(e.detail)}
						/>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{:else}
			<Button
				variant="ghost"
				class="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm {isSubTree
					? 'rounded-sm'
					: 'rounded-md'}"
				onclick={() => select(path)}
			>
				<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
				<span class="truncate">{name}</span>
			</Button>
		{/if}
	{:else}
		<Button
			variant="ghost"
			class="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm {isSubTree
				? 'rounded-sm'
				: 'rounded-md'}"
			onclick={() => select(path)}
		>
			<FileIcon class="size-4 shrink-0 text-muted-foreground" />
			<span class="truncate">{name}</span>
		</Button>
	{/if}
{/each}
