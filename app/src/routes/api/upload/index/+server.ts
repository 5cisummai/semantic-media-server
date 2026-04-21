import { json, error } from '@sveltejs/kit';
import { requireAuth, requirePathAccess } from '$lib/server/api';
import { indexFileByRelativePath } from '$lib/server/semantic';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);
	const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
	const paths = Array.isArray(body?.paths)
		? body.paths.filter((value): value is string => typeof value === 'string' && value.length > 0)
		: [];

	if (paths.length === 0) {
		throw error(400, 'No upload paths provided');
	}

	// Validate every path against the caller's access rights before indexing
	await Promise.all(paths.map((p) => requirePathAccess(user, p)));

	const uniquePaths = Array.from(new Set(paths));
	const results = await Promise.allSettled(
		uniquePaths.map((path) => indexFileByRelativePath(path))
	);
	const failures = results
		.map((result, index) => ({ result, path: uniquePaths[index] }))
		.filter((entry) => entry.result.status === 'rejected')
		.map((entry) => entry.path);

	return json({
		indexed: uniquePaths.length - failures.length,
		failed: failures.length,
		failures
	});
};
