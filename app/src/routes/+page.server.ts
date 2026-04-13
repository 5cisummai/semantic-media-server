import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = async () => {
	throw redirect(302, resolve('/home'));
};
