<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { page } from '$app/state';

	type AppNavHref = '/home' | '/browse' | '/chat' | '/workspace' | '/settings';

	let {
		items
	}: {
		items: {
			title: string;
			href?: AppNavHref;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			icon: any;
		}[];
	} = $props();
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>Platform</Sidebar.GroupLabel>
	<Sidebar.Menu>
		{#each items as item (item.title)}
			<Sidebar.MenuItem>
				<Sidebar.MenuButton
					tooltipContent={item.title}
					isActive={item.href !== undefined && page.url.pathname === resolve(item.href)}
				>
					{#snippet child({ props })}
						{#if item.href}
							<a href={resolve(item.href)} {...props}>
								<item.icon />
								<span>{item.title}</span>
							</a>
						{:else}
							<button type="button" {...props}>
								<item.icon />
								<span>{item.title}</span>
							</button>
						{/if}
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		{/each}
	</Sidebar.Menu>
</Sidebar.Group>
