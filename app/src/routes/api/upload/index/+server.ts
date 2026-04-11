import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api';
import { indexFileByRelativePath } from '$lib/server/semantic';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAuth(locals);
	const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
	const paths = Array.isArray(body?.paths)
		? body.paths.filter((value): value is string => typeof value === 'string' && value.length > 0)
		: [];

	if (paths.length === 0) {
		throw error(400, 'No upload paths provided');
	}

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
