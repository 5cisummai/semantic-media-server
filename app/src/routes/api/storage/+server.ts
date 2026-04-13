import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/api';
import { getStorageDrives } from '$lib/server/services/storage';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);
	return json(await getStorageDrives());
};
