<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Progress from '$lib/components/ui/progress/index.js';
	import { apiFetch } from '$lib/api-fetch';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import PageShell from '$lib/components/page-shell.svelte';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import UsersIcon from '@lucide/svelte/icons/users';
	import InfoIcon from '@lucide/svelte/icons/info';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import FolderInputIcon from '@lucide/svelte/icons/folder-input';
	import WorkspaceSemanticReindex from '$lib/components/workspace-semantic-reindex.svelte';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import {
		AUTO_APPROVE_SETTINGS,
		isAutoApproveSettingEnabled,
		setAutoApproveSettingEnabled,
		type AutoApproveSettingId
	} from '$lib/agent-auto-approve';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	const drives = $derived(data.drives);
	const users = $derived(data.users);
	const pendingUsers = $derived(data.pendingUsers);
	const isAdmin = $derived(data.isAdmin);
	const currentUserId = $derived(data.currentUserId);
	const adminAccountCount = $derived(users.filter((u) => u.role === 'ADMIN').length);

	let deactivateTargetId = $state<string | null>(null);
	let deactivateDialogOpen = $state(false);
	const deactivateTarget = $derived(
		deactivateTargetId ? users.find((u) => u.id === deactivateTargetId) : undefined
	);

	function openDeactivateDialog(userId: string) {
		deactivateTargetId = userId;
		deactivateDialogOpen = true;
	}
	let semanticReindexBusy = $state(false);

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

	async function approveUser(userId: string) {
		try {
			const res = await apiFetch('/api/auth/approve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) {
				await invalidateAll();
			}
		} catch (e) {
			console.error('Failed to approve user', e);
		}
	}

	async function rejectUser(userId: string) {
		try {
			const res = await apiFetch('/api/auth/approve', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) {
				await invalidateAll();
			}
		} catch (e) {
			console.error('Failed to reject user', e);
		}
	}

	async function updateAppRole(userId: string, role: 'ADMIN' | 'USER') {
		try {
			const res = await apiFetch(`/api/auth/users/${userId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role })
			});
			if (res.ok) {
				toast.success('Server role updated');
				await invalidateAll();
			} else {
				const err = (await res.json().catch(() => null)) as { error?: string } | null;
				toast.error(err?.error ?? 'Could not update role');
			}
		} catch (e) {
			console.error('Failed to update user role', e);
			toast.error('Could not update role');
		}
	}

	async function deactivateAccount() {
		if (!deactivateTargetId) return;
		const id = deactivateTargetId;
		try {
			const res = await apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' });
			deactivateDialogOpen = false;
			deactivateTargetId = null;
			if (res.ok) {
				toast.success('Account deactivated');
				await invalidateAll();
			} else {
				const err = (await res.json().catch(() => null)) as { error?: string } | null;
				toast.error(err?.error ?? 'Could not deactivate account');
			}
		} catch (e) {
			console.error('Failed to deactivate user', e);
			toast.error('Could not deactivate account');
		}
	}

	function canDemoteServerAdmin(user: { id: string; role: string }): boolean {
		if (user.role !== 'ADMIN') return true;
		return adminAccountCount > 1;
	}

	function canDeactivate(user: { id: string; role: string }): boolean {
		if (user.id === currentUserId) return false;
		if (user.role === 'ADMIN' && adminAccountCount <= 1) return false;
		return true;
	}

	async function ingestDirectory(rootIndex: number) {
		ingestingRoot = rootIndex;
		ingestStatus = 'idle';
		ingestMessage = null;
		try {
			const res = await apiFetch('/api/ingest/directory', {
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
					data?.message ?? (res.status === 403 ? 'Forbidden (admin only)' : 'Ingest failed');
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
	}

	$effect(() => {
		if (!browser) return;
		if (settingsTab === 'assistant') {
			syncAgentAutoApproveFromStorage();
		}
	});
</script>

<PageShell
	eyebrow="Configuration"
	title="Settings"
	description="Manage your account settings and preferences."
>
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
			{#if drives.length === 0}
				<p class="text-sm text-muted-foreground">No storage drives configured.</p>
			{:else}
				<div class="space-y-4">
					{#each drives as drive}
						<Card.Root class="card-glass"
							><Card.Content class="p-4">
								<div class="mb-2 flex items-center justify-between">
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
								<p class="mb-3 font-mono text-xs text-muted-foreground">{drive.path}</p>
								{#if drive.available && drive.totalBytes}
									<Progress.Root value={drive.usedPercent ?? 0} max={100} class="mb-2" />
									<div class="flex justify-between text-xs text-muted-foreground">
										<span>{formatBytes(drive.usedBytes ?? 0)} used</span>
										<span>{formatBytes(drive.freeBytes ?? 0)} free</span>
									</div>
								{:else if !drive.available}
									<p class="text-sm text-muted-foreground">Drive is not accessible.</p>
								{/if}
							</Card.Content></Card.Root
						>
					{/each}
				</div>
			{/if}

			<Card.Root class="card-glass bg-muted/30"
				><Card.Content class="p-4">
					<h3 class="mb-2 text-sm font-medium">Adding More Drives</h3>
					<p class="text-sm text-muted-foreground">
						To add more storage drives, edit the <code class="rounded bg-muted px-1 text-xs"
							>.env</code
						>
						file and add paths separated by commas to the
						<code class="rounded bg-muted px-1 text-xs">MEDIA_ROOTS</code> variable:
					</p>
					<code class="mt-2 block rounded bg-muted p-2 text-xs"
						>MEDIA_ROOTS=/path/to/drive1,/path/to/drive2</code
					>
				</Card.Content></Card.Root
			>

			<Card.Root class="card-glass"
				><Card.Content class="p-4">
					<h3 class="mb-2 text-sm font-medium">Search &amp; AI chat indexing</h3>
					<p class="mb-3 text-sm text-muted-foreground">
						<strong class="font-medium text-foreground">Semantic index</strong> powers Smart Search
						and the assistant’s file search for the
						<strong class="font-medium text-foreground">workspace selected in the header</strong>.
						Rebuilding it rescans files into that workspace’s vector index.
						<strong class="font-medium text-foreground">Ingest</strong> reads text and PDFs and stores
						chunks for chat context (separate from semantic search).
					</p>
					{#if isAdmin}
						<WorkspaceSemanticReindex
							{isAdmin}
							density="comfortable"
							onBusyChange={(busy) => {
								semanticReindexBusy = busy;
							}}
						/>

						<div class="mt-4 border-t border-border pt-4">
							<p class="mb-2 text-sm font-medium">Ingest file contents</p>
							<p class="mb-3 text-sm text-muted-foreground">
								Full pass on one drive; large libraries can take a while.
							</p>
							<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
								{#each drives as drive}
									{#if drive.available}
										<Button
											variant="outline"
											onclick={() => ingestDirectory(drive.index)}
											disabled={semanticReindexBusy || ingestingRoot !== null}
										>
											<FolderInputIcon
												class="size-4 {ingestingRoot === drive.index ? 'animate-pulse' : ''}"
											/>
											{ingestingRoot === drive.index ? 'Ingesting…' : `Ingest ${drive.name}`}
										</Button>
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
				</Card.Content></Card.Root
			>
		</Tabs.Content>

		<Tabs.Content value="assistant" class="space-y-4">
			<Card.Root class="card-glass"
				><Card.Content class="p-4">
					<h3 class="mb-1 text-sm font-medium">AI assistant — file actions</h3>
					<p class="mb-4 text-sm text-muted-foreground">
						When the chat assistant wants to change files (delete, move, copy, or create folders),
						it normally asks for confirmation. You can auto-approve specific action types so they
						run without a prompt. Preferences are stored in this browser only.
					</p>
					<ul class="flex flex-col gap-3">
						{#each AUTO_APPROVE_SETTINGS as opt (opt.id)}
							<li>
								<label
									class="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring"
								>
									<Checkbox
										checked={agentAutoApprove[opt.id]}
										onCheckedChange={(checked) => {
											const on = !!checked;
											setAutoApproveSettingEnabled(opt.id, on);
											agentAutoApprove = { ...agentAutoApprove, [opt.id]: on };
										}}
										class="mt-0.5"
									/>
									<span class="min-w-0">
										<span class="block text-sm font-medium text-foreground">{opt.label}</span>
										<span class="block text-xs text-muted-foreground">{opt.description}</span>
									</span>
								</label>
							</li>
						{/each}
					</ul>
				</Card.Content></Card.Root
			>
		</Tabs.Content>

		<Tabs.Content value="users" class="space-y-4">
			<Card.Root class="card-glass"
				><Card.Content class="space-y-4 p-4">
					<h3 class="text-sm font-medium">Server accounts vs workspace members</h3>
					<p class="text-sm text-muted-foreground">
						<strong class="font-medium text-foreground">Users (this tab)</strong> are login accounts
						for this app: who can sign in, who is a <em>server</em> administrator (settings, storage,
						reindex, approving signups), and account status.
					</p>
					<p class="text-sm text-muted-foreground">
						<strong class="font-medium text-foreground">Workspace members</strong> are managed under
						<a href="/workspace" class="font-medium text-primary underline underline-offset-4"
							>Workspace settings</a
						>: who may access each workspace’s chats and files, and their role
						<em>inside that workspace</em> (Admin, Member, Viewer). Someone can be a server user without
						being in a workspace, or belong to several workspaces with different roles.
					</p>
				</Card.Content></Card.Root
			>

			{#if isAdmin}
				<div class="rounded-md border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Username</Table.Head>
								<Table.Head>Display name</Table.Head>
								<Table.Head>Server role</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="w-[220px] text-right">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each users as user}
								<Table.Row>
									<Table.Cell class="font-mono text-xs">{user.username}</Table.Cell>
									<Table.Cell>{user.displayName}</Table.Cell>
									<Table.Cell>
										{#if user.id === currentUserId || (user.role === 'ADMIN' && !canDemoteServerAdmin(user))}
											<Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
												{user.role}
											</Badge>
										{:else}
											<Select.Root
												type="single"
												value={user.role}
												onValueChange={(val) => {
													if (val === 'ADMIN' || val === 'USER') updateAppRole(user.id, val);
												}}
											>
												<Select.Trigger class="w-32" size="sm">
													{user.role}
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="ADMIN">ADMIN</Select.Item>
													<Select.Item value="USER" disabled={!canDemoteServerAdmin(user)}
														>USER</Select.Item
													>
												</Select.Content>
											</Select.Root>
										{/if}
									</Table.Cell>
									<Table.Cell>
										<Badge variant={user.approved ? 'outline' : 'secondary'}>
											{user.approved ? 'Active' : 'Pending'}
										</Badge>
									</Table.Cell>
									<Table.Cell class="text-right">
										<Button
											variant="outline"
											size="sm"
											class="border-destructive/30 text-destructive hover:bg-destructive/10"
											disabled={!canDeactivate(user)}
											onclick={() => openDeactivateDialog(user.id)}
										>
											Deactivate
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<Dialog.Root
					bind:open={deactivateDialogOpen}
					onOpenChange={(open) => {
						if (!open) deactivateTargetId = null;
					}}
				>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>Deactivate account?</Dialog.Title>
							<Dialog.Description>
								{#if deactivateTarget}
									This signs out <span class="font-medium text-foreground"
										>{deactivateTarget.displayName}</span
									>
									(<span class="font-mono text-xs">@{deactivateTarget.username}</span>) and blocks
									further sign-ins for this server account.
								{/if}
							</Dialog.Description>
						</Dialog.Header>
						<Dialog.Footer>
							<Button
								variant="outline"
								onclick={() => {
									deactivateDialogOpen = false;
									deactivateTargetId = null;
								}}>Cancel</Button
							>
							<Button variant="destructive" onclick={deactivateAccount}>Deactivate</Button>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Root>

				{#if pendingUsers.length > 0}
					<div class="space-y-3">
						<h3 class="text-sm font-medium">Pending signups</h3>
						{#each pendingUsers as pending}
							<Card.Root class="card-glass"
								><Card.Content class="flex items-center justify-between p-4">
									<div>
										<p class="font-medium">{pending.displayName}</p>
										<p class="text-sm text-muted-foreground">@{pending.username}</p>
									</div>
									<div class="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											class="border-green-500/30 text-green-600 hover:bg-green-500/10"
											onclick={() => approveUser(pending.id)}
										>
											<CheckIcon class="size-4" />
											Accept
										</Button>
										<Button
											variant="outline"
											size="sm"
											class="border-destructive/30 text-destructive hover:bg-destructive/10"
											onclick={() => rejectUser(pending.id)}
										>
											<XIcon class="size-4" />
											Reject
										</Button>
									</div>
								</Card.Content></Card.Root
							>
						{/each}
					</div>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">
					Only server administrators can view and change accounts here. Workspace membership is
					managed in
					<a href="/workspace" class="font-medium text-primary underline underline-offset-4"
						>Workspace settings</a
					>.
				</p>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="info" class="space-y-4">
			<Card.Root class="card-glass"
				><Card.Content class="p-4">
					<h3 class="mb-2 text-sm font-medium">Version</h3>
					<p class="text-sm text-muted-foreground">Vectraspace Media Server v0.1.0</p>
				</Card.Content></Card.Root
			>

			<Card.Root class="card-glass"
				><Card.Content class="p-4">
					<h3 class="mb-2 text-sm font-medium">Legal</h3>
					<p class="text-sm text-muted-foreground">
						This software is provided as-is for personal use. Use at your own risk. Ensure you have
						proper backups of your media files.
					</p>
				</Card.Content></Card.Root
			>
		</Tabs.Content>
	</Tabs.Root>
</PageShell>
