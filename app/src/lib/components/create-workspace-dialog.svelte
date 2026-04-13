<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { apiFetch } from '$lib/api-fetch';
	import { workspaceStore, type WorkspaceSummary } from '$lib/hooks/workspace.svelte';
	import { toast } from 'svelte-sonner';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let name = $state('');
	let slug = $state('');
	let description = $state('');
	let submitting = $state(false);
	let autoSlug = $state(true);

	$effect(() => {
		if (autoSlug && name) {
			slug = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '');
		}
	});

	function handleSlugInput() {
		autoSlug = false;
	}

	async function submit() {
		if (!name.trim() || !slug.trim()) return;
		submitting = true;
		try {
			const res = await apiFetch('/api/workspaces', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					slug: slug.trim(),
					description: description.trim() || undefined
				})
			});
			if (res.ok) {
				const { workspace } = (await res.json()) as { workspace: WorkspaceSummary };
				workspaceStore.addWorkspace(workspace);
				await workspaceStore.select(workspace.id);
				await invalidateAll();
				toast.success(`Workspace "${workspace.name}" created`);
				open = false;
				name = slug = description = '';
				autoSlug = true;
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				toast.error(err.error ?? 'Failed to create workspace');
			}
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Workspace</Dialog.Title>
			<Dialog.Description>
				A workspace is a shared environment for files, chats, and agents.
			</Dialog.Description>
		</Dialog.Header>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
			class="grid gap-4 py-4"
		>
			<div class="grid gap-2">
				<Label for="ws-name">Name</Label>
				<Input id="ws-name" bind:value={name} placeholder="My Workspace" required />
			</div>
			<div class="grid gap-2">
				<Label for="ws-slug">Slug</Label>
				<Input
					id="ws-slug"
					bind:value={slug}
					oninput={handleSlugInput}
					placeholder="my-workspace"
					required
				/>
				<p class="text-xs text-muted-foreground">URL-safe identifier. Auto-generated from name.</p>
			</div>
			<div class="grid gap-2">
				<Label for="ws-desc">Description</Label>
				<Textarea
					id="ws-desc"
					bind:value={description}
					placeholder="Optional description..."
					rows={2}
				/>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={submitting || !name.trim() || !slug.trim()}>
					{submitting ? 'Creating...' : 'Create'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
