import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAuth, filterPersonalEntries } from '$lib/server/api';
import { listDirectoryShallowClientTree } from '$lib/server/services/storage';

export const load: PageServerLoad = async ({ fetch, url, locals }) => {
	const file = url.searchParams.get('file');
	if (file) {
		const next = new URLSearchParams();
		next.set('file', file);
		const path = url.searchParams.get('path');
		if (path) next.set('path', path);

		throw redirect(302, `/browse/media?${next.toString()}`);
	}

	const user = await requireAuth(locals);
	const currentPath = url.searchParams.get('path') ?? '';
	const folderUrl = currentPath ? `/api/browse/${currentPath}` : '/api/browse';

	const [shallowTree, folderResponse] = await Promise.all([
		listDirectoryShallowClientTree('', user).then((t) => filterPersonalEntries(user, t)),
		fetch(folderUrl)
	]);

	return {
		fileTree: shallowTree,
		currentPath,
		folderContents: folderResponse.ok ? await folderResponse.json() : []
	};
};
