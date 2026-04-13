import { json } from '@sveltejs/kit';

// ── Types ────────────────────────────────────────────────────────────────────

interface SafeErrorOptions {
	/** HTTP status code */
	status: number;
	/** Message exposed to the client — must not contain internals */
	message: string;
	/** Optional detail logged server-side only */
	internalDetail?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return a JSON error response with a safe, generic message.
 * Internal details are logged but never sent to the client.
 *
 * Use this instead of SvelteKit's `error()` when you want to control
 * the exact response shape and avoid leaking info in error pages.
 */
export function safeErrorResponse({ status, message, internalDetail }: SafeErrorOptions): Response {
	if (internalDetail) {
		console.error(`[API ${status}]`, internalDetail);
	}

	return json({ error: message }, { status });
}

/**
 * Standard "not found or not accessible" response.
 * Deliberately vague to prevent IDOR/enumeration attacks.
 */
export function notFoundResponse(): Response {
	return safeErrorResponse({ status: 404, message: 'Resource not found or not accessible' });
}

/**
 * Standard "operation failed" for when a conditional update matched 0 rows.
 * Does not reveal whether the resource existed or what state it was in.
 */
export function operationFailedResponse(internalDetail?: string): Response {
	return safeErrorResponse({
		status: 409,
		message: 'Operation could not be completed. The resource may have been modified.',
		internalDetail
	});
}
