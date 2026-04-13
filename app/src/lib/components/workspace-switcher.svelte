<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
	import CreateWorkspaceDialog from './create-workspace-dialog.svelte';

	let showCreate = $state(false);
	const sidebar = useSidebar();

	async function activateWorkspace(workspaceId: string) {
		await workspaceStore.select(workspaceId);
		await invalidateAll();
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<div
							class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
						>
							<FolderOpenIcon class="size-4" />
						</div>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">
								{workspaceStore.active?.name ?? 'No Workspace'}
							</span>
							<span class="truncate text-xs text-muted-foreground">
								{workspaceStore.active?.memberCount ?? 0} member{(workspaceStore.active
									?.memberCount ?? 0) !== 1
									? 's'
									: ''}
							</span>
						</div>
						<ChevronsUpDownIcon class="ms-auto" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				align="start"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				sideOffset={4}
			>
				<DropdownMenu.Label class="text-xs text-muted-foreground">Workspaces</DropdownMenu.Label>
				{#each workspaceStore.workspaces as ws (ws.id)}
					<DropdownMenu.Item onSelect={() => activateWorkspace(ws.id)} class="gap-2 p-2">
						<div class="flex size-6 items-center justify-center rounded-md border">
							<FolderOpenIcon class="size-3.5 shrink-0" />
						</div>
						<span class="flex-1">{ws.name}</span>
						{#if ws.id === workspaceStore.activeId}
							<CheckIcon class="size-4 text-primary" />
						{/if}
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="gap-2 p-2" onSelect={() => (showCreate = true)}>
					<div class="flex size-6 items-center justify-center rounded-md border bg-transparent">
						<PlusIcon class="size-4" />
					</div>
					<div class="font-medium text-muted-foreground">Create workspace</div>
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

{#if showCreate}
	<CreateWorkspaceDialog bind:open={showCreate} />
{/if}
