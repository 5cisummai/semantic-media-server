<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Item from '$lib/components/ui/item/index.js';
	import { cn } from '$lib/utils.js';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import { apiFetch } from '$lib/api-fetch';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import type { ItemSize, ItemVariant } from '$lib/components/ui/item/item.svelte';

	type RunStatus = 'idle' | 'queued' | 'running' | 'working' | 'done' | 'failed' | 'awaiting_confirmation';

	interface RunData {
		id: string;
		status: string;
		kind: string;
		error?: string | null;
	}

	let {
		/** Poll a specific run by ID for detailed status. */
		runId,
		/** Use the SSE-backed agentSessions store for a chat's status (lightweight). */
		chatId,
		/** Display name for the agent. Defaults to run kind or "Agent". */
		name = 'Agent',
		/** Optional subtitle / description line. */
		description,
		/** If provided, the whole item becomes a link. */
		href,
		size = 'default',
		variant = 'default',
		class: className,
	}: {
		runId?: string;
		chatId?: string;
		name?: string;
		description?: string;
		href?: string;
		size?: ItemSize;
		variant?: ItemVariant;
		class?: string;
	} = $props();

	// -------------------------------------------------------------------------
	// Run-polling state (only used when runId is provided)
	// -------------------------------------------------------------------------
	let run = $state<RunData | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchRun() {
		if (!runId) return;
		try {
			const res = await apiFetch(`/api/brain/runs/${encodeURIComponent(runId)}`);
			if (res.ok) {
				run = await res.json();
			}
		} catch {
			// network error — keep last known state
		}
	}

	function startPolling() {
		if (pollTimer) return;
		void fetchRun();
		// Poll every 2 s while active; slow down to 10 s once terminal
		pollTimer = setInterval(() => {
			void fetchRun();
			if (run && (run.status === 'done' || run.status === 'failed')) {
				stopPolling();
			}
		}, 2_000);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	$effect(() => {
		if (runId) {
			startPolling();
		}
		return () => stopPolling();
	});

	onDestroy(() => stopPolling());

	// -------------------------------------------------------------------------
	// Resolved status — merges run-poll + SSE store
	// -------------------------------------------------------------------------
	const resolvedStatus = $derived((): RunStatus => {
		if (runId && run) {
			const s = run.status as RunStatus;
			return s;
		}
		if (chatId) {
			const s = agentSessions.getStatus(chatId);
			return s === 'working' ? 'working' : 'idle';
		}
		return 'idle';
	});

	const isActive = $derived(
		resolvedStatus() === 'working' ||
		resolvedStatus() === 'queued' ||
		resolvedStatus() === 'running'
	);
	const isDone = $derived(resolvedStatus() === 'done');
	const isFailed = $derived(resolvedStatus() === 'failed');
	const isAwaiting = $derived(resolvedStatus() === 'awaiting_confirmation');

	// Resolved display name — prefer explicit prop, fall back to run kind
	const displayName = $derived(name || run?.kind || 'Agent');

	// Resolved description — prefer explicit prop, then derive from status
	const displayDescription = $derived(description ?? statusLabel(resolvedStatus()));

	function statusLabel(status: RunStatus): string {
		switch (status) {
			case 'queued': return 'Queued…';
			case 'running':
			case 'working': return 'Running…';
			case 'done': return 'Completed';
			case 'failed': return 'Failed';
			case 'awaiting_confirmation': return 'Awaiting confirmation';
			default: return 'Idle';
		}
	}
</script>

<!--
	AgentStatusItem — displays a live status indicator for an agent run.

	Props:
	  runId?  — polls /api/brain/runs/:id for detailed status
	  chatId? — uses SSE-backed agentSessions store (lightweight)
	  name    — display label (defaults to run kind or "Agent")
	  href    — makes the item a link
-->
<Item.Root {size} {variant} class={className}>
	{#snippet child({ props })}
		{#if href}
			<a {...props} {href}>
				{@render content()}
			</a>
		{:else}
			<div {...props}>
				{@render content()}
			</div>
		{/if}
	{/snippet}
</Item.Root>

{#snippet content()}
	<Item.Media variant="icon">
		{#if isActive}
			<!-- Spinning loader ring -->
			<LoaderCircleIcon
				class="size-4 animate-spin text-amber-500"
				aria-label="Running"
			/>
		{:else if isDone}
			<CheckCircle2Icon
				class="size-4 text-green-500"
				aria-label="Done"
			/>
		{:else if isFailed}
			<XCircleIcon
				class="size-4 text-destructive"
				aria-label="Failed"
			/>
		{:else if isAwaiting}
			<AlertCircleIcon
				class="size-4 animate-pulse text-amber-400"
				aria-label="Awaiting confirmation"
			/>
		{:else}
			<CircleDotIcon
				class="size-4 text-muted-foreground/50"
				aria-label="Idle"
			/>
		{/if}
	</Item.Media>

	<Item.Header>
		<Item.Title>{displayName}</Item.Title>
		{#if displayDescription}
			<Item.Description class={cn(
				isFailed && 'text-destructive',
				isDone && 'text-green-600 dark:text-green-400',
				isAwaiting && 'text-amber-600 dark:text-amber-400',
			)}>
				{isFailed && run?.error ? run.error : displayDescription}
			</Item.Description>
		{/if}
	</Item.Header>
{/snippet}
