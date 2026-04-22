import { json } from '@sveltejs/kit';
import { parseBody, requireAuth, requirePathAccess, uploadIndexSchema } from '$lib/server/api';
import { indexFileByRelativePath } from '$lib/server/semantic';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);
	const { paths } = await parseBody(request, uploadIndexSchema);

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
