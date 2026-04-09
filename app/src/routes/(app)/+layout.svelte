<script lang="ts">
	import AppTopbar from '$lib/components/app-topbar.svelte';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	let { children, data } = $props();

	// Cookie-backed default for SSR/hydration; toggles update via bind:open + cookie.
	// svelte-ignore state_referenced_locally
	let sidebarOpen = $state(data.sidebarOpen);
</script>

<div class="min-h-screen w-full bg-background text-foreground">
	<Sidebar.Provider class="min-h-[calc(100svh-4.25rem)]" bind:open={sidebarOpen}>
		<AppSidebar />

		<div class="relative flex min-h-[calc(100svh-4.25rem)] w-full flex-col">
			<AppTopbar>
				{#snippet left()}
					<div class="flex items-center gap-2">
						<Sidebar.Trigger class="-ms-1" />
						<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
					</div>
				{/snippet}
			</AppTopbar>
			<div class="h-full w-full min-w-0">
				{@render children()}
			</div>
		</div>
	</Sidebar.Provider>
</div>
