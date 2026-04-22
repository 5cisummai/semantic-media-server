/** Browse path to `.trash` for the drive that owns the current folder (personal paths use drive 0). */
export function mediaTrashBrowsePath(activePath: string): string {
	const segments = activePath.replace(/^\/+/, '').split('/').filter(Boolean);
	if (segments.length === 0) return '0/.trash';
	const first = segments[0];
	if (/^\d+$/.test(first ?? '')) return `${first}/.trash`;
	return '0/.trash';
}
