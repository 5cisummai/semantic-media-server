<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import AgentStatusItem from '$lib/components/agent-status-item.svelte';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import ChatLlm from '$lib/components/chat-llm/index.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import {
		CHAT_AGENTS_SIDEBAR_COOKIE,
		SIDEBAR_COOKIE_MAX_AGE
	} from '$lib/components/ui/sidebar/constants.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
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

	const workspaceId = $derived(workspaceStore.activeId);

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
		const ws = workspaceStore.activeId;
		loadingAgents = true;
		try {
			if (!ws) {
				agents = [];
				return;
			}
			const response = await fetch(`/api/workspaces/${encodeURIComponent(ws)}/chats`);
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
		const ws = workspaceStore.activeId;
		if (!ws) {
			deleteError = 'No workspace selected';
			return;
		}
		deleteSubmitting = true;
		deleteError = null;
		try {
			const response = await fetch(
				`/api/workspaces/${encodeURIComponent(ws)}/chats/${encodeURIComponent(deleteTarget.id)}`,
				{
					method: 'DELETE'
				}
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

	// Keep ?agent= in the URL in sync with the active chat — silent replaceState, no reload.
	$effect(() => {
		if (!browser) return;
		const chatId = activeAgentId;
		const url = new URL(window.location.href);
		if (chatId) {
			url.searchParams.set('agent', chatId);
		} else {
			url.searchParams.delete('agent');
		}
		window.history.replaceState(null, '', url.pathname + url.search);
	});

	/** Skip first run (onMount loads initially); refetch when the active workspace changes. */
	let previousWorkspaceId = $state<string | null | undefined>(undefined);
	$effect(() => {
		const ws = workspaceStore.activeId;
		if (previousWorkspaceId === undefined) {
			previousWorkspaceId = ws;
			return;
		}
		if (ws === previousWorkspaceId) return;
		previousWorkspaceId = ws;
		if (!ws) {
			agents = [];
			activeAgentId = null;
			agentPanel?.resetConversation();
			return;
		}
		void fetchAgents();
	});

	/** Workspace can hydrate after first paint; `onMount` also misses SPA navigations to `?agent=` / `?q=`. */
	let urlChatSyncGen = 0;
	let lastSyncedUrlChatKey = $state<string | null>(null);
	$effect(() => {
		const ws = workspaceStore.activeId;
		const agentId = data.agentId;
		const initialMessage = data.initialMessage;
		void agentPanel;
		const key = `${ws ?? ''}\0${agentId}\0${initialMessage}`;

		if (!browser || !ws) return;
		if (lastSyncedUrlChatKey === key) return;

		const gen = ++urlChatSyncGen;
		void (async () => {
			await fetchAgents(agentId || undefined);
			await tick();
			for (let i = 0; i < 50 && !agentPanel; i += 1) {
				await tick();
			}
			if (gen !== urlChatSyncGen) return;
			const panel = agentPanel;
			if (!panel) return;

			if (initialMessage) {
				await panel.startWithMessage(initialMessage);
				if (gen !== urlChatSyncGen) return;
				const cleanUrl = new URL(window.location.href);
				cleanUrl.searchParams.delete('q');
				window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);
			} else if (agentId) {
				const agentExists = agents.some((agent) => agent.id === agentId);
				if (!agentExists) {
					const cleanUrl = new URL(window.location.href);
					cleanUrl.searchParams.delete('agent');
					window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);
					if (agents.length > 0) {
						await panel.loadConversationFromServer(agents[0].id);
					} else {
						panel.resetConversation();
					}
				} else {
					await panel.loadConversationFromServer(agentId);
				}
			} else if (agents.length > 0) {
				await panel.loadConversationFromServer(agents[0].id);
			}
			if (gen === urlChatSyncGen) {
				lastSyncedUrlChatKey = key;
			}
		})();
	});
</script>

{#snippet agentsPanel()}
	<Sidebar.Header class="border-sidebar-border bg-sidebar px-2 pt-2 pb-3">
		<div class="px-1 pb-2">
			<span class="section-label">Chats</span>
		</div>
		<Button
			variant="outline"
			size="sm"
			class="w-full justify-start gap-2 border-sidebar-border/90 bg-sidebar-accent/10 text-sidebar-foreground hover:bg-sidebar-accent/35"
			onclick={startNewAgent}
		>
			<PlusIcon class="size-3.5" />
			New agent
		</Button>
	</Sidebar.Header>
	<Sidebar.Content class="min-h-0 flex-1 overflow-y-auto bg-sidebar p-2 [scrollbar-gutter:stable]">
		{#if loadingAgents && agents.length === 0}
			<p class="px-2 py-1 text-xs text-sidebar-foreground/55">Loading chats…</p>
		{:else if agents.length === 0}
			<p class="px-2 py-1 text-xs text-sidebar-foreground/55">No saved chats yet.</p>
		{:else}
			<Sidebar.Menu class="space-y-1">
				{#each agents as agent (agent.id)}
					<Sidebar.MenuItem>
						<ContextMenu.Root>
							<ContextMenu.Trigger class="w-full">
								<AgentStatusItem
									chatId={agent.id}
									{workspaceId}
									name={agent.title}
									description="{agent.messageCount} message{agent.messageCount === 1
										? ''
										: 's'} · {relativeTimestamp(agent.updatedAt)}"
									sessionStatus={agent.id === activeAgentId ? activeAgentStatus : agent.status}
									variant={agent.id === activeAgentId ? 'outline' : 'default'}
									size="xs"
									class="w-full cursor-pointer [a]:hover:bg-sidebar-accent"
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
								<ContextMenu.Item variant="destructive" onclick={() => openDeleteChatDialog(agent)}>
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
	<div class="flex h-full min-h-0 w-full flex-1">
		{#if isNarrowViewport.current}
			{#if agentSidebarOpen}
				<Sheet.Root bind:open={agentSidebarOpen}>
					<Sheet.Content
						side="left"
						id="chat-sessions-panel"
						showCloseButton={false}
						class="flex h-full max-w-none flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-[min(18rem,calc(100vw-1rem))]"
					>
						{@render agentsPanel()}
					</Sheet.Content>
				</Sheet.Root>
			{/if}
		{:else}
			<div
				id="chat-sessions-panel"
				class="relative h-full min-h-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
				style:width={agentSidebarOpen ? '16rem' : '0'}
				aria-hidden={!agentSidebarOpen}
				inert={!agentSidebarOpen}
				class:pointer-events-none={!agentSidebarOpen}
			>
				<aside
					class="absolute inset-y-0 left-0 flex h-full min-h-0 w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
				>
					{@render agentsPanel()}
				</aside>
			</div>
		{/if}

		<div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
			<ChatLlm
				{workspaceId}
				bind:this={agentPanel}
				bind:activeChatId={activeAgentId}
				bind:activeAgentStatus
				onListRefresh={() => fetchAgents(activeAgentId ?? undefined)}
			>
				{#snippet toolbarLeading()}
					<Tooltip.Root delayDuration={400}>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
									aria-expanded={agentSidebarOpen}
									aria-controls={agentSidebarOpen ? 'chat-sessions-panel' : undefined}
									aria-label={agentSidebarOpen ? 'Hide chat list' : 'Show chat list'}
									{...props}
									onclick={() => setAgentSidebarOpen(!agentSidebarOpen)}
								>
									{#if agentSidebarOpen}
										<ChevronLeftIcon class="size-4 shrink-0" aria-hidden="true" />
									{:else}
										<ChevronRightIcon class="size-4 shrink-0" aria-hidden="true" />
									{/if}
									<span class="hidden md:inline">Chats</span>
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="bottom" sideOffset={6}>
							{agentSidebarOpen ? 'Hide chat list' : 'Show chat list'}
						</Tooltip.Content>
					</Tooltip.Root>
				{/snippet}
			</ChatLlm>
		</div>
	</div>

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
