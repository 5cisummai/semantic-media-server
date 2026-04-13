import { error } from '@sveltejs/kit';

export const GET = async () => {
	throw error(400, 'No path provided');
};
