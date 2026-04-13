<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';

	let { ...restProps }: ComponentProps<typeof Card.Root> = $props();

	let displayName = $state('');
	let username = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let errorMsg = $state('');
	let successMsg = $state('');
	let loading = $state(false);

	function clearLegacyAuthStorage() {
		if (typeof localStorage === 'undefined') return;
		localStorage.removeItem('accessToken');
		localStorage.removeItem('username');
		localStorage.removeItem('role');
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		successMsg = '';

		if (password !== confirmPassword) {
			errorMsg = 'Passwords do not match';
			return;
		}
		if (password.length < 8) {
			errorMsg = 'Password must be at least 8 characters';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: username.trim().toLowerCase(),
					displayName: displayName.trim(),
					password: password.trim()
				})
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.message ?? 'Signup failed';
				return;
			}
			if (data.approved) {
				clearLegacyAuthStorage();
				goto(resolve('/'));
			} else {
				successMsg = 'Account created! Waiting for admin approval.';
			}
		} finally {
			loading = false;
		}
	}
</script>

<Card.Root {...restProps}>
	<Card.Header>
		<Card.Title>Create an account</Card.Title>
		<Card.Description>Enter your information below to create your account</Card.Description>
	</Card.Header>
	<Card.Content>
		<form onsubmit={handleSubmit}>
			<Field.Group>
				{#if errorMsg}
					<p class="text-sm text-destructive">{errorMsg}</p>
				{/if}
				{#if successMsg}
					<p class="text-sm text-green-600">{successMsg}</p>
				{/if}
				<Field.Field>
					<Field.Label for="name">Full Name</Field.Label>
					<Input id="name" type="text" placeholder="John Doe" bind:value={displayName} required />
				</Field.Field>
				<Field.Field>
					<Field.Label for="username">Username</Field.Label>
					<Input
						id="username"
						type="text"
						placeholder="Enter your username"
						bind:value={username}
						required
					/>
					<Field.Description>
						Your username will be used to login to your media server.
					</Field.Description>
				</Field.Field>
				<Field.Field>
					<Field.Label for="password">Password</Field.Label>
					<Input
						id="password"
						type="password"
						autocomplete="new-password"
						bind:value={password}
						required
					/>
					<Field.Description>Must be at least 8 characters long.</Field.Description>
				</Field.Field>
				<Field.Field>
					<Field.Label for="confirm-password">Confirm Password</Field.Label>
					<Input
						id="confirm-password"
						type="password"
						autocomplete="new-password"
						bind:value={confirmPassword}
						required
					/>
				</Field.Field>
				<Field.Group>
					<Field.Field>
						<Button type="submit" disabled={loading}>
							{loading ? 'Creating account…' : 'Create Account'}
						</Button>
						<Field.Description class="px-6 text-center">
							Already have an account? <a href={resolve('/login')}>Sign in</a>
						</Field.Description>
					</Field.Field>
				</Field.Group>
			</Field.Group>
		</form>
	</Card.Content>
</Card.Root>
