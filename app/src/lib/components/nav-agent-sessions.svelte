<script lang="ts">
	import { onMount } from 'svelte';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import AgentStatusItem from '$lib/components/agent-status-item.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	interface AgentSession {
		id: string;
		title: string;
		updatedAt: string;
	}

	let sessions = $state<AgentSession[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/api/chats');
			if (res.ok) {
				const payload = (await res.json()) as { chats?: AgentSession[] };
				sessions = Array.isArray(payload.chats) ? payload.chats.slice(0, 8) : [];
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
					<AgentStatusItem
						chatId={session.id}
						name={session.title || 'Agent session'}
						href={`/chat?agent=${encodeURIComponent(session.id)}`}
						size="xs"
					/>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.Group>
{/if}
