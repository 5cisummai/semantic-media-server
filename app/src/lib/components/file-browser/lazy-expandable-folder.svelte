<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import type { FileTreeNode } from './file-tree.svelte';

	let {
		name,
		isSubTree,
		load,
		onLoaded,
		prepareExpand
	}: {
		name: string;
		isSubTree: boolean;
		load: () => Promise<FileTreeNode[]>;
		onLoaded: (children: FileTreeNode[]) => void;
		prepareExpand: () => void;
	} = $props();

	let open = $state(false);
	let loading = $state(false);
	let fetched = $state(false);

	$effect(() => {
		if (!open || fetched || loading) return;
		loading = true;
		void (async () => {
			try {
				prepareExpand();
				const children = await load();
				onLoaded(children);
				fetched = true;
			} finally {
				loading = false;
			}
		})();
	});
</script>

<Collapsible.Root bind:open class="group/collapsible">
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
		{#if loading}
			<div class="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
		{/if}
	</Collapsible.Content>
</Collapsible.Root>
