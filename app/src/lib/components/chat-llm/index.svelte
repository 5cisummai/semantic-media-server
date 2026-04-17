<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { apiFetch } from '$lib/api-fetch';
	import { addAutoApproveToolName, getAutoApproveToolNames } from '$lib/agent-auto-approve';
	import { agentSessions } from '$lib/hooks/agent-sessions.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Textarea } from '$lib/components/ui/textarea';
	import ChatMessageBubble from './chat-message-bubble.svelte';
	import ChatComposer from './chat-composer.svelte';
	import ChatToolbar from './chat-toolbar.svelte';
	import type {
		ChatMessage,
		ChatResponsePayload,
		PendingToolConfirmation,
		Source,
		ToolCallSummary
	} from './types';

	let {
		workspaceId,
		activeChatId = $bindable<string | null>(null),
		activeAgentStatus = $bindable<'idle' | 'working' | 'done'>('idle'),
		onListRefresh
	}: {
		/** Active workspace — all brain/chat APIs are scoped under `/api/workspaces/:id`. */
		workspaceId: string | null;
		activeChatId?: string | null;
		activeAgentStatus?: 'idle' | 'working' | 'done';
		onListRefresh?: () => void;
	} = $props();

	const apiRoot = $derived(
		workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}` : null
	);

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	type ToolActionStep = {
		label: string;
		toolName: string;
		args?: Record<string, unknown>;
		thinking?: string;
		done: boolean;
		expanded: boolean;
	};

	let streamingToolSteps = $state<ToolActionStep[]>([]);
	/** Holds the model's reasoning text emitted just before a tool_start event. */
	let pendingThinking = $state<string>('');
	/** Text being streamed token-by-token for the current assistant reply. */
	let streamingText = $state('');
	let pendingToolConfirmation = $state<PendingToolConfirmation | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);
	let loadingConversation = $state(false);
	let editingUserId = $state<string | null>(null);
	let editDraft = $state('');
	let maxHistoryMessages = $state(40);
	let lastSendAt = $state(0);
	let pendingScrollMessageId = $state<string | null>(null);
	/** Aborts in-flight ask/confirm HTTP and SSE stream for the current run. */
	let agentRunAbortController: AbortController | null = null;

	// Sync local status to the global agentSessions store so any page can
	// read live status without polling.
	$effect(() => {
		const chatId = activeChatId;
		const status = activeAgentStatus;
		if (!chatId) return;
		untrack(() => {
			if (status === 'working') {
				agentSessions.setWorking(chatId);
			} else {
				agentSessions.setIdle(chatId);
			}
		});
	});

	const SUBMIT_DEBOUNCE_MS = 400;

	function isAbortError(err: unknown): boolean {
		return (
			(err instanceof DOMException && err.name === 'AbortError') ||
			(err instanceof Error && err.name === 'AbortError')
		);
	}

	// ---------------------------------------------------------------------------
	// SSE stream parser — reads a fetch Response body as SSE events
	// ---------------------------------------------------------------------------

	async function consumeSSEStream(
		response: Response,
		signal: AbortSignal
	): Promise<void> {
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				if (signal.aborted) break;
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				let currentEvent = '';
				for (const line of lines) {
					if (line.startsWith('event: ')) {
						currentEvent = line.slice(7).trim();
					} else if (line.startsWith('data: ')) {
						const dataStr = line.slice(6);
						try {
							const data = JSON.parse(dataStr);
							handleSSEEvent(currentEvent, data);
						} catch {
							// malformed JSON — skip
						}
						currentEvent = '';
					} else if (line.startsWith(': ')) {
						// comment / keepalive — skip
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	function handleSSEEvent(event: string, data: Record<string, unknown>): void {
		switch (event) {
			case 'run_started': {
				if (typeof data.chatId === 'string') {
					activeChatId = data.chatId;
				}
				if (typeof data.userMessageId === 'string') {
					const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
					if (lastUserIdx !== -1) {
						messages = messages.map((m, i) =>
							i === lastUserIdx ? { ...m, id: data.userMessageId as string } : m
						);
					}
				}
				break;
			}
			case 'text_delta': {
				if (typeof data.delta === 'string') {
					streamingText += data.delta;
				}
				break;
			}
			case 'reasoning': {
				if (typeof data.text === 'string') {
					pendingThinking += (pendingThinking ? '\n' : '') + data.text;
				}
				break;
			}
			case 'tool_start': {
				if (typeof data.tool === 'string') {
					pushToolStart(
						data.tool,
						data.args as Record<string, unknown> | undefined,
						pendingThinking || undefined
					);
				}
				break;
			}
			case 'tool_done': {
				markLastToolDone();
				break;
			}
			case 'confirmation': {
				pendingToolConfirmation = {
					pendingId: data.pendingId as string,
					tool: data.tool as string,
					args: (data.args ?? {}) as Record<string, unknown>,
					chatId: (data.chatId ?? activeChatId ?? '') as string
				};
				break;
			}
			case 'meta': {
				// Finalize the streamed message with metadata
				if (streamingText.trim()) {
					const assistantMsg: ChatMessage = {
						id: (data.messageId as string) ?? crypto.randomUUID(),
						role: 'assistant',
						content: streamingText,
						status: 'success',
						sources: data.sources as Source[] | undefined,
						toolCalls: data.toolCalls as ToolCallSummary[] | undefined,
						model: data.model as string | undefined,
						iterations: data.iterations as number | undefined,
						assistantVariants: [streamingText],
						variantIndex: 0
					};
					messages = [...messages, assistantMsg];
				}
				break;
			}
			case 'error': {
				const msg = typeof data.message === 'string' ? data.message : 'Agent error';
				error = msg;
				break;
			}
			case 'done': {
				// Stream finished
				break;
			}
		}
	}

	function toolLabelForName(name: string): string {
		const map: Record<string, string> = {
			list_directory: 'Browsing files',
			search: 'Searching files',
			read_file: 'Reading file',
			get_file_info: 'Checking file',
			search_by_metadata: 'Filtering files',
			delete_file: 'Delete (needs your approval)',
			move: 'Move (needs your approval)',
			copy_file: 'Copy (needs your approval)',
			mkdir: 'Create folder (needs your approval)'
		};
		return map[name] ?? `Using ${name}`;
	}

	function pushToolStart(name: string, args?: Record<string, unknown>, thinking?: string) {
		streamingToolSteps = [
			...streamingToolSteps,
			{
				label: toolLabelForName(name),
				toolName: name,
				args,
				thinking,
				done: false,
				expanded: false
			}
		];
		pendingThinking = '';
	}

	function toggleStepExpanded(stepIndex: number) {
		streamingToolSteps = streamingToolSteps.map((s, i) =>
			i === stepIndex ? { ...s, expanded: !s.expanded } : s
		);
	}

	function markLastToolDone() {
		for (let i = streamingToolSteps.length - 1; i >= 0; i--) {
			if (!streamingToolSteps[i].done) {
				streamingToolSteps = streamingToolSteps.map((s, j) => (j === i ? { ...s, done: true } : s));
				break;
			}
		}
	}

	function actionTitleForTool(name: string): string {
		const map: Record<string, string> = {
			delete_file: 'Delete',
			move: 'Move',
			copy_file: 'Copy',
			mkdir: 'Create folder'
		};
		return map[name] ?? name;
	}

	let autoApproveThisKind = $state(false);

	$effect(() => {
		void pendingToolConfirmation?.pendingId;
		autoApproveThisKind = false;
	});

	function summarizeToolArgs(tool: string, args: Record<string, unknown>): string {
		try {
			if (tool === 'delete_file' && typeof args.path === 'string') return args.path;
			if (tool === 'mkdir' && typeof args.path === 'string') return args.path;
			if (
				(tool === 'move' || tool === 'copy_file') &&
				typeof args.source_path === 'string' &&
				typeof args.destination_path === 'string'
			) {
				return `${args.source_path} → ${args.destination_path}`;
			}
			if (
				tool === 'move' &&
				Array.isArray(args.source_paths) &&
				typeof args.destination_directory === 'string'
			) {
				const n = args.source_paths.length;
				return `${n} path(s) → ${args.destination_directory}`;
			}
			return JSON.stringify(args, null, 2);
		} catch {
			return String(tool);
		}
	}

	function scrollToBottom() {
		const el = scrollEl;
		if (!el) return;
		requestAnimationFrame(() => {
			el.scrollTop = el.scrollHeight;
		});
	}

	function scrollMessageIntoView(messageId: string) {
		requestAnimationFrame(() => {
			const root = scrollEl;
			if (!root) return;
			const node = root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
			node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
	}

	function stopAgent() {
		agentRunAbortController?.abort();
		agentRunAbortController = null;
		loading = false;
		streamingToolSteps = [];
		streamingText = '';
		pendingThinking = '';
		activeAgentStatus = 'done';
	}

	// Auto-scroll to bottom when messages, loading, streaming text, or tool steps change.
	$effect(() => {
		void messages;
		void loading;
		void streamingToolSteps;
		void streamingText;
		scrollToBottom();
	});

	// Scroll a specific message into view after it's rendered
	$effect(() => {
		const id = pendingScrollMessageId;
		if (!id) return;
		scrollMessageIntoView(id);
		pendingScrollMessageId = null;
	});


	function guardSubmit(): boolean {
		const now = Date.now();
		if (now - lastSendAt < SUBMIT_DEBOUNCE_MS) return false;
		lastSendAt = now;
		return true;
	}

	async function truncateRemote(chatId: string, fromMessageId: string): Promise<void> {
		if (!apiRoot) throw new Error('No workspace selected');
		const response = await apiFetch(`${apiRoot}/chats/${encodeURIComponent(chatId)}/truncate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fromMessageId })
		});
		if (!response.ok) {
			const err = await response.json().catch(() => ({}));
			throw new Error(
				(err as { message?: string }).message ?? `Truncate failed (${response.status})`
			);
		}
	}

	async function sendAsk(options: { question: string; regenerate?: boolean }): Promise<void> {
		loading = true;
		activeAgentStatus = 'working';
		error = null;
		streamingToolSteps = [];
		streamingText = '';
		pendingThinking = '';
		pendingToolConfirmation = null;

		agentRunAbortController?.abort();
		agentRunAbortController = new AbortController();
		const signal = agentRunAbortController.signal;

		try {
			if (!apiRoot) {
				throw new Error('No workspace selected');
			}
			const response = await apiFetch(`${apiRoot}/brain/ask`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId: activeChatId,
					question: options.question,
					filters: { limit: 16 },
					regenerate: options.regenerate === true,
					maxHistoryMessages: maxHistoryMessages,
					autoApproveToolNames: getAutoApproveToolNames()
				}),
				signal
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({}));
				throw new Error(
					(err as { message?: string }).message ?? `Request failed (${response.status})`
				);
			}

			// Consume the SSE stream
			await consumeSSEStream(response, signal);

			// Stream finished
			loading = false;
			streamingToolSteps = [];
			streamingText = '';
			pendingThinking = '';
			agentRunAbortController = null;
			activeAgentStatus = pendingToolConfirmation ? 'done' : 'done';
			onListRefresh?.();
		} catch (err) {
			if (isAbortError(err)) {
				loading = false;
				activeAgentStatus = 'done';
				streamingToolSteps = [];
				streamingText = '';
				pendingThinking = '';
				agentRunAbortController = null;
				return;
			}
			loading = false;
			activeAgentStatus = 'done';
			streamingToolSteps = [];
			streamingText = '';
			pendingThinking = '';
			agentRunAbortController = null;
			const msg = err instanceof Error ? err.message : 'An error occurred';
			error = msg;
		}
	}

	async function sendMessage() {
		if (!input.trim() || loading) return;
		if (!guardSubmit()) return;

		const text = input.trim();
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: text,
			status: 'success',
			editedFrom: null
		};

		messages = [...messages, userMessage];
		input = '';
		pendingScrollMessageId = userMessage.id;

		await sendAsk({ question: text, regenerate: false });
	}

	async function submitToolConfirmation(approved: boolean, rememberAutoApprove?: boolean) {
		const pending = pendingToolConfirmation;
		if (!pending || loading) return;

		if (approved && rememberAutoApprove) {
			addAutoApproveToolName(pending.tool);
		}
		const autoApproveToolNames = getAutoApproveToolNames();

		loading = true;
		activeAgentStatus = 'working';
		error = null;
		streamingToolSteps = [];
		streamingText = '';
		pendingThinking = '';
		pendingToolConfirmation = null;

		agentRunAbortController?.abort();
		agentRunAbortController = new AbortController();
		const signal = agentRunAbortController.signal;

		try {
			if (!apiRoot) {
				throw new Error('No workspace selected');
			}
			const response = await apiFetch(`${apiRoot}/brain/ask/confirm`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pendingId: pending.pendingId,
					approved,
					chatId: pending.chatId,
					autoApproveToolNames
				}),
				signal
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({}));
				throw new Error(
					(err as { message?: string }).message ?? `Request failed (${response.status})`
				);
			}

			// Consume the SSE stream
			await consumeSSEStream(response, signal);

			loading = false;
			streamingToolSteps = [];
			streamingText = '';
			pendingThinking = '';
			agentRunAbortController = null;
			activeAgentStatus = 'done';
			onListRefresh?.();
		} catch (err) {
			if (isAbortError(err)) {
				loading = false;
				activeAgentStatus = 'done';
				streamingToolSteps = [];
				streamingText = '';
				pendingThinking = '';
				agentRunAbortController = null;
				return;
			}
			loading = false;
			activeAgentStatus = 'done';
			streamingToolSteps = [];
			streamingText = '';
			pendingThinking = '';
			agentRunAbortController = null;
			error = err instanceof Error ? err.message : 'An error occurred';
		}
	}

	function toUiMessages(
		rows: Array<{
			id: string;
			role: 'user' | 'assistant';
			content: string;
			sources?: Source[];
			toolCalls?: ToolCallSummary[];
			model?: string;
			iterations?: number;
		}>
	): ChatMessage[] {
		return rows.map((row) => ({
			id: row.id,
			role: row.role,
			content: row.content,
			status: 'success' as const,
			sources: row.sources,
			toolCalls: row.toolCalls,
			model: row.model,
			iterations: row.iterations,
			editedFrom: null,
			...(row.role === 'assistant'
				? {
						assistantVariants: [row.content],
						variantIndex: 0
					}
				: {})
		}));
	}

	export async function loadConversationFromServer(chatId: string): Promise<void> {
		if (loading) return;
		loadingConversation = true;
		error = null;
		streamingToolSteps = [];
		pendingToolConfirmation = null;
		editingUserId = null;
		try {
			if (!apiRoot) {
				throw new Error('No workspace selected');
			}
			const response = await apiFetch(`${apiRoot}/chats/${encodeURIComponent(chatId)}`);
			if (!response.ok) {
				throw new Error(`Failed to load chat (${response.status})`);
			}
			const payload = (await response.json()) as ChatResponsePayload;
			activeChatId = payload.chat.id;
			messages = toUiMessages(payload.messages);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load chat';
		} finally {
			loadingConversation = false;
		}
	}

	export function resetConversation(): void {
		if (loading) return;
		activeChatId = null;
		messages = [];
		error = null;
		streamingToolSteps = [];
		streamingText = '';
		pendingToolConfirmation = null;
		editingUserId = null;
	}

	export async function startWithMessage(msg: string): Promise<void> {
		if (loading || !msg.trim()) return;
		resetConversation();
		input = msg.trim();
		await tick();
		await sendMessage();
	}

	$effect(() => {
		return () => {
			agentRunAbortController?.abort();
			agentRunAbortController = null;
		};
	});

	async function startEditUser(message: ChatMessage) {
		if (message.role !== 'user' || loading || !activeChatId) return;
		editingUserId = message.id;
		editDraft = message.content;
		await tick();
	}

	function cancelEdit() {
		editingUserId = null;
		editDraft = '';
	}

	async function commitEdit() {
		const id = editingUserId;
		if (!id || !activeChatId || loading) return;
		if (!guardSubmit()) return;
		const text = editDraft.trim();
		if (!text) return;

		const idx = messages.findIndex((m) => m.id === id);
		if (idx === -1) return;

		const prevContent = messages[idx].content;
		editingUserId = null;

		try {
			await truncateRemote(activeChatId, id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not update message';
			return;
		}

		messages = messages.slice(0, idx);
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: text,
			status: 'success',
			editedFrom: prevContent
		};
		messages = [...messages, userMessage];
		pendingScrollMessageId = userMessage.id;

		await sendAsk({ question: text, regenerate: false });
	}

	async function regenerateAssistant(message: ChatMessage) {
		if (message.role !== 'assistant' || loading || !activeChatId) return;
		if (!guardSubmit()) return;

		const idx = messages.findIndex((m) => m.id === message.id);
		if (idx === -1) return;

		const userBefore = idx > 0 && messages[idx - 1]?.role === 'user' ? messages[idx - 1] : null;
		if (!userBefore) {
			error = 'Cannot regenerate without a preceding user message.';
			return;
		}

		const priorVariants = message.assistantVariants ?? [message.content];

		try {
			await truncateRemote(activeChatId, message.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not regenerate';
			return;
		}

		messages = messages.slice(0, idx);

		await sendAsk({ question: userBefore.content, regenerate: true });

		const last = messages[messages.length - 1];
		if (last?.role === 'assistant' && last.status === 'success') {
			messages = messages.map((m, i, arr) => {
				if (i !== arr.length - 1 || m.role !== 'assistant') return m;
				return {
					...m,
					assistantVariants: [...priorVariants, m.content],
					variantIndex: priorVariants.length
				};
			});
		}
	}

	function variantPrev(message: ChatMessage) {
		if (message.role !== 'assistant' || !message.assistantVariants?.length) return;
		const max = message.assistantVariants.length - 1;
		const cur = message.variantIndex !== undefined ? message.variantIndex : max;
		if (cur <= 0) return;
		const nextIdx = cur - 1;
		messages = messages.map((m) =>
			m.id === message.id
				? {
						...m,
						variantIndex: nextIdx,
						content: message.assistantVariants![nextIdx]!
					}
				: m
		);
	}

	function variantNext(message: ChatMessage) {
		if (message.role !== 'assistant' || !message.assistantVariants?.length) return;
		const max = message.assistantVariants.length - 1;
		const cur = message.variantIndex !== undefined ? message.variantIndex : max;
		if (cur >= max) return;
		const nextIdx = cur + 1;
		messages = messages.map((m) =>
			m.id === message.id
				? {
						...m,
						variantIndex: nextIdx,
						content: message.assistantVariants![nextIdx]!
					}
				: m
		);
	}

	async function copyMessage(message: ChatMessage) {
		const text =
			message.role === 'assistant' && message.assistantVariants?.length
				? (message.assistantVariants[
						message.variantIndex !== undefined
							? message.variantIndex
							: message.assistantVariants.length - 1
					] ?? message.content)
				: message.content;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			error = 'Copy failed';
		}
	}

	function exportJson() {
		const blob = new Blob([JSON.stringify({ chatId: activeChatId, messages }, null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `chat-${activeChatId ?? 'export'}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportMarkdown() {
		const lines: string[] = [];
		for (const m of messages) {
			const role = m.role === 'user' ? 'User' : 'Assistant';
			const body =
				m.role === 'assistant' && m.assistantVariants?.length
					? (m.assistantVariants[m.variantIndex ?? m.assistantVariants.length - 1] ?? m.content)
					: m.content;
			lines.push(`### ${role}\n\n${body}\n`);
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `chat-${activeChatId ?? 'export'}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function retryLastFailed(message: ChatMessage) {
		if (message.role !== 'assistant' || loading || !activeChatId) return;
		const idx = messages.findIndex((m) => m.id === message.id);
		if (idx < 1) return;
		const userBefore = messages[idx - 1];
		if (userBefore.role !== 'user') return;

		messages = messages.filter((_, i) => i !== idx);
		error = null;

		try {
			await truncateRemote(activeChatId, message.id);
		} catch {
			// message may already be gone
		}

		await sendAsk({ question: userBefore.content, regenerate: true });
	}
</script>

<section class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
	<div class="shrink-0 border-border/60">
		<ChatToolbar
			bind:maxHistoryMessages
			onExportJson={exportJson}
			onExportMarkdown={exportMarkdown}
			showStop={loading}
			onStopAgent={stopAgent}
			disabled={loadingConversation}
		/>
	</div>

	<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
		<div class="mx-auto flex min-h-full w-full max-w-3xl flex-col px-3 pt-4 pb-4 sm:px-4">
			{#if loadingConversation}
				<div class="flex flex-1 items-center justify-center">
					<p class="text-sm text-muted-foreground">Loading agent…</p>
				</div>
			{:else if messages.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 px-2 py-12 text-center">
					<div
						class="flex size-14 items-center justify-center rounded-2xl bg-muted/80 text-2xl shadow-inner ring-1 ring-border/50"
						aria-hidden="true"
					>
						✦
					</div>
					<div class="max-w-sm space-y-1.5 text-muted-foreground">
						<p class="text-base font-medium text-foreground">What can this agent help you with?</p>
						<p class="text-sm leading-relaxed">
							Give this agent a task to complete using the file index and ingested content.
						</p>
					</div>
				</div>
			{:else}
				<div class="flex flex-col">
					{#each messages as message (message.id)}
						{#if editingUserId === message.id && message.role === 'user'}
							<div class="w-full border-b border-border/70 py-5">
								<div class="w-full border border-border bg-muted/20 p-3">
									<label class="sr-only" for="edit-user-msg">Edit message</label>
									<Textarea
										id="edit-user-msg"
										bind:value={editDraft}
										rows={4}
										class="w-full resize-y"
									/>
									<div class="mt-2 flex justify-end gap-2">
										<Button type="button" variant="ghost" size="sm" onclick={cancelEdit}
											>Cancel</Button
										>
										<Button
											type="button"
											size="sm"
											disabled={loading || !editDraft.trim()}
											onclick={() => commitEdit()}>Save & resend</Button
										>
									</div>
								</div>
							</div>
						{:else}
							<ChatMessageBubble
								{message}
								busy={loading}
								onEdit={() => startEditUser(message)}
								onRegenerate={() => regenerateAssistant(message)}
								onCopy={() => copyMessage(message)}
								onRetry={() => retryLastFailed(message)}
								onVariantPrev={() => variantPrev(message)}
								onVariantNext={() => variantNext(message)}
							/>
						{/if}
					{/each}
				</div>
			{/if}

			{#if streamingToolSteps.length > 0}
				<ul class="mt-2 space-y-1" aria-live="polite" aria-label="Tool activity">
					{#each streamingToolSteps as step, stepIndex (stepIndex)}
						<li class="flex flex-col">
							<button
								type="button"
								class="group -mx-0.5 flex w-fit items-center gap-2 rounded px-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
								onclick={() => toggleStepExpanded(stepIndex)}
								title="Click to see call details"
							>
								{#if step.done}
									<span class="text-emerald-600 dark:text-emerald-400" aria-hidden="true">✓</span>
								{:else}
									<span
										class="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/70"
										aria-hidden="true"
									></span>
								{/if}
								<span>{step.label}…</span>
								<span
									class="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground/70"
									>{step.expanded ? '▲' : '▼'}</span
								>
							</button>
							{#if step.expanded}
								<div
									class="mt-1 ml-4 max-w-sm overflow-hidden rounded border border-border/60 bg-muted/30 text-[11px] leading-relaxed"
								>
									{#if step.thinking}
										<div class="border-b border-border/50 px-2.5 py-1.5">
											<p
												class="mb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
											>
												Thinking
											</p>
											<p class="whitespace-pre-wrap text-foreground/80">{step.thinking}</p>
										</div>
									{/if}
									<div class="px-2.5 py-1.5">
										<p
											class="mb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
										>
											Call
										</p>
										<code class="font-mono break-all whitespace-pre-wrap text-foreground/90"
											>{step.toolName}({step.args ? JSON.stringify(step.args, null, 2) : ''})</code
										>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if streamingText}
				<div class="mt-2 border-t border-border/60 pt-4">
					<div class="prose prose-sm dark:prose-invert max-w-none">
						<ChatMessageBubble
							message={{
								id: '__streaming__',
								role: 'assistant',
								content: streamingText,
								status: 'success'
							}}
							busy={true}
						/>
					</div>
				</div>
			{/if}

			{#if loading && !streamingText && !streamingToolSteps.some((s) => !s.done)}
				<div class="mt-2 flex w-full border-t border-border/60 pt-4">
					<div class="flex w-full items-center gap-3 py-2">
						<div class="flex gap-1.5">
							<span class="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70"></span>
							<span
								class="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70"
								style="animation-delay: 0.12s"
							></span>
							<span
								class="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70"
								style="animation-delay: 0.24s"
							></span>
						</div>
						<span class="text-xs text-muted-foreground">Thinking…</span>
					</div>
				</div>
			{/if}

			{#if error}
				<div
					class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span>{error}</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="shrink-0"
							onclick={() => (error = null)}>Dismiss</Button
						>
					</div>
				</div>
			{/if}
		</div>
	</div>

	{#if pendingToolConfirmation}
		<div class="shrink-0 border-t border-border/60 bg-muted/25 px-3 py-3">
			<div
				class="mx-auto max-w-3xl rounded-xl border border-amber-200/90 bg-amber-50/95 px-4 py-3 shadow-sm dark:border-amber-900/45 dark:bg-amber-950/35"
			>
				<p class="text-sm font-medium text-foreground">Confirm file action</p>
				<p class="mt-1 font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
					<span class="font-sans font-medium text-foreground/90"
						>{actionTitleForTool(pendingToolConfirmation.tool)}</span
					>
					· {summarizeToolArgs(pendingToolConfirmation.tool, pendingToolConfirmation.args)}
				</p>
				<label
					class="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-snug text-muted-foreground"
				>
					<Checkbox
						bind:checked={autoApproveThisKind}
						disabled={loading}
						class="mt-0.5 size-3.5 shrink-0"
					/>
					<span>
						Auto-approve future
						<span class="font-medium text-foreground/90"
							>{actionTitleForTool(pendingToolConfirmation.tool)}</span
						>
						actions in this browser (skip this prompt next time)
					</span>
				</label>
				<div class="mt-3 flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						disabled={loading}
						onclick={() => submitToolConfirmation(true, autoApproveThisKind)}
					>
						Approve
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={loading}
						onclick={() => submitToolConfirmation(false)}
					>
						Deny
					</Button>
				</div>
			</div>
		</div>
	{/if}

	<div class="shrink-0 border-border/60 bg-background px-3 py-3">
		<ChatComposer
			bind:value={input}
			disabled={loading || loadingConversation}
			onSubmit={sendMessage}
		/>
	</div>
</section>
