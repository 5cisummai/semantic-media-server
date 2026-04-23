/** Browse path to `.trash` for the drive that owns the current folder (personal paths use drive 0). */
export function mediaTrashBrowsePath(activePath: string): string {
	const segments = activePath.replace(/^\/+/, '').split('/').filter(Boolean);
	if (segments.length === 0) return '0/.trash';
	const first = segments[0];
	if (/^\d+$/.test(first ?? '')) return `${first}/.trash`;
	return '0/.trash';
}

/** True for the on-disk trash bucket path for a drive (`0/.trash`, …). */
export function isMediaTrashRootPath(p: string): boolean {
	return /^\d+\/.trash$/.test(p.replace(/^\/+/, ''));
}

/** True when `p` is the trash bucket or anything inside it (`0/.trash`, `0/.trash/uuid/file`). */
export function isMediaTrashSubtreePath(p: string): boolean {
	const n = p.replace(/^\/+/, '').replace(/\\/g, '/');
	return /^\d+\/.trash(\/|$)/.test(n);
}
