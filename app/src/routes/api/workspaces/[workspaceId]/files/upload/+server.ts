import { error, json } from '@sveltejs/kit';
import { writeWorkspaceFile } from '$lib/server/services/workspace-storage';
import { requireWorkspaceAccess } from '$lib/server/workspace-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { workspaceId } = await requireWorkspaceAccess(event, 'MEMBER');

	const formData = await event.request.formData().catch(() => null);
	if (!formData) throw error(400, 'Multipart form data expected');

	const file = formData.get('file') as File | null;
	const targetPath = (formData.get('path') as string) || '';

	if (!file) throw error(400, 'file field is required');

	const relativePath = targetPath ? `${targetPath}/${file.name}` : file.name;

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		const result = await writeWorkspaceFile(workspaceId, relativePath, buffer);
		return json(
			{
				path: relativePath,
				size: result.size
			},
			{ status: 201 }
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Upload failed';
		throw error(400, msg);
	}
};
