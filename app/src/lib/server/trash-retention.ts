// ---------------------------------------------------------------------------
// trash-retention.ts — Time-based purge of `.trash/<actionId>` entries + Qdrant
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { env } from '$env/dynamic/private';
import { removeBrainIndicesForExpiredTrashPaths } from '$lib/server/brain-cleanup';
import { cleanTrashEntry } from '$lib/server/trash';
import { getMediaRoots } from '$lib/server/services/storage';

const DAY_MS = 86_400_000;

function retentionDays(): number {
	const raw = env.TRASH_RETENTION_DAYS ?? '30';
	const n = Number.parseInt(String(raw), 10);
	return Number.isFinite(n) && n > 0 ? n : 30;
}

async function collectNestedRelativePathsForTrash(
	fullPath: string,
	relativePath: string
): Promise<string[]> {
	const stat = await fs.stat(fullPath);
	if (stat.isFile()) return [relativePath];
	if (!stat.isDirectory()) return [];

	const dirents = await fs.readdir(fullPath, { withFileTypes: true });
	const nested = await Promise.all(
		dirents.map(async (dirent) => {
			const childFull = path.join(fullPath, dirent.name);
			const childRel = path.join(relativePath, dirent.name);
			return collectNestedRelativePathsForTrash(childFull, childRel);
		})
	);
	return nested.flat();
}

/** Permanently remove trash entries older than `TRASH_RETENTION_DAYS` (default 30) and drop brain indices. */
export async function purgeExpiredTrashFromMediaRoots(): Promise<number> {
	const retentionMs = retentionDays() * DAY_MS;
	const cutoff = Date.now() - retentionMs;
	const roots = getMediaRoots();
	let purged = 0;

	for (let i = 0; i < roots.length; i++) {
		const root = roots[i];
		const trashRoot = path.join(root, '.trash');
		let names: string[];
		try {
			names = await fs.readdir(trashRoot);
		} catch {
			continue;
		}

		for (const name of names) {
			if (name.startsWith('.')) continue;
			const entryAbs = path.join(trashRoot, name);
			let st;
			try {
				st = await fs.stat(entryAbs);
			} catch {
				continue;
			}
			if (st.mtimeMs > cutoff) continue;

			const relRoot = `${i}/.trash/${name}`;
			let paths: string[];
			try {
				if (st.isDirectory()) {
					const nested = await collectNestedRelativePathsForTrash(entryAbs, relRoot);
					paths = nested.length > 0 ? nested : [relRoot];
				} else {
					paths = [relRoot];
				}
			} catch {
				paths = [relRoot];
			}

			await removeBrainIndicesForExpiredTrashPaths(paths, undefined).catch(() => undefined);
			await cleanTrashEntry(name, root).catch(() => undefined);
			purged++;
		}
	}

	return purged;
}

const SWEEP_INTERVAL_MS = DAY_MS;

setInterval(() => {
	purgeExpiredTrashFromMediaRoots().catch((err) => {
		console.warn('[trash-retention] sweep failed:', err);
	});
}, SWEEP_INTERVAL_MS).unref?.();

setTimeout(() => {
	purgeExpiredTrashFromMediaRoots().catch((err) => {
		console.warn('[trash-retention] initial sweep failed:', err);
	});
}, 120_000).unref?.();
