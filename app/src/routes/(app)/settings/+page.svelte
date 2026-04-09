<script lang="ts">
	import { browser } from '$app/environment';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Progress from '$lib/components/ui/progress/index.js';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import UsersIcon from '@lucide/svelte/icons/users';
	import InfoIcon from '@lucide/svelte/icons/info';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import FolderInputIcon from '@lucide/svelte/icons/folder-input';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import {
		AUTO_APPROVE_SETTINGS,
		isAutoApproveSettingEnabled,
		setAutoApproveSettingEnabled,
		type AutoApproveSettingId
	} from '$lib/agent-auto-approve';

	interface DriveInfo {
		index: number;
		path: string;
		name: string;
		available: boolean;
		totalBytes?: number;
		usedBytes?: number;
		freeBytes?: number;
		usedPercent?: number;
	}

	interface User {
		id: string;
		username: string;
		displayName: string;
		role: string;
		approved: boolean;
		createdAt: string;
	}

	function formatBytes(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let unitIndex = 0;
		let size = bytes;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}
		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}

	let drives = $state<DriveInfo[]>([]);
	let users = $state<User[]>([]);
	let pendingUsers = $state<User[]>([]);
	let isAdmin = $state(false);
	let loading = $state(true);
	let reindexing = $state(false);
	let reindexStatus = $state<'idle' | 'success' | 'error'>('idle');

	let ingestingRoot = $state<number | null>(null);
	let ingestStatus = $state<'idle' | 'success' | 'error'>('idle');
	let ingestMessage = $state<string | null>(null);

	let settingsTab = $state('storage');

	let agentAutoApprove = $state<Record<AutoApproveSettingId, boolean>>({
		delete_file: false,
		move: false,
		copy_file: false,
		mkdir: false
	});

	function syncAgentAutoApproveFromStorage() {
		agentAutoApprove = {
			delete_file: isAutoApproveSettingEnabled('delete_file'),
			move: isAutoApproveSettingEnabled('move'),
			copy_file: isAutoApproveSettingEnabled('copy_file'),
			mkdir: isAutoApproveSettingEnabled('mkdir')
		};
	}

	async function loadData() {
		if (!browser) return;
		const token = localStorage.getItem('accessToken');
		const role = localStorage.getItem('role');
		isAdmin = role === 'ADMIN';

		try {
			const [drivesRes, usersRes] = await Promise.all([
				fetch('/api/storage'),
				fetch('/api/auth/users')
			]);

			if (drivesRes.ok) {
				drives = await drivesRes.json();
			}
			if (usersRes.ok) {
				users = await usersRes.json();
			}
			if (isAdmin) {
				const pendingRes = await fetch('/api/auth/pending');
				if (pendingRes.ok) {
					pendingUsers = await pendingRes.json();
				}
			}
		} catch (e) {
			console.error('Failed to load settings data', e);
		} finally {
			loading = false;
		}
	}

	async function approveUser(userId: string) {
		try {
			const res = await fetch('/api/auth/approve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) {
				pendingUsers = pendingUsers.filter((u) => u.id !== userId);
			}
		} catch (e) {
			console.error('Failed to approve user', e);
		}
	}

	async function rejectUser(userId: string) {
		try {
			const res = await fetch('/api/auth/approve', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) {
				pendingUsers = pendingUsers.filter((u) => u.id !== userId);
			}
		} catch (e) {
			console.error('Failed to reject user', e);
		}
	}

	async function reindex() {
		reindexing = true;
		reindexStatus = 'idle';
		try {
			const res = await fetch('/api/search/reindex', { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				reindexStatus = 'success';
				console.log('Reindex completed:', data);
			} else {
				reindexStatus = 'error';
			}
		} catch (e) {
			console.error('Failed to reindex', e);
			reindexStatus = 'error';
		} finally {
			reindexing = false;
		}
	}

	async function ingestDirectory(rootIndex: number) {
		ingestingRoot = rootIndex;
		ingestStatus = 'idle';
		ingestMessage = null;
		try {
			const res = await fetch('/api/ingest/directory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rootIndex })
			});
			const data = (await res.json().catch(() => null)) as {
				summary?: {
					filesIndexed?: number;
					chunksIndexed?: number;
					filesSkipped?: number;
					filesScanned?: number;
				};
				message?: string;
			} | null;
			if (res.ok && data?.summary) {
				ingestStatus = 'success';
				const s = data.summary;
				ingestMessage = `Indexed ${s.filesIndexed ?? 0} files (${s.chunksIndexed ?? 0} chunks, ${s.filesSkipped ?? 0} skipped, ${s.filesScanned ?? 0} scanned).`;
			} else {
				ingestStatus = 'error';
				ingestMessage =
					data?.message ??
					(res.status === 403 ? 'Forbidden (admin only)' : 'Ingest failed');
			}
		} catch (e) {
			console.error('Failed to ingest', e);
			ingestStatus = 'error';
			ingestMessage = 'Network error';
		} finally {
			ingestingRoot = null;
		}
	}

	if (browser) {
		syncAgentAutoApproveFromStorage();
		loadData();
	}

	$effect(() => {
		if (!browser) return;
		if (settingsTab === 'assistant') {
			syncAgentAutoApproveFromStorage();
		}
	});
</script>

<div class="min-h-full bg-background text-foreground p-4 sm:p-6">
	<main class="mx-auto flex w-full max-w-360 flex-col gap-8">
		<section class="flex flex-col gap-2">
			<p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Settings</p>
			<h1 class="text-2xl font-semibold">Settings</h1>
			<p class="max-w-2xl text-sm text-muted-foreground">
				Manage your account settings and preferences.
			</p>
		</section>

		<Tabs.Root bind:value={settingsTab}>
			<Tabs.List class="grid w-full max-w-2xl grid-cols-2 gap-1 sm:grid-cols-4">
				<Tabs.Trigger value="storage" class="gap-2">
					<FolderIcon class="size-4" />
					Storage
				</Tabs.Trigger>
				<Tabs.Trigger value="assistant" class="gap-2">
					<SparklesIcon class="size-4" />
					Assistant
				</Tabs.Trigger>
				<Tabs.Trigger value="users" class="gap-2">
					<UsersIcon class="size-4" />
					Users
				</Tabs.Trigger>
				<Tabs.Trigger value="info" class="gap-2">
					<InfoIcon class="size-4" />
					Info
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="storage" class="space-y-4">
				{#if loading}
					<p class="text-sm text-muted-foreground">Loading storage info...</p>
				{:else if drives.length === 0}
					<p class="text-sm text-muted-foreground">No storage drives configured.</p>
				{:else}
					<div class="space-y-4">
						{#each drives as drive}
							<div class="rounded-md border border-border p-4">
								<div class="flex items-center justify-between mb-2">
									<div class="flex items-center gap-2">
										<HardDriveIcon class="size-5 text-muted-foreground" />
										<span class="font-medium">{drive.name}</span>
									</div>
									{#if !drive.available}
										<span class="flex items-center gap-1 text-sm text-destructive">
											<AlertCircleIcon class="size-4" />
											Unavailable
										</span>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground mb-3 font-mono">{drive.path}</p>
								{#if drive.available && drive.totalBytes}
									<Progress.Root value={drive.usedPercent ?? 0} max={100} class="mb-2" />
									<div class="flex justify-between text-xs text-muted-foreground">
										<span>{formatBytes(drive.usedBytes ?? 0)} used</span>
										<span>{formatBytes(drive.freeBytes ?? 0)} free</span>
									</div>
								{:else if !drive.available}
									<p class="text-sm text-muted-foreground">Drive is not accessible.</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<div class="rounded-md border border-border bg-muted/50 p-4">
					<h3 class="text-sm font-medium mb-2">Adding More Drives</h3>
					<p class="text-sm text-muted-foreground">
						To add more storage drives, edit the <code class="text-xs bg-muted px-1 rounded">.env</code> file and add paths separated by commas to the <code class="text-xs bg-muted px-1 rounded">MEDIA_ROOTS</code> variable:
					</p>
					<code class="block mt-2 text-xs bg-muted p-2 rounded">MEDIA_ROOTS=/path/to/drive1,/path/to/drive2</code>
				</div>

				<div class="rounded-md border border-border p-4">
					<h3 class="text-sm font-medium mb-2">Search &amp; AI chat indexing</h3>
					<p class="text-sm text-muted-foreground mb-3">
						<strong class="font-medium text-foreground">Reindex</strong> refreshes the filename and metadata
						vector index for search.
						<strong class="font-medium text-foreground">Ingest</strong> reads text and PDFs and stores
						chunks for the chat assistant (separate from reindex).
					</p>
					{#if isAdmin}
						<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
							<button
								type="button"
								class="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								onclick={reindex}
								disabled={reindexing || ingestingRoot !== null}
							>
								<RefreshCwIcon class="size-4 {reindexing ? 'animate-spin' : ''}" />
								{reindexing ? 'Reindexing...' : 'Reindex search'}
							</button>
						</div>
						{#if reindexStatus === 'success'}
							<p class="mt-2 text-sm text-green-600">Reindex completed successfully.</p>
						{:else if reindexStatus === 'error'}
							<p class="mt-2 text-sm text-destructive">Reindex failed. Try again or check server logs.</p>
						{/if}

						<div class="mt-4 border-t border-border pt-4">
							<p class="text-sm font-medium mb-2">Ingest file contents</p>
							<p class="text-sm text-muted-foreground mb-3">
								Full pass on one drive; large libraries can take a while.
							</p>
							<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
								{#each drives as drive}
									{#if drive.available}
										<button
											type="button"
											class="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
											onclick={() => ingestDirectory(drive.index)}
											disabled={reindexing || ingestingRoot !== null}
										>
											<FolderInputIcon
												class="size-4 {ingestingRoot === drive.index ? 'animate-pulse' : ''}"
											/>
											{ingestingRoot === drive.index ? 'Ingesting…' : `Ingest ${drive.name}`}
										</button>
									{/if}
								{/each}
							</div>
							{#if ingestStatus === 'success' && ingestMessage}
								<p class="mt-2 text-sm text-green-600">{ingestMessage}</p>
							{:else if ingestStatus === 'error' && ingestMessage}
								<p class="mt-2 text-sm text-destructive">{ingestMessage}</p>
							{/if}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">
							Only administrators can reindex or ingest content for search and chat.
						</p>
					{/if}
				</div>
			</Tabs.Content>

			<Tabs.Content value="assistant" class="space-y-4">
				<div class="rounded-md border border-border p-4">
					<h3 class="text-sm font-medium mb-1">AI assistant — file actions</h3>
					<p class="text-sm text-muted-foreground mb-4">
						When the chat assistant wants to change files (delete, move, copy, or create folders), it
						normally asks for confirmation. You can auto-approve specific action types so they run
						without a prompt. Preferences are stored in this browser only.
					</p>
					<ul class="flex flex-col gap-3">
						{#each AUTO_APPROVE_SETTINGS as opt (opt.id)}
							<li>
								<label
									class="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring"
								>
									<input
										type="checkbox"
										class="mt-0.5 size-4 shrink-0 rounded border border-input accent-primary"
										checked={agentAutoApprove[opt.id]}
										onchange={(e) => {
											const on = e.currentTarget.checked;
											setAutoApproveSettingEnabled(opt.id, on);
											agentAutoApprove = { ...agentAutoApprove, [opt.id]: on };
										}}
									/>
									<span class="min-w-0">
										<span class="block text-sm font-medium text-foreground">{opt.label}</span>
										<span class="block text-xs text-muted-foreground">{opt.description}</span>
									</span>
								</label>
							</li>
						{/each}
					</ul>
				</div>
			</Tabs.Content>

			<Tabs.Content value="users" class="space-y-4">
				{#if loading}
					<p class="text-sm text-muted-foreground">Loading users...</p>
				{:else}
					<div class="rounded-md border border-border">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-border bg-muted/50">
									<th class="text-left p-3 font-medium">Username</th>
									<th class="text-left p-3 font-medium">Display Name</th>
									<th class="text-left p-3 font-medium">Role</th>
									<th class="text-left p-3 font-medium">Status</th>
								</tr>
							</thead>
							<tbody>
								{#each users as user}
									<tr class="border-b border-border last:border-0">
										<td class="p-3">{user.username}</td>
										<td class="p-3">{user.displayName}</td>
										<td class="p-3">
											<span
												class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {user.role === 'ADMIN'
													? 'bg-primary/10 text-primary'
													: 'bg-muted text-muted-foreground'}"
											>
												{user.role}
											</span>
										</td>
										<td class="p-3">
											<span
												class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {user.approved
													? 'bg-green-500/10 text-green-600'
													: 'bg-yellow-500/10 text-yellow-600'}"
											>
												{user.approved ? 'Active' : 'Pending'}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					{#if isAdmin && pendingUsers.length > 0}
						<div class="space-y-3">
							<h3 class="text-sm font-medium">Pending Users</h3>
							{#each pendingUsers as pending}
								<div class="flex items-center justify-between rounded-md border border-border p-4">
									<div>
										<p class="font-medium">{pending.displayName}</p>
										<p class="text-sm text-muted-foreground">@{pending.username}</p>
									</div>
									<div class="flex gap-2">
										<button
											type="button"
											class="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-green-500/20"
											onclick={() => approveUser(pending.id)}
										>
											<CheckIcon class="size-4" />
											Accept
										</button>
										<button
											type="button"
											class="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20"
											onclick={() => rejectUser(pending.id)}
										>
											<XIcon class="size-4" />
											Reject
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</Tabs.Content>

			<Tabs.Content value="info" class="space-y-4">
				<div class="rounded-md border border-border p-4">
					<h3 class="text-sm font-medium mb-2">Version</h3>
					<p class="text-sm text-muted-foreground">Vectraspace Media Server v0.1.0</p>
				</div>

				<div class="rounded-md border border-border p-4">
					<h3 class="text-sm font-medium mb-2">Legal</h3>
					<p class="text-sm text-muted-foreground">
						This software is provided as-is for personal use. Use at your own risk.
						Ensure you have proper backups of your media files.
					</p>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</main>
</div>