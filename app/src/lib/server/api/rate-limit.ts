import { error } from '@sveltejs/kit';

// ── Configuration ────────────────────────────────────────────────────────────

interface RateLimitConfig {
	/** Maximum number of requests allowed in the window */
	maxRequests: number;
	/** Time window in milliseconds */
	windowMs: number;
}

interface BucketEntry {
	timestamps: number[];
}

// ── In-memory sliding window rate limiter ─────────────────────────────────────
//
// For a self-hosted application this is sufficient. In a multi-instance
// deployment, replace with Redis-backed rate limiting.
//
// The Map is keyed by a composite of the limiter name + client identifier
// (e.g. "login:192.168.1.1" or "signup:username").

const buckets = new Map<string, BucketEntry>();

// Periodic cleanup to prevent memory leaks from stale entries
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
	if (cleanupTimer) return;
	cleanupTimer = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of buckets) {
			// Remove entries that haven't been touched in 5 minutes
			if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < now - 300_000) {
				buckets.delete(key);
			}
		}
		// If no entries left, stop the timer
		if (buckets.size === 0 && cleanupTimer) {
			clearInterval(cleanupTimer);
			cleanupTimer = null;
		}
	}, CLEANUP_INTERVAL_MS);

	// Unref so the timer doesn't prevent Node from exiting
	if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
		cleanupTimer.unref();
	}
}

/**
 * Check rate limit for a given key. Throws 429 if exceeded.
 *
 * @param name - Limiter namespace (e.g. 'login', 'signup')
 * @param key - Client identifier (e.g. IP address, username)
 * @param config - Rate limit configuration
 */
export function checkRateLimit(name: string, key: string, config: RateLimitConfig): void {
	ensureCleanup();

	const bucketKey = `${name}:${key}`;
	const now = Date.now();
	const windowStart = now - config.windowMs;

	let entry = buckets.get(bucketKey);
	if (!entry) {
		entry = { timestamps: [] };
		buckets.set(bucketKey, entry);
	}

	// Evict timestamps outside the current window
	entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

	if (entry.timestamps.length >= config.maxRequests) {
		throw error(429, 'Too many requests. Please try again later.');
	}

	entry.timestamps.push(now);
}

// ── Preset configurations ────────────────────────────────────────────────────

/** 5 login attempts per minute per IP */
export const LOGIN_RATE_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/** 3 signup attempts per 10 minutes per IP */
export const SIGNUP_RATE_LIMIT: RateLimitConfig = { maxRequests: 3, windowMs: 600_000 };

/** 10 admin actions per minute per user */
export const ADMIN_RATE_LIMIT: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };

/** 30 token refreshes per minute per user (generous, but prevents abuse) */
export const REFRESH_RATE_LIMIT: RateLimitConfig = { maxRequests: 30, windowMs: 60_000 };
