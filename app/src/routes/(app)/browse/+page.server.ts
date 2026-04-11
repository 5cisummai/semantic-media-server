import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const file = url.searchParams.get('file');
	if (file) {
		const next = new URLSearchParams();
		next.set('file', file);
		const path = url.searchParams.get('path');
		if (path) next.set('path', path);

		throw redirect(302, `/browse/media?${next.toString()}`);
	}

	const currentPath = url.searchParams.get('path') ?? '';
	const folderUrl = currentPath ? `/api/browse/${currentPath}` : '/api/browse';
	const [treeResponse, folderResponse] = await Promise.all([
		fetch('/api/browse'),
		fetch(folderUrl)
	]);

	return {
		fileTree: treeResponse.ok ? await treeResponse.json() : [],
		currentPath,
		folderContents: folderResponse.ok ? await folderResponse.json() : []
	};
};
