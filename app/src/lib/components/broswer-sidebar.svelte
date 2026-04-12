<script lang="ts">
	import { page } from '$app/stores';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import FileTree from '$lib/components/file-browser/file-tree.svelte';
	import { createEventDispatcher } from 'svelte';
	import type { ComponentProps } from 'svelte';
	import type { FileEntry } from '$lib/components/file-browser/file-grid.svelte';

	const dispatch = createEventDispatcher<{ select: string }>();
	let {
		ref = $bindable(null),
		activePath = null,
		tree = null,
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & {
		activePath?: string | null;
		tree?: FileEntry[] | null;
	} = $props();

	const sidebarTree = $derived((tree ?? $page.data.fileTree ?? []) as FileEntry[]);

	function handleSelect(event: CustomEvent<string>) {
		dispatch('select', event.detail);
	}
</script>

<Sidebar.Provider>
	<Sidebar.Root bind:ref {...restProps}>
		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>Files</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					{#if sidebarTree.length}
						<Sidebar.Menu>
							<FileTree tree={sidebarTree} {activePath} parentPath="" on:select={handleSelect} />
						</Sidebar.Menu>
					{:else}
						<div class="px-3 text-xs text-muted-foreground">Loading files...</div>
					{/if}
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</Sidebar.Content>
		<Sidebar.Rail />
	</Sidebar.Root>
</Sidebar.Provider>
