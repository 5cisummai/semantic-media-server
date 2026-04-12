import { error } from '@sveltejs/kit';
import { subscribeRunStatus, type ApiRunStatus } from '$lib/server/agent-runs';
import type { RequestHandler } from './$types';

/**
 * SSE endpoint — streams `{ chatId, status }` events to the client whenever
 * one of the current user's background agent runs changes status.
 *
 * Keepalive comment lines are sent every 20 s to prevent proxy/browser timeouts.
 */
export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	const enc = new TextEncoder();
	let cleanup: (() => void) | null = null;

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			function send(chatId: string, status: ApiRunStatus) {
				try {
					controller.enqueue(enc.encode(`data: ${JSON.stringify({ chatId, status })}\n\n`));
				} catch {
					// controller already closed — let cancel() tidy up
				}
			}

			const unsub = subscribeRunStatus((uid, chatId, status) => {
				if (uid !== userId) return;
				send(chatId, status);
			});

			// Keepalive so proxies/browsers don't drop the idle connection.
			const keepalive = setInterval(() => {
				try {
					controller.enqueue(enc.encode(': ping\n\n'));
				} catch {
					clearInterval(keepalive);
				}
			}, 20_000);

			cleanup = () => {
				unsub();
				clearInterval(keepalive);
			};
		},
		cancel() {
			cleanup?.();
			cleanup = null;
		}
	});

	// Also cancel when the HTTP request is aborted (client navigates away).
	request.signal.addEventListener('abort', () => {
		cleanup?.();
		cleanup = null;
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
