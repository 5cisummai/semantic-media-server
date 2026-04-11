<script lang="ts">
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import AgentStatusItem from '$lib/components/agent-status-item.svelte';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import { onMount, tick } from 'svelte';
	import ChatLlm from '$lib/components/chat-llm/index.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import {
		CHAT_AGENTS_SIDEBAR_COOKIE,
		SIDEBAR_COOKIE_MAX_AGE,
	} from '$lib/components/ui/sidebar/constants.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import { dedupeChatsById } from '$lib/utils.js';
	import type { PageData } from './$types';

	/** Matches Tailwind `md:` — agents list uses inline sidebar on desktop, sheet on small screens. */
	const isNarrowViewport = new IsMobile();

	interface AgentSummary {
		id: string;
		title: string;
		createdAt: string;
		updatedAt: string;
		messageCount: number;
		status: 'idle' | 'working' | 'done';
	}

	let { data }: { data: PageData } = $props();

	let agents = $state<AgentSummary[]>([]);
	let activeAgentId = $state<string | null>(null);
	let activeAgentStatus = $state<'idle' | 'working' | 'done'>('idle');
	let loadingAgents = $state(false);
	// Cookie-backed default for SSR/hydration; see setAgentSidebarOpen.
	// svelte-ignore state_referenced_locally
	let agentSidebarOpen = $state(data.agentsSidebarOpen);

	function setAgentSidebarOpen(value: boolean) {
		agentSidebarOpen = value;
		document.cookie = `${CHAT_AGENTS_SIDEBAR_COOKIE}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
	}
	let error = $state<string | null>(null);
	let agentPanel = $state<ChatLlm | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<AgentSummary | null>(null);
	let deleteSubmitting = $state(false);
	let deleteError = $state<string | null>(null);

	async function fetchAgents(preferredAgentId?: string): Promise<void> {
		loadingAgents = true;
		try {
			const response = await fetch('/api/chats');
			if (!response.ok) {
				throw new Error(`Failed to load agents (${response.status})`);
			}
			const payload = (await response.json()) as { chats?: AgentSummary[] };
			agents = dedupeChatsById(Array.isArray(payload.chats) ? payload.chats : []);
			if (preferredAgentId) {
				activeAgentId = preferredAgentId;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load agents';
		} finally {
			loadingAgents = false;
		}
	}

	function startNewAgent() {
		agentPanel?.resetConversation();
	}

	async function selectAgent(agentId: string) {
		await agentPanel?.loadConversationFromServer(agentId);
		if (isNarrowViewport.current) {
			setAgentSidebarOpen(false);
		}
	}

	function openDeleteChatDialog(agent: AgentSummary) {
		deleteTarget = agent;
		deleteError = null;
		deleteDialogOpen = true;
	}

	function closeDeleteDialog() {
		deleteDialogOpen = false;
		deleteTarget = null;
		deleteError = null;
	}

	async function confirmDeleteChat() {
		if (!deleteTarget) return;
		deleteSubmitting = true;
		deleteError = null;
		try {
			const response = await fetch(
				`/api/chats/${encodeURIComponent(deleteTarget.id)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				throw new Error(`Failed to delete chat (${response.status})`);
			}
			const wasActive = activeAgentId === deleteTarget.id;
			await fetchAgents();
			closeDeleteDialog();
			if (wasActive) {
				if (agents.length > 0) {
					await selectAgent(agents[0].id);
				} else {
					activeAgentId = null;
					agentPanel?.resetConversation();
				}
			}
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete chat';
		} finally {
			deleteSubmitting = false;
		}
	}

	function relativeTimestamp(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const diff = Date.now() - date.getTime();
		const minute = 60_000;
		const hour = 60 * minute;
		const day = 24 * hour;
		if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
		if (diff < day) return `${Math.floor(diff / hour)}h ago`;
		return `${Math.floor(diff / day)}d ago`;
	}

	onMount(() => {
		void (async () => {
			await fetchAgents();
			await tick();
			if (data.initialMessage) {
				await agentPanel?.startWithMessage(data.initialMessage);
			} else if (data.agentId) {
				await agentPanel?.loadConversationFromServer(data.agentId);
			} else if (agents.length > 0) {
				await agentPanel?.loadConversationFromServer(agents[0].id);
			}
		})();
	});

</script>

{#snippet agentsPanel()}
	<Sidebar.Header class="border-b border-sidebar-border/60">
				<div class="flex items-center justify-between px-1 py-1">
					<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Agents</h2>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="h-7 w-7"
						aria-label="Close agents sidebar"
						onclick={() => setAgentSidebarOpen(false)}
					>
						<PanelLeftCloseIcon class="size-4" />
					</Button>
				</div>
				<div class="pb-2">
					<Button
						variant="outline"
						size="sm"
						class="w-full justify-start gap-2"
						onclick={startNewAgent}
					>
						<PlusIcon class="size-3.5" />
						New agent
					</Button>
				</div>
			</Sidebar.Header>
			<Sidebar.Content class="[scrollbar-gutter:stable] flex-1 min-h-0 overflow-y-auto p-2">
				{#if loadingAgents && agents.length === 0}
					<p class="px-2 py-1 text-xs text-muted-foreground">Loading agents…</p>
				{:else if agents.length === 0}
					<p class="px-2 py-1 text-xs text-muted-foreground">No saved agents yet.</p>
				{:else}
					<Sidebar.Menu class="space-y-1">
						{#each agents as agent (agent.id)}
							<Sidebar.MenuItem>
								<ContextMenu.Root>
									<ContextMenu.Trigger class="w-full">
										<AgentStatusItem
											chatId={agent.id}
											name={agent.title}
											description="{agent.messageCount} message{agent.messageCount === 1
												? ''
												: 's'} · {relativeTimestamp(agent.updatedAt)}"
											sessionStatus={agent.id === activeAgentId
												? activeAgentStatus
												: agent.status}
											variant={agent.id === activeAgentId ? 'outline' : 'default'}
											size="xs"
											class="w-full cursor-pointer"
											onclick={() => {
												void selectAgent(agent.id);
											}}
										/>
									</ContextMenu.Trigger>
									<ContextMenu.Content class="w-48">
										<ContextMenu.Item onclick={() => selectAgent(agent.id)}>
											<FolderOpenIcon />
											Open
										</ContextMenu.Item>
										<ContextMenu.Separator />
										<ContextMenu.Item
											variant="destructive"
											onclick={() => openDeleteChatDialog(agent)}
										>
											<Trash2Icon />
											Delete chat
										</ContextMenu.Item>
									</ContextMenu.Content>
								</ContextMenu.Root>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				{/if}
			</Sidebar.Content>
{/snippet}

<div class="flex h-full min-h-0 w-full flex-col bg-background">
	<Sidebar.Provider class="flex h-full min-h-0 w-full flex-1">
		{#if agentSidebarOpen}
			{#if isNarrowViewport.current}
				<Sheet.Root bind:open={agentSidebarOpen}>
					<Sheet.Content
						side="left"
						showCloseButton={false}
						class="h-full max-w-none gap-0 border-r border-border/60 bg-muted/20 p-0 data-[side=left]:w-[min(22rem,calc(100vw-1rem))]"
					>
						<div class="flex h-full min-h-0 flex-col">
							{@render agentsPanel()}
						</div>
					</Sheet.Content>
				</Sheet.Root>
			{:else}
				<Sidebar.Root
					class="flex h-full min-h-0 w-72 shrink-0 border-r border-border/60 bg-muted/20"
					collapsible="none"
				>
					{@render agentsPanel()}
				</Sidebar.Root>
			{/if}
		{/if}

		<div class="relative flex h-full min-h-0 flex-1">
			<ChatLlm
				bind:this={agentPanel}
				bind:activeChatId={activeAgentId}
				bind:activeAgentStatus
				onListRefresh={() => fetchAgents(activeAgentId ?? undefined)}
			/>
			{#if !agentSidebarOpen}
				<div class="absolute top-3 left-3 z-50">
					<Tooltip.Root delayDuration={400}>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									class="h-8 w-8 border-border/60 bg-background/90 shadow-sm backdrop-blur"
									aria-label="Open agents sidebar"
									{...props}
									onclick={() => setAgentSidebarOpen(true)}
								>
									<PanelLeftOpenIcon class="size-4" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="bottom" sideOffset={6}>
							Open agents list
						</Tooltip.Content>
					</Tooltip.Root>
				</div>
			{/if}
		</div>
	</Sidebar.Provider>

	<Dialog.Root
		bind:open={deleteDialogOpen}
		onOpenChange={(open) => {
			if (!open) closeDeleteDialog();
		}}
	>
		<Dialog.Content showCloseButton={!deleteSubmitting}>
			<Dialog.Header>
				<Dialog.Title>Delete chat</Dialog.Title>
				<Dialog.Description>
					Delete “{deleteTarget?.title ?? 'this chat'}”? This cannot be undone.
				</Dialog.Description>
			</Dialog.Header>
			{#if deleteError}
				<p class="text-sm text-destructive">{deleteError}</p>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" disabled={deleteSubmitting} onclick={closeDeleteDialog}>
					Cancel
				</Button>
				<Button variant="destructive" disabled={deleteSubmitting} onclick={confirmDeleteChat}>
					{deleteSubmitting ? 'Deleting…' : 'Delete'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	{#if error}
		<div
			class="border-t border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300"
		>
			{error}
		</div>
	{/if}
</div>

