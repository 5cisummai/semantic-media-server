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
	.transform((v) => v.trim().toLowerCase())
	.refine((s) => !/^\d+$/.test(s), {
		message: 'Username cannot be only digits (reserved for drive indexes in the media browser)'
	});

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

/** Workspace name: trimmed, 1-128 chars */
export const workspaceNameSchema = z
	.string()
	.trim()
	.min(1, 'Name is required')
	.max(128, 'Name must be at most 128 characters');

/** Workspace description: up to 1024 chars */
export const workspaceDescriptionSchema = z
	.string()
	.max(1024, 'Description must be at most 1024 characters');

// ── Endpoint schemas ─────────────────────────────────────────────────────────

export const approveUserSchema = z.object({ userId: cuidSchema }).strict(); // Reject unexpected fields (mass assignment protection)

/** App-level user role (login / server administration), not workspace role */
export const appUserRoleSchema = z.enum(['ADMIN', 'USER']);

export const updateAppUserRoleSchema = z
	.object({
		role: appUserRoleSchema
	})
	.strict();

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
		name: workspaceNameSchema.optional(),
		slug: slugSchema.optional(),
		description: workspaceDescriptionSchema.nullable().optional()
	})
	.strict();

export const createWorkspaceSchema = z
	.object({
		name: workspaceNameSchema,
		slug: slugSchema,
		description: workspaceDescriptionSchema.optional()
	})
	.strict();

export const ingestDirectorySchema = z
	.object({
		rootIndex: z
			.number()
			.refine(Number.isInteger, { message: 'rootIndex must be an integer' })
			.refine((value) => value >= 0, { message: 'rootIndex must be non-negative' })
	})
	.strict();

const mediaTypeSchema = z.enum(['video', 'audio', 'image', 'document', 'other']);

export const askFiltersSchema = z
	.object({
		mediaType: mediaTypeSchema.optional(),
		rootIndex: z
			.number()
			.refine(Number.isInteger, { message: 'rootIndex must be an integer' })
			.refine((value) => value >= 0, { message: 'rootIndex must be non-negative' })
			.optional(),
		fileIds: z.array(z.string().min(1, 'fileIds entries must not be empty')).optional(),
		limit: z
			.number()
			.refine(Number.isInteger, { message: 'limit must be an integer' })
			.refine((value) => value > 0, { message: 'limit must be greater than 0' })
			.optional(),
		minScore: z.number().finite('minScore must be a finite number').optional()
	})
	.strict();

export const askRequestSchema = z
	.object({
		question: z.string().trim().optional(),
		chatId: cuidSchema.optional(),
		filters: askFiltersSchema.optional(),
		regenerate: z.boolean().optional(),
		maxHistoryMessages: z
			.number()
			.finite('maxHistoryMessages must be a finite number')
			.refine((value) => value > 0, { message: 'maxHistoryMessages must be greater than 0' })
			.optional(),
		autoApproveToolNames: z.unknown().optional()
	})
	.strict();

export const confirmToolSchema = z
	.object({
		pendingId: cuidSchema,
		approved: z.boolean(),
		chatId: cuidSchema.optional(),
		autoApproveToolNames: z.unknown().optional()
	})
	.strict();

export const updateAgentPreferencesSchema = z
	.object({
		autoApproveToolNames: z.unknown().optional()
	})
	.strict();

export const createChatSchema = z
	.object({
		title: z.string().optional()
	})
	.strict();

export const truncateChatSchema = z
	.object({
		fromMessageId: cuidSchema
	})
	.strict();

export const workspaceSelectionSchema = z
	.object({
		workspaceId: z
			.union([cuidSchema, z.literal('')])
			.nullable()
			.optional()
	})
	.strict();

export const uploadIndexSchema = z
	.object({
		paths: z
			.array(z.string().min(1, 'paths entries must not be empty'))
			.min(1, 'No upload paths provided')
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

/**
 * Parse and validate an optional JSON request body.
 * Empty bodies return null; invalid JSON or invalid shapes still fail with 400.
 */
export async function parseOptionalBody<T extends z.ZodType>(
	request: Request,
	schema: T
): Promise<z.infer<T> | null> {
	const rawText = await request.text();
	if (!rawText.trim()) {
		return null;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(rawText) as unknown;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (raw === null) {
		return null;
	}

	const result = schema.safeParse(raw);
	if (!result.success) {
		const firstIssue = result.error.issues[0];
		throw error(400, firstIssue?.message ?? 'Validation failed');
	}

	return result.data;
}
