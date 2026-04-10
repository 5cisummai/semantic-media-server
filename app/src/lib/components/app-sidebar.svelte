<script lang="ts" module>
	import BotIcon from '@lucide/svelte/icons/bot';
	import FilesIcon from '@lucide/svelte/icons/files';
	import HomeIcon from '@lucide/svelte/icons/home';
	import MagnifyingGlassIcon from '@lucide/svelte/icons/search';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import FolderCogIcon from '@lucide/svelte/icons/folder-cog';

	const navMain = [
		{
			title: 'Home',
			href: '/home',
			icon: HomeIcon,
		},
		{
			title: 'Browser',
			href: '/browse',
			icon: FilesIcon,
		},
		{
			title: 'Agent',
			href: '/chat',
			icon: BotIcon,
		},
		{
			title: 'Smart Search',
			icon: MagnifyingGlassIcon,
		},
		{
			title: 'Workspace',
			href: '/workspace',
			icon: FolderCogIcon,
		},
		{
			title: 'Settings',
			href: '/settings',
			icon: SettingsIcon,
		},
	] as const;
</script>

<script lang="ts">
	import NavMain from './nav-main.svelte';
	import NavAgentSessions from './nav-agent-sessions.svelte';
	import NavUser from './nav-user.svelte';
	import WorkspaceSwitcher from './workspace-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { browser } from '$app/environment';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		collapsible = 'icon',
		...restProps
	}: ComponentProps<typeof Sidebar.Root> = $props();

	let username = $state('User');

	if (browser) {
		username = localStorage.getItem('username') ?? 'User';
	}
</script>

<Sidebar.Root bind:ref {collapsible} {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<div
					class="flex h-12 items-center gap-2 px-2 text-sidebar-foreground"
					data-slot="sidebar-brand"
				>
					<span class="truncate font-semibold tracking-tight">Vectraspace</span>
				</div>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		<WorkspaceSwitcher />
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain items={[...navMain]} />
		<NavAgentSessions />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser {username} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
