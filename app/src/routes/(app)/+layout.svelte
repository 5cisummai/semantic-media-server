<script lang="ts">
	import type { Snippet } from 'svelte';
	import AppTopbar from '$lib/components/app-topbar.svelte';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
	import { browser } from '$app/environment';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// Cookie-backed default for SSR/hydration; toggles update via bind:open + cookie.
	// svelte-ignore state_referenced_locally
	let sidebarOpen = $state(data.sidebarOpen);

	// Seed workspace store from server-loaded data
	$effect(() => {
		workspaceStore.hydrate(
			data.workspaces,
			data.activeWorkspaceId ?? data.workspaces[0]?.id ?? null
		);
	});

	$effect(() => {
		if (!browser) return;
		const id = workspaceStore.activeId ?? data.activeWorkspaceId ?? null;
		agentSessions.connect(id);
		return () => agentSessions.disconnect();
	});
</script>

<div class="h-screen w-full overflow-hidden bg-background text-foreground">
	<Sidebar.Provider class="h-full" bind:open={sidebarOpen}>
		<AppSidebar username={data.user?.username ?? 'User'} />

		<div class="flex h-full w-full flex-col">
			<AppTopbar>
				{#snippet left()}
					<div class="flex items-center gap-2">
						<Sidebar.Trigger class="-ms-1" />
						<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
					</div>
				{/snippet}
			</AppTopbar>
			<div class="min-h-0 min-w-0 flex-1 overflow-auto">
				{@render children()}
			</div>
		</div>
	</Sidebar.Provider>
</div>
