<script lang="ts">
	import { tick } from 'svelte';
	import { apiFetch } from '$lib/api-fetch';
	import { Button } from '$lib/components/ui/button';
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
		activeChatId = $bindable<string | null>(null),
		activeAgentStatus = $bindable<'idle' | 'working' | 'done'>('idle'),
		onListRefresh
	}: {
		activeChatId?: string | null;
		activeAgentStatus?: 'idle' | 'working' | 'done';
		onListRefresh?: () => void;
	} = $props();

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	type ToolActionStep = { label: string; done: boolean };

	let streamingToolSteps = $state<ToolActionStep[]>([]);
	let pendingToolConfirmation = $state<PendingToolConfirmation | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);
	let loadingConversation = $state(false);
	let editingUserId = $state<string | null>(null);
	let editDraft = $state('');
	let maxHistoryMessages = $state(40);
	let lastSendAt = $state(0);
	let pendingScrollMessageId = $state<string | null>(null);
	let backgroundRunId = $state<string | null>(null);
	let backgroundPollTimer: ReturnType<typeof setTimeout> | null = null;

	const SUBMIT_DEBOUNCE_MS = 400;

	type PendingMeta = {
		chatId?: string;
		sources?: Source[];
		filters?: Record<string, unknown>;
		model?: string;
		toolCalls?: ToolCallSummary[];
		iterations?: number;
	};

	type BackgroundRunStatus = 'queued' | 'running' | 'awaiting_confirmation' | 'done' | 'failed';
	type BackgroundToolStreamEntry = { type: 'tool_start' | 'tool_done'; tool: string };
	type BackgroundRunPayload = {
		id: string;
		chatId: string;
		status: BackgroundRunStatus;
		error?: string | null;
		pendingToolConfirmation?: PendingToolConfirmation | null;
		toolStreamLog?: BackgroundToolStreamEntry[];
	};

	function toolLabelForName(name: string): string {
		const map: Record<string, string> = {
			list_directory: 'Browsing files',
			search: 'Searching files',
			read_file: 'Reading file',
			get_file_info: 'Checking file',
			search_by_metadata: 'Filtering files',
			move_files: 'Moving files (needs your approval)',
			delete_file: 'Delete (needs your approval)',
			move_file: 'Move (needs your approval)',
			copy_file: 'Copy (needs your approval)',
			mkdir: 'Create folder (needs your approval)'
		};
		return map[name] ?? `Using ${name}`;
	}

	function toolStepsFromStreamLog(
		events: Array<{ type: string; tool: string }>
	): ToolActionStep[] {
		const steps: ToolActionStep[] = [];
		for (const e of events) {
			if (e.type === 'tool_start' && typeof e.tool === 'string') {
				steps.push({ label: toolLabelForName(e.tool), done: false });
			} else if (e.type === 'tool_done' && typeof e.tool === 'string') {
				for (let i = steps.length - 1; i >= 0; i--) {
					if (!steps[i].done) {
						steps[i] = { ...steps[i], done: true };
						break;
					}
				}
			}
		}
		return steps;
	}

	function pushToolStart(name: string) {
		streamingToolSteps = [...streamingToolSteps, { label: toolLabelForName(name), done: false }];
	}

	function markLastToolDone() {
		for (let i = streamingToolSteps.length - 1; i >= 0; i--) {
			if (!streamingToolSteps[i].done) {
				streamingToolSteps = streamingToolSteps.map((s, j) =>
					j === i ? { ...s, done: true } : s
				);
				break;
			}
		}
	}

	function actionTitleForTool(name: string): string {
		const map: Record<string, string> = {
			delete_file: 'Delete',
			move_file: 'Move',
			copy_file: 'Copy',
			mkdir: 'Create folder'
		};
		return map[name] ?? name;
	}

	function summarizeToolArgs(tool: string, args: Record<string, unknown>): string {
		try {
			if (tool === 'delete_file' && typeof args.path === 'string') return args.path;
			if (tool === 'mkdir' && typeof args.path === 'string') return args.path;
			if (
				(tool === 'move_file' || tool === 'copy_file') &&
				typeof args.source_path === 'string' &&
				typeof args.destination_path === 'string'
			) {
				return `${args.source_path} → ${args.destination_path}`;
			}
			return JSON.stringify(args, null, 2);
		} catch {
			return String(tool);
		}
	}

	function parseNdjsonLine(line: string): Record<string, unknown> | null {
		const trimmed = line.trim();
		if (!trimmed) return null;
		try {
			return JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	function mergeMetaIntoMessage(m: ChatMessage, meta: PendingMeta): ChatMessage {
		return {
			...m,
			...(meta.sources !== undefined ? { sources: meta.sources } : {}),
			...(meta.toolCalls !== undefined ? { toolCalls: meta.toolCalls } : {}),
			...(meta.iterations !== undefined ? { iterations: meta.iterations } : {}),
			...(meta.model !== undefined ? { model: meta.model } : {})
		};
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

	function clearBackgroundPolling() {
		if (backgroundPollTimer) {
			clearTimeout(backgroundPollTimer);
			backgroundPollTimer = null;
		}
	}

	function scheduleBackgroundPoll(runId: string) {
		clearBackgroundPolling();
		backgroundPollTimer = setTimeout(() => {
			void pollBackgroundRun(runId);
		}, 1200);
	}

	async function beginBackgroundRunTracking(
		runId: string,
		chatId: string,
		initialToolLog?: BackgroundToolStreamEntry[]
	) {
		backgroundRunId = runId;
		activeChatId = chatId;
		loading = true;
		activeAgentStatus = 'working';
		error = null;
		streamingToolSteps =
			initialToolLog && initialToolLog.length > 0 ? toolStepsFromStreamLog(initialToolLog) : [];
		pendingToolConfirmation = null;
		scheduleBackgroundPoll(runId);
	}

	async function maybeAttachToActiveBackgroundRun(chatId: string) {
		const response = await apiFetch(
			`/api/brain/runs/active?chatId=${encodeURIComponent(chatId)}`
		).catch(() => null);
		if (!response?.ok) return;
		const payload = (await response.json()) as { run?: BackgroundRunPayload | null };
		const run = payload.run;
		if (!run || !run.id) return;
		await beginBackgroundRunTracking(run.id, run.chatId, run.toolStreamLog);
	}

	async function pollBackgroundRun(runId: string) {
		if (!runId || runId !== backgroundRunId) return;
		try {
			const response = await apiFetch(`/api/brain/runs/${encodeURIComponent(runId)}`);
			if (!response.ok) {
				throw new Error(`Run status failed (${response.status})`);
			}

			const run = (await response.json()) as BackgroundRunPayload;
			if (run.status === 'queued' || run.status === 'running') {
				if (Array.isArray(run.toolStreamLog)) {
					streamingToolSteps = toolStepsFromStreamLog(run.toolStreamLog);
				}
				scheduleBackgroundPoll(runId);
				return;
			}

			backgroundRunId = null;
			clearBackgroundPolling();
			streamingToolSteps = [];
			loading = false;

			if (run.status === 'awaiting_confirmation' && run.pendingToolConfirmation) {
				pendingToolConfirmation = run.pendingToolConfirmation;
				activeAgentStatus = 'done';
				onListRefresh?.();
				return;
			}

			if (run.status === 'failed') {
				error = run.error ?? 'Agent run failed';
				activeAgentStatus = 'done';
				onListRefresh?.();
				return;
			}

			if (run.status === 'done') {
				activeAgentStatus = 'done';
				pendingToolConfirmation = null;
				onListRefresh?.();
				if (activeChatId) {
					await loadConversationFromServer(activeChatId);
				}
				return;
			}
		} catch (err) {
			if (runId !== backgroundRunId) return;
			error = err instanceof Error ? err.message : 'Background run status failed';
			loading = false;
			activeAgentStatus = 'done';
			streamingToolSteps = [];
			clearBackgroundPolling();
			backgroundRunId = null;
		}
	}

	// Auto-scroll to bottom when messages, loading, or tool steps change.
	// $effect runs after DOM updates so no tick() is needed.
	$effect(() => {
		void messages;
		void loading;
		void streamingToolSteps;
		scrollToBottom();
	});

	// Scroll a specific message into view after it's rendered
	$effect(() => {
		const id = pendingScrollMessageId;
		if (!id) return;
		scrollMessageIntoView(id);
		pendingScrollMessageId = null;
	});

	function processStreamEvent(
		obj: Record<string, unknown>,
		ctx: {
			assistantId: string | null;
			assistantContent: string;
			pendingMeta: PendingMeta | null;
		},
		streamFlags: { blockEmptyAssistantOnDone: boolean }
	): {
		assistantId: string | null;
		assistantContent: string;
		pendingMeta: PendingMeta | null;
	} {
		let { assistantId, assistantContent, pendingMeta } = ctx;

		if (typeof obj.type !== 'string') {
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'message_saved') {
			const rid = typeof obj.id === 'string' ? obj.id : null;
			const role = obj.role === 'user' || obj.role === 'assistant' ? obj.role : null;
			if (rid && role === 'user') {
				const idx = messages.length - 1;
				if (idx >= 0 && messages[idx]?.role === 'user') {
					messages = messages.map((m, i) => (i === idx ? { ...m, id: rid } : m));
				}
			}
			if (rid && role === 'assistant' && assistantId) {
				messages = messages.map((m) => (m.id === assistantId ? { ...m, id: rid } : m));
				assistantId = rid;
			}
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'tool_confirmation_required') {
			streamingToolSteps = [];
			if (
				typeof obj.pendingId === 'string' &&
				typeof obj.tool === 'string' &&
				typeof obj.chatId === 'string'
			) {
				streamFlags.blockEmptyAssistantOnDone = true;
				const rawArgs = obj.args;
				const args =
					rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
						? (rawArgs as Record<string, unknown>)
						: {};
				pendingToolConfirmation = {
					pendingId: obj.pendingId,
					tool: obj.tool,
					args,
					chatId: obj.chatId
				};
			}
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'tool_start' && typeof obj.tool === 'string') {
			pushToolStart(obj.tool);
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'tool_done') {
			markLastToolDone();
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'meta') {
			const next: PendingMeta = { ...(pendingMeta ?? {}) };
			if (typeof obj.chatId === 'string') {
				next.chatId = obj.chatId;
				activeChatId = obj.chatId;
				onListRefresh?.();
			}
			const src = obj.sources;
			if (Array.isArray(src)) next.sources = src as Source[];
			const tc = obj.toolCalls;
			if (Array.isArray(tc)) next.toolCalls = tc as ToolCallSummary[];
			if (typeof obj.model === 'string') next.model = obj.model;
			if (typeof obj.iterations === 'number') next.iterations = obj.iterations;
			const fl = obj.filters;
			if (fl && typeof fl === 'object') next.filters = fl as Record<string, unknown>;
			pendingMeta = next;

			if (assistantId) {
				messages = messages.map((m) => (m.id === assistantId ? mergeMetaIntoMessage(m, next) : m));
			}
			return { assistantId, assistantContent, pendingMeta };
		}

		const chunk =
			obj.type === 'token' && typeof obj.text === 'string'
				? obj.text
				: obj.type === 'delta' && typeof obj.text === 'string'
					? obj.text
					: null;

		if (chunk !== null) {
			if (!assistantId) {
				assistantId = crypto.randomUUID();
				assistantContent = chunk;
				const meta = pendingMeta;
				pendingMeta = null;
				messages = [
					...messages,
					mergeMetaIntoMessage(
						{
							id: assistantId,
							role: 'assistant',
							content: assistantContent,
							status: 'pending',
							assistantVariants: [assistantContent],
							variantIndex: 0
						},
						meta ?? {}
					)
				];
			} else {
				assistantContent += chunk;
				messages = messages.map((m) => {
					if (m.id !== assistantId) return m;
					const variants = m.assistantVariants ?? [m.content];
					const last = variants.length - 1;
					const nextVariants = [...variants];
					nextVariants[last] = assistantContent;
					return {
						...m,
						content: assistantContent,
						assistantVariants: nextVariants,
						variantIndex: nextVariants.length - 1
					};
				});
			}
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'done') {
			loading = false;
			streamingToolSteps = [];
			if (assistantId && pendingMeta) {
				messages = messages.map((m) =>
					m.id === assistantId ? { ...mergeMetaIntoMessage(m, pendingMeta!), status: 'success' } : m
				);
				pendingMeta = null;
			} else if (assistantId) {
				messages = messages.map((m) =>
					m.id === assistantId ? { ...m, status: 'success' as const } : m
				);
			}
			if (!streamFlags.blockEmptyAssistantOnDone && !assistantId && pendingMeta) {
				assistantId = crypto.randomUUID();
				messages = [
					...messages,
					mergeMetaIntoMessage(
						{
							id: assistantId,
							role: 'assistant',
							content: '',
							status: 'success',
							assistantVariants: [''],
							variantIndex: 0
						},
						pendingMeta
					)
				];
				pendingMeta = null;
			}
			return { assistantId, assistantContent, pendingMeta };
		}

		if (obj.type === 'error' && typeof obj.message === 'string') {
			throw new Error(obj.message);
		}

		return { assistantId, assistantContent, pendingMeta };
	}

	async function readNdjsonStream(response: Response, assistantIdRef: { current: string | null }) {
		if (!response.body) throw new Error('No response body');

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let assistantContent = '';
		let pendingMeta: PendingMeta | null = null;
		const streamFlags = { blockEmptyAssistantOnDone: false };

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const obj = parseNdjsonLine(line);
				if (!obj) continue;
				const out = processStreamEvent(
					obj,
					{
						assistantId: assistantIdRef.current,
						assistantContent,
						pendingMeta
					},
					streamFlags
				);
				assistantIdRef.current = out.assistantId;
				assistantContent = out.assistantContent;
				pendingMeta = out.pendingMeta;
			}
		}

		if (buffer.trim()) {
			const obj = parseNdjsonLine(buffer);
			if (obj) {
				const out = processStreamEvent(
					obj,
					{
						assistantId: assistantIdRef.current,
						assistantContent,
						pendingMeta
					},
					streamFlags
				);
				assistantIdRef.current = out.assistantId;
			}
		}
	}

	function guardSubmit(): boolean {
		const now = Date.now();
		if (now - lastSendAt < SUBMIT_DEBOUNCE_MS) return false;
		lastSendAt = now;
		return true;
	}

	async function truncateRemote(chatId: string, fromMessageId: string): Promise<void> {
		const response = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/truncate`, {
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
		pendingToolConfirmation = null;

		try {
			const response = await apiFetch('/api/brain/ask', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId: activeChatId,
					question: options.question,
					background: true,
					filters: { limit: 16 },
					regenerate: options.regenerate === true,
					maxHistoryMessages: maxHistoryMessages
				})
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({}));
				throw new Error(
					(err as { message?: string }).message ?? `Request failed (${response.status})`
				);
			}

			const payload = (await response.json()) as {
				chatId: string;
				runId: string;
				status: BackgroundRunStatus;
			};
			if (!payload.runId || !payload.chatId) {
				throw new Error('Invalid background run response');
			}
			await beginBackgroundRunTracking(payload.runId, payload.chatId);
			onListRefresh?.();
		} catch (err) {
			loading = false;
			activeAgentStatus = 'done';
			streamingToolSteps = [];
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

	async function submitToolConfirmation(approved: boolean) {
		const pending = pendingToolConfirmation;
		if (!pending || loading) return;

		loading = true;
		activeAgentStatus = 'working';
		error = null;
		streamingToolSteps = [];
		pendingToolConfirmation = null;

		try {
			const response = await apiFetch('/api/brain/ask/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pendingId: pending.pendingId,
					approved,
					chatId: pending.chatId,
					background: true
				})
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({}));
				throw new Error(
					(err as { message?: string }).message ?? `Request failed (${response.status})`
				);
			}

			const payload = (await response.json()) as {
				chatId: string;
				runId: string;
				status: BackgroundRunStatus;
			};
			if (!payload.runId || !payload.chatId) {
				throw new Error('Invalid background run response');
			}
			await beginBackgroundRunTracking(payload.runId, payload.chatId);
			onListRefresh?.();
		} catch (err) {
			loading = false;
			activeAgentStatus = 'done';
			streamingToolSteps = [];
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
			const response = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}`);
			if (!response.ok) {
				throw new Error(`Failed to load chat (${response.status})`);
			}
			const payload = (await response.json()) as ChatResponsePayload;
			activeChatId = payload.chat.id;
			messages = toUiMessages(payload.messages);
			await maybeAttachToActiveBackgroundRun(payload.chat.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load chat';
		} finally {
			loadingConversation = false;
		}
	}

	export function resetConversation(): void {
		if (loading) return;
		clearBackgroundPolling();
		backgroundRunId = null;
		activeChatId = null;
		messages = [];
		error = null;
		streamingToolSteps = [];
		pendingToolConfirmation = null;
		editingUserId = null;
	}

	$effect(() => {
		return () => {
			clearBackgroundPolling();
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
			disabled={loadingConversation}
		/>
	</div>

	<div
		bind:this={scrollEl}
		class="flex-1 min-h-0 overflow-y-auto"
		style="scrollbar-gutter: stable"
	>
		<div class="mx-auto flex min-h-full w-full max-w-3xl flex-col px-3 pt-4 pb-4 sm:px-4">
				{#if loadingConversation}
					<div class="flex flex-1 items-center justify-center">
						<p class="text-sm text-muted-foreground">Loading agent…</p>
					</div>
				{:else if messages.length === 0}
					<div
						class="flex flex-1 flex-col items-center justify-center gap-3 px-2 py-12 text-center"
					>
						<div
							class="flex size-14 items-center justify-center rounded-2xl bg-muted/80 text-2xl shadow-inner ring-1 ring-border/50"
							aria-hidden="true"
						>
							✦
						</div>
						<div class="max-w-sm space-y-1.5 text-muted-foreground">
							<p class="text-base font-medium text-foreground">
								What can this agent help you with?
							</p>
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
										<textarea
											id="edit-user-msg"
											bind:value={editDraft}
											rows="4"
											class="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
										></textarea>
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
					<ul class="mt-2 space-y-1.5 pl-1" aria-live="polite" aria-label="Tool activity">
						{#each streamingToolSteps as step, stepIndex (stepIndex)}
							<li class="flex items-center gap-2 text-xs text-muted-foreground">
								{#if step.done}
									<span class="text-emerald-600 dark:text-emerald-400" aria-hidden="true">✓</span>
								{:else}
									<span
										class="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/70"
										aria-hidden="true"
									></span>
								{/if}
								<span>{step.label}…</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if loading && !streamingToolSteps.some((s) => !s.done)}
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
				<div class="mt-3 flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						disabled={loading}
						onclick={() => submitToolConfirmation(true)}
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

	<div class="shrink-0 border-t border-border/60 bg-background px-3 py-3">
		<ChatComposer
			bind:value={input}
			disabled={loading || loadingConversation}
			onSubmit={sendMessage}
		/>
	</div>
</section>

