<script lang="ts">
	import { onMount } from 'svelte';
	import { dedupeChatsById } from '$lib/utils.js';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import AgentStatusItem from '$lib/components/agent-status-item.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';

	const sidebar = useSidebar();
	const compact = $derived(!sidebar.isMobile && sidebar.state === 'collapsed');

	interface AgentSession {
		id: string;
		title: string;
		updatedAt: string;
		status?: 'idle' | 'working' | 'done';
	}

	let sessions = $state<AgentSession[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/api/chats');
			if (res.ok) {
				const payload = (await res.json()) as { chats?: AgentSession[] };
				const list = dedupeChatsById(Array.isArray(payload.chats) ? payload.chats : []);
				sessions = list.slice(0, 8);
			}
		} catch {
			// silently fail — sidebar is non-critical
		}
	});

	// Sort: working sessions first, then by recency
	const sorted = $derived(
		[...sessions].sort((a, b) => {
			const aWorking = agentSessions.getStatus(a.id) === 'working' ? 0 : 1;
			const bWorking = agentSessions.getStatus(b.id) === 'working' ? 0 : 1;
			if (aWorking !== bWorking) return aWorking - bWorking;
			return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
		})
	);
</script>

{#if sorted.length > 0}
	<Sidebar.Group>
		<Sidebar.GroupLabel>Recent Sessions</Sidebar.GroupLabel>
		<Sidebar.Menu>
			{#each sorted as session (session.id)}
				<Sidebar.MenuItem>
					{#if compact}
						<Tooltip.Root delayDuration={300}>
							<Tooltip.Trigger class="w-full">
								<AgentStatusItem
									chatId={session.id}
									name={session.title || 'Agent session'}
									href={`/chat?agent=${encodeURIComponent(session.id)}`}
									sessionStatus={session.status}
									size="xs"
									compact
								/>
							</Tooltip.Trigger>
							<Tooltip.Content side="right" align="center" class="max-w-xs">
								<p class="font-medium">{session.title || 'Agent session'}</p>
							</Tooltip.Content>
						</Tooltip.Root>
					{:else}
						<AgentStatusItem
							chatId={session.id}
							name={session.title || 'Agent session'}
							href={`/chat?agent=${encodeURIComponent(session.id)}`}
							sessionStatus={session.status}
							size="xs"
						/>
					{/if}
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.Group>
{/if}
