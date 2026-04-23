// ---------------------------------------------------------------------------
// brain-cleanup.ts — Remove media paths from filename semantic + ingest Qdrant
// ---------------------------------------------------------------------------

import * as path from '$lib/server/paths';
import { db } from '$lib/server/db';
import { FsOperation } from '@prisma/client';
import { deleteIngestChunksByRelativePaths, deleteIngestChunksUnderPathPrefix } from '$lib/server/services/ingestion';
import {
	deleteSemanticEntriesUnderPathPrefix,
	deleteSemanticEntryByRelativePath
} from '$lib/server/semantic';
import type { DeletePayload } from '$lib/server/fs-history';

const TRASH_PATH_RE = /^(\d+)\/\.trash\/([^/]+)(?:\/(.*))?$/;

/** Remove filename-index + ingest chunks for exact media client paths. */
export async function removeIndexedMediaByExactPaths(
	paths: string[],
	workspaceId?: string
): Promise<void> {
	const uniq = [...new Set(paths.map((p) => p.replace(/^\/+/, '').replace(/\\/g, '/')))].filter(
		(p) => p.length > 0
	);
	if (uniq.length === 0) return;

	await Promise.allSettled(
		uniq.map((p) => deleteSemanticEntryByRelativePath(p, workspaceId).catch(() => undefined))
	);
	await deleteIngestChunksByRelativePaths(uniq, workspaceId).catch(() => undefined);
}

/** Remove any indexed points whose payload `path` equals `prefix` or is under that folder. */
export async function removeIndexedMediaUnderPathPrefix(
	prefix: string,
	workspaceId?: string
): Promise<void> {
	const normalized = prefix.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '');
	if (!normalized) return;

	await Promise.allSettled([
		deleteSemanticEntriesUnderPathPrefix(normalized, workspaceId).catch(() => undefined),
		deleteIngestChunksUnderPathPrefix(normalized, workspaceId).catch(() => undefined)
	]);
}

function normalizeClientPath(p: string): string {
	return p.replace(/^\/+/, '').replace(/\\/g, '/');
}

async function lookupOriginalPathForTrashKey(trashKey: string): Promise<string | null> {
	const row = await db.fileSystemAction.findFirst({
		where: {
			operation: FsOperation.DELETE,
			payload: { path: ['trashKey'], equals: trashKey }
		},
		orderBy: { createdAt: 'desc' },
		select: { payload: true }
	});
	if (!row) return null;
	const p = row.payload as unknown as DeletePayload;
	return typeof p.relativePath === 'string' ? normalizeClientPath(p.relativePath) : null;
}

/**
 * Map on-disk trash client paths (e.g. `0/.trash/<uuid>/file`) back to original media paths
 * using DELETE history payloads, then dedupe subtree vs file cleanup.
 */
export async function resolveTrashPurgeBrainTargets(trashRelativePaths: string[]): Promise<{
	exactFiles: string[];
	subtreePrefixes: string[];
}> {
	const exact = new Set<string>();
	const subtree = new Set<string>();

	for (const raw of trashRelativePaths) {
		const trashPath = normalizeClientPath(raw);
		const m = trashPath.match(TRASH_PATH_RE);
		if (!m) continue;

		const rootIdx = m[1];
		const trashKey = m[2];
		const innerRaw = (m[3] ?? '').replace(/^\/+/, '').replace(/\/+$/, '');

		const originalBase = await lookupOriginalPathForTrashKey(trashKey);
		if (!originalBase) continue;

		const base = path.basename(originalBase);

		if (innerRaw === '') {
			subtree.add(originalBase);
			continue;
		}

		if (innerRaw === base || innerRaw === `${base}/`) {
			subtree.add(originalBase);
			continue;
		}

		if (innerRaw.startsWith(base + '/')) {
			const rest = innerRaw.slice(base.length + 1).replace(/^\/+/, '');
			const mapped = rest ? `${originalBase}/${rest}` : originalBase;
			exact.add(mapped);
			continue;
		}
	}

	for (const s of subtree) {
		for (const e of [...exact]) {
			if (e === s || e.startsWith(s + '/')) exact.delete(e);
		}
	}

	return { exactFiles: [...exact], subtreePrefixes: [...subtree] };
}

/** Purge Qdrant rows for a trash retention sweep (paths under `N/.trash/...` on disk). */
export async function removeBrainIndicesForExpiredTrashPaths(
	trashRelativePaths: string[],
	workspaceId?: string
): Promise<void> {
	const { exactFiles, subtreePrefixes } = await resolveTrashPurgeBrainTargets(trashRelativePaths);
	for (const p of subtreePrefixes) {
		await removeIndexedMediaUnderPathPrefix(p, workspaceId).catch(() => undefined);
	}
	if (exactFiles.length > 0) {
		await removeIndexedMediaByExactPaths(exactFiles, workspaceId).catch(() => undefined);
	}
}
