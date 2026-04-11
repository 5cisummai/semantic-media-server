import { error } from '@sveltejs/kit';
import { z } from 'zod';

// ── Reusable schema fragments ────────────────────────────────────────────────

/** Prisma CUID format (used for all entity IDs) */
export const cuidSchema = z.string().cuid();

/** Workspace slug: lowercase alphanumeric with hyphens, 2-64 chars */
export const slugSchema = z
	.string()
	.min(2, 'Slug must be at least 2 characters')
	.max(64, 'Slug must be at most 64 characters')
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens');

/** Username: 3-64 chars, will be lowercased and trimmed */
export const usernameSchema = z
	.string()
	.min(3, 'Username must be at least 3 characters')
	.max(64, 'Username must be at most 64 characters')
	.transform((v) => v.trim().toLowerCase());

/** Display name: 1-128 chars, trimmed */
export const displayNameSchema = z
	.string()
	.min(1, 'Display name is required')
	.max(128, 'Display name must be at most 128 characters')
	.transform((v) => v.trim());

/** Password: 8-256 chars. Never trimmed — whitespace is intentional. */
export const passwordSchema = z
	.string()
	.min(8, 'Password must be at least 8 characters')
	.max(256, 'Password must be at most 256 characters');

/** Workspace role enum */
export const workspaceRoleSchema = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);

// ── Endpoint schemas ─────────────────────────────────────────────────────────

export const approveUserSchema = z
	.object({ userId: cuidSchema })
	.strict(); // Reject unexpected fields (mass assignment protection)

export const loginSchema = z
	.object({
		username: z.string().min(1, 'Username is required').max(64),
		password: z.string().min(1, 'Password is required').max(256)
	})
	.strict();

export const signupSchema = z
	.object({
		username: usernameSchema,
		displayName: displayNameSchema,
		password: passwordSchema
	})
	.strict();

export const addMemberSchema = z
	.object({
		userId: cuidSchema,
		role: workspaceRoleSchema.optional()
	})
	.strict();

export const updateRoleSchema = z
	.object({
		role: workspaceRoleSchema
	})
	.strict();

export const updateWorkspaceSchema = z
	.object({
		name: z.string().min(1).max(128).optional(),
		slug: slugSchema.optional(),
		description: z.string().max(1024).optional()
	})
	.strict();

export const createWorkspaceSchema = z
	.object({
		name: z.string().min(1, 'Name is required').max(128),
		slug: slugSchema,
		description: z.string().max(1024).optional()
	})
	.strict();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns the validated (and possibly transformed) data.
 * Throws a SvelteKit error(400) with a safe message on failure.
 */
export async function parseBody<T extends z.ZodType>(
	request: Request,
	schema: T
): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const result = schema.safeParse(raw);
	if (!result.success) {
		// Return first validation error — safe to expose (schema-level, no internals)
		const firstIssue = result.error.issues[0];
		throw error(400, firstIssue?.message ?? 'Validation failed');
	}

	return result.data;
}
