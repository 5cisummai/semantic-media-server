<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { workspaceStore } from '$lib/hooks/workspace.svelte';
	import { apiFetch } from '$lib/api-fetch';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import PageShell from '$lib/components/page-shell.svelte';
	import UserIcon from '@lucide/svelte/icons/user';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let editName = $state('');
	let editDescription = $state('');
	let saving = $state(false);
	let confirmDelete = $state(false);

	const workspace = $derived(data.workspace);
	const isAdmin = $derived(workspace?.role === 'ADMIN');

	$effect(() => {
		editName = workspace?.name ?? '';
		editDescription = workspace?.description ?? '';
	});

	async function saveDetails() {
		if (!workspace || !isAdmin) return;
		saving = true;
		try {
			const res = await apiFetch(`/api/workspaces/${workspace.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editName.trim(),
					description: editDescription.trim() || null
				})
			});
			if (res.ok) {
				toast.success('Workspace updated');
				await workspaceStore.load();
				await invalidateAll();
			} else {
				toast.error('Failed to update workspace');
			}
		} finally {
			saving = false;
		}
	}

	async function updateRole(userId: string, role: string) {
		if (!workspace) return;
		const res = await apiFetch(`/api/workspaces/${workspace.id}/members/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role })
		});
		if (res.ok) {
			toast.success('Role updated');
			await invalidateAll();
		} else {
			toast.error('Failed to update role');
		}
	}

	async function removeMember(userId: string) {
		if (!workspace) return;
		const res = await apiFetch(`/api/workspaces/${workspace.id}/members/${userId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			toast.success('Member removed');
			await invalidateAll();
		} else {
			toast.error('Failed to remove member');
		}
	}

	async function deleteWorkspace() {
		if (!workspace) return;
		const res = await apiFetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.success('Workspace deleted');
			confirmDelete = false;
			await workspaceStore.load();
			await invalidateAll();
		} else {
			toast.error('Failed to delete workspace');
		}
	}

	function roleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
		if (role === 'ADMIN') return 'default';
		if (role === 'MEMBER') return 'secondary';
		return 'outline';
	}
</script>

<PageShell
	eyebrow="Workspace"
	title="Workspace Settings"
	description="Manage members, details, and permissions for the active workspace."
>
	{#if workspace}
		<!-- Details Card -->
		<Card.Root class="card-glass">
			<Card.Header>
				<Card.Title>Details</Card.Title>
				<Card.Description>Workspace name and description</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid gap-2">
					<Label for="ws-name">Name</Label>
					<Input id="ws-name" bind:value={editName} disabled={!isAdmin} />
				</div>
				<div class="grid gap-2">
					<Label for="ws-desc">Description</Label>
					<Input
						id="ws-desc"
						bind:value={editDescription}
						disabled={!isAdmin}
						placeholder="Optional description..."
					/>
				</div>
				<div class="text-sm text-muted-foreground">
					Slug: <code class="rounded bg-muted px-1 py-0.5">{workspace.slug}</code>
				</div>
				{#if isAdmin}
					<Button onclick={saveDetails} disabled={saving}>
						{saving ? 'Saving...' : 'Save Changes'}
					</Button>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Members Card -->
		<Card.Root class="card-glass">
			<Card.Header>
				<Card.Title>Members ({workspace.members.length})</Card.Title>
				<Card.Description>Manage who has access to this workspace</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#each workspace.members as member (member.userId)}
					<div class="flex items-center justify-between rounded-lg border p-3">
						<div class="flex items-center gap-3">
							<div class="flex size-8 items-center justify-center rounded-full bg-muted">
								{#if member.role === 'ADMIN'}
									<ShieldIcon class="size-4" />
								{:else}
									<UserIcon class="size-4" />
								{/if}
							</div>
							<div>
								<div class="font-medium">{member.displayName || member.username}</div>
								<div class="text-xs text-muted-foreground">@{member.username}</div>
							</div>
						</div>
						<div class="flex items-center gap-2">
							{#if isAdmin}
								<Select.Root
									type="single"
									value={member.role}
									onValueChange={(val) => {
										if (val) updateRole(member.userId, val);
									}}
								>
									<Select.Trigger class="w-28">
										{member.role}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="ADMIN">Admin</Select.Item>
										<Select.Item value="MEMBER">Member</Select.Item>
										<Select.Item value="VIEWER">Viewer</Select.Item>
									</Select.Content>
								</Select.Root>
								<Button variant="ghost" size="icon" onclick={() => removeMember(member.userId)}>
									<TrashIcon class="size-4 text-destructive" />
								</Button>
							{:else}
								<Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
							{/if}
						</div>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>

		<!-- Danger Zone -->
		{#if isAdmin && workspace.slug !== 'default'}
			<Card.Root class="card-glass border-destructive/40">
				<Card.Header>
					<Card.Title class="text-destructive">Danger Zone</Card.Title>
					<Card.Description>Irreversible actions</Card.Description>
				</Card.Header>
				<Card.Content>
					<Button variant="destructive" onclick={() => (confirmDelete = true)}>
						Delete Workspace
					</Button>
					<Dialog.Root bind:open={confirmDelete}>
						<Dialog.Content>
							<Dialog.Header>
								<Dialog.Title>Delete "{workspace.name}"?</Dialog.Title>
								<Dialog.Description>
									This will permanently delete the workspace, all its files, chats, and agent runs.
									This action cannot be undone.
								</Dialog.Description>
							</Dialog.Header>
							<Dialog.Footer>
								<Button variant="outline" onclick={() => (confirmDelete = false)}>Cancel</Button>
								<Button variant="destructive" onclick={deleteWorkspace}>Delete</Button>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Root>
				</Card.Content>
			</Card.Root>
		{/if}
	{:else}
		<Card.Root class="card-glass">
			<Card.Content class="p-6 text-center text-muted-foreground">
				No workspace selected. Select a workspace from the sidebar.
			</Card.Content>
		</Card.Root>
	{/if}
</PageShell>
