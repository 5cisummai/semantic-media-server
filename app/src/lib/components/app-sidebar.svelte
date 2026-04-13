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
			icon: HomeIcon
		},
		{
			title: 'Browser',
			href: '/browse',
			icon: FilesIcon
		},
		{
			title: 'Agent',
			href: '/chat',
			icon: BotIcon
		},
		{
			title: 'Smart Search',
			href: '/search',
			icon: MagnifyingGlassIcon
		},
		{
			title: 'Workspace',
			href: '/workspace',
			icon: FolderCogIcon
		},
		{
			title: 'Settings',
			href: '/settings',
			icon: SettingsIcon
		}
	] as const;
</script>

<script lang="ts">
	import NavMain from './nav-main.svelte';
	import NavAgentSessions from './nav-agent-sessions.svelte';
	import NavUser from './nav-user.svelte';
	import WorkspaceSwitcher from './workspace-switcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import vectraspaceIconLight from '$lib/assets/logos/vectraspace-icon-light.png';
	import type { ComponentProps } from 'svelte';

	const sidebar = useSidebar();
	const brandCollapsed = $derived(!sidebar.isMobile && sidebar.state === 'collapsed');

	let {
		ref = $bindable(null),
		collapsible = 'icon',
		username = 'User',
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & { username?: string } = $props();
</script>

<Sidebar.Root bind:ref {collapsible} {...restProps}>
	<Sidebar.Header>
		<div
			class="flex h-12 items-center gap-2 px-2 text-sidebar-foreground group-data-[collapsible=icon]:justify-center"
			data-slot="sidebar-brand"
			aria-label={brandCollapsed ? 'Vectraspace' : undefined}
		>
			<img src={vectraspaceIconLight} alt="" class="size-8 rounded-md" aria-hidden="true" />
			<span class="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
				>Vectraspace</span
			>
		</div>
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
