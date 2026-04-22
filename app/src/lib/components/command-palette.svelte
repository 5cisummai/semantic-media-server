<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import HomeIcon from '@lucide/svelte/icons/home';
	import FilesIcon from '@lucide/svelte/icons/files';
	import BotIcon from '@lucide/svelte/icons/bot';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import FolderCogIcon from '@lucide/svelte/icons/folder-cog';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { toggleMode } from 'mode-watcher';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	let open = $state(false);

	function toggle() {
		open = !open;
	}

	onMount(() => {
		if (!browser) return;
		function handleKeydown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				toggle();
			}
		}
		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	async function navigate(href: string) {
		open = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(href);
	}

	const navItems = [
		{ label: 'Home', icon: HomeIcon, href: '/home' },
		{ label: 'Browse files', icon: FilesIcon, href: '/browse' },
		{ label: 'New agent session', icon: PlusIcon, href: '/chat' },
		{ label: 'Workspace settings', icon: FolderCogIcon, href: '/workspace' },
		{ label: 'Settings', icon: SettingsIcon, href: '/settings' }
	] as const;
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-background/60 backdrop-blur-sm" />
		<Dialog.Content
			class="overflow-hidden rounded-xl border border-border/80 bg-popover p-0 shadow-2xl sm:max-w-lg"
			showCloseButton={false}
		>
			<Command.Root
				class="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-primary/60 [&_[cmdk-group-heading]]:uppercase"
			>
				<Command.Input placeholder="Type a command or search…" class="h-12 border-0 text-sm" />
				<Command.List class="max-h-72">
					<Command.Empty class="py-6 text-center text-sm text-muted-foreground">
						No results found.
					</Command.Empty>

					<Command.Group heading="Navigate">
						{#each navItems as item (item.href)}
							{@const Icon = item.icon}
							<Command.Item
								value={item.label}
								onSelect={() => navigate(resolve(item.href))}
								class="gap-3"
							>
								<Icon class="size-4 text-muted-foreground" />
								<span>{item.label}</span>
							</Command.Item>
						{/each}
					</Command.Group>

					<Command.Separator />

					<Command.Group heading="Theme">
						<Command.Item
							value="Toggle light dark theme"
							onSelect={() => {
								open = false;
								toggleMode();
							}}
							class="gap-3"
						>
							<SunIcon class="size-4 text-muted-foreground dark:hidden" />
							<MoonIcon class="hidden size-4 text-muted-foreground dark:block" />
							<span>Toggle theme</span>
						</Command.Item>
					</Command.Group>
				</Command.List>

				<div class="border-t border-border/60 px-3 py-2">
					<p class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground/40">
						↑↓ navigate · ↵ select · esc close
					</p>
				</div>
			</Command.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
