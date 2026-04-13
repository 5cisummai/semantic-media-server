import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { db } from '$lib/server/db';
import { deleteSemanticEntryByRelativePath } from '$lib/server/semantic';
import { resolveSafePath } from '$lib/server/services/storage';

export interface MutationUserContext {
	userId: string;
	isAdmin: boolean;
}

async function collectNestedRelativePaths(
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
			return collectNestedRelativePaths(childFull, childRel);
		})
	);
	return nested.flat();
}

async function canDeletePath(
	relativePath: string,
	stat: { isFile(): boolean; isDirectory(): boolean },
	ctx: MutationUserContext
): Promise<string | null> {
	const resolved = resolveSafePath(relativePath);
	if (!resolved) return 'Invalid path.';

	if (path.resolve(resolved.fullPath) === path.resolve(resolved.root)) {
		return 'Deleting a media root is not allowed.';
	}

	if (!stat.isFile() && !stat.isDirectory()) {
		return 'Only files and folders can be deleted.';
	}

	if (!ctx.isAdmin) {
		if (stat.isDirectory()) {
			return 'Only administrators can delete folders.';
		}
		const owned = await db.uploadedFile.findUnique({
			where: { relativePath },
			select: { uploadedById: true }
		});
		if (!owned || owned.uploadedById !== ctx.userId) {
			return 'You can only delete files you uploaded.';
		}
	}

	return null;
}

export async function deleteMediaPath(
	relativePath: string,
	ctx: MutationUserContext
): Promise<string> {
	const resolved = resolveSafePath(relativePath);
	if (!resolved) return `Error: invalid or out-of-scope path "${relativePath}".`;

	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(resolved.fullPath);
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			return `Error: path not found "${relativePath}".`;
		}
		throw err;
	}

	const deny = await canDeletePath(relativePath, stat, ctx);
	if (deny) return `Error: ${deny}`;

	const semanticPaths = await collectNestedRelativePaths(resolved.fullPath, relativePath);

	try {
		if (stat.isDirectory()) {
			await fs.rm(resolved.fullPath, { recursive: true });
		} else {
			await fs.unlink(resolved.fullPath);
		}
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			return `Error: path not found "${relativePath}".`;
		}
		throw err;
	}

	if (semanticPaths.length > 0) {
		await db.uploadedFile.deleteMany({
			where: { relativePath: { in: semanticPaths } }
		});
	}

	await Promise.allSettled(
		semanticPaths.map((p) => deleteSemanticEntryByRelativePath(p).catch(() => undefined))
	);

	return `Deleted successfully: ${relativePath}`;
}

function parseRootIndex(rel: string): number | null {
	const first = rel.split(path.sep)[0];
	if (!first || !/^\d+$/.test(first)) return null;
	return parseInt(first, 10);
}

export async function moveMediaPath(
	source: string,
	destination: string,
	ctx: MutationUserContext
): Promise<string> {
	const srcRes = resolveSafePath(source);
	const dstRes = resolveSafePath(destination);
	if (!srcRes) return `Error: invalid source path "${source}".`;
	if (!dstRes) return `Error: invalid destination path "${destination}".`;

	const srcRootIdx = parseRootIndex(source);
	const dstRootIdx = parseRootIndex(destination);
	if (srcRootIdx === null || dstRootIdx === null || srcRootIdx !== dstRootIdx) {
		return 'Error: move only supports paths within the same media root.';
	}

	let stat;
	try {
		stat = await fs.stat(srcRes.fullPath);
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			return `Error: source not found "${source}".`;
		}
		throw err;
	}

	const deny = await canDeletePath(source, stat, ctx);
	if (deny) return `Error: ${deny}`;

	try {
		await fs.access(dstRes.fullPath);
		return `Error: destination already exists "${destination}".`;
	} catch (err) {
		if (
			!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
		) {
			throw err;
		}
	}

	const dstParent = path.dirname(dstRes.fullPath);
	try {
		await fs.access(dstParent);
	} catch {
		return `Error: parent directory does not exist for "${destination}".`;
	}

	const uploads = await db.uploadedFile.findMany({
		where: {
			OR: [{ relativePath: source }, { relativePath: { startsWith: `${source}/` } }]
		},
		select: { relativePath: true }
	});

	const semanticToDrop = stat.isDirectory()
		? await collectNestedRelativePaths(srcRes.fullPath, source)
		: [source];
	await Promise.allSettled(
		semanticToDrop.map((p) => deleteSemanticEntryByRelativePath(p).catch(() => undefined))
	);

	await fs.rename(srcRes.fullPath, dstRes.fullPath);

	for (const row of uploads) {
		if (row.relativePath === source) {
			await db.uploadedFile.update({
				where: { relativePath: source },
				data: { relativePath: destination }
			});
		} else if (row.relativePath.startsWith(`${source}/`)) {
			const suffix = row.relativePath.slice(source.length);
			await db.uploadedFile.update({
				where: { relativePath: row.relativePath },
				data: { relativePath: `${destination}${suffix}` }
			});
		}
	}

	return `Moved successfully from "${source}" to "${destination}". Semantic search may be stale until you re-ingest the new path.`;
}

export async function moveManyMediaPaths(
	sources: string[],
	destinationDirectory: string,
	ctx: MutationUserContext
): Promise<string> {
	const normalizedSources = Array.from(
		new Set(sources.map((s) => s.trim()).filter((s) => s.length > 0))
	);
	if (normalizedSources.length === 0) {
		return 'Error: move requires at least one non-empty source path.';
	}

	const dstDirResolved = resolveSafePath(destinationDirectory);
	if (!dstDirResolved) {
		return `Error: invalid destination directory path "${destinationDirectory}".`;
	}

	try {
		const dstStat = await fs.stat(dstDirResolved.fullPath);
		if (!dstStat.isDirectory()) {
			return `Error: destination "${destinationDirectory}" is not a directory.`;
		}
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			return `Error: destination directory not found "${destinationDirectory}".`;
		}
		throw err;
	}

	const dstRootIdx = parseRootIndex(destinationDirectory);
	if (dstRootIdx === null) {
		return `Error: invalid destination root in "${destinationDirectory}".`;
	}

	for (const source of normalizedSources) {
		const srcRootIdx = parseRootIndex(source);
		if (srcRootIdx === null || srcRootIdx !== dstRootIdx) {
			return 'Error: move only supports moving paths within the same media root.';
		}
	}

	const baseDir = destinationDirectory.replace(/\/+$/g, '');
	const itemResults: string[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const source of normalizedSources) {
		const leafName = path.basename(source);
		const destinationPath = baseDir.length > 0 ? `${baseDir}/${leafName}` : leafName;
		const result = await moveMediaPath(source, destinationPath, ctx);
		itemResults.push(`- ${source} -> ${destinationPath}: ${result}`);
		if (result.startsWith('Error:')) {
			failureCount += 1;
		} else {
			successCount += 1;
		}
	}

	return [
		`Bulk move complete: ${successCount} succeeded, ${failureCount} failed.`,
		`Destination directory: "${destinationDirectory}"`,
		...itemResults
	].join('\n');
}

export async function copyMediaPath(
	source: string,
	destination: string,
	ctx: MutationUserContext
): Promise<string> {
	const srcRes = resolveSafePath(source);
	const dstRes = resolveSafePath(destination);
	if (!srcRes) return `Error: invalid source path "${source}".`;
	if (!dstRes) return `Error: invalid destination path "${destination}".`;

	const srcRootIdx = parseRootIndex(source);
	const dstRootIdx = parseRootIndex(destination);
	if (srcRootIdx === null || dstRootIdx === null || srcRootIdx !== dstRootIdx) {
		return 'Error: copy_file only supports paths within the same media root.';
	}

	let stat;
	try {
		stat = await fs.stat(srcRes.fullPath);
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			return `Error: source not found "${source}".`;
		}
		throw err;
	}

	if (stat.isDirectory() && !ctx.isAdmin) {
		return 'Error: only administrators can copy folders.';
	}

	if (!stat.isDirectory()) {
		const owned = await db.uploadedFile.findUnique({
			where: { relativePath: source },
			select: { uploadedById: true }
		});
		if (!ctx.isAdmin && (!owned || owned.uploadedById !== ctx.userId)) {
			return 'Error: you can only copy files you uploaded.';
		}
	}

	try {
		await fs.access(dstRes.fullPath);
		return `Error: destination already exists "${destination}".`;
	} catch (err) {
		if (
			!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
		) {
			throw err;
		}
	}

	const dstParent = path.dirname(dstRes.fullPath);
	try {
		await fs.access(dstParent);
	} catch {
		return `Error: parent directory does not exist for "${destination}".`;
	}

	if (stat.isDirectory()) {
		await fs.cp(srcRes.fullPath, dstRes.fullPath, { recursive: true });
	} else {
		await fs.copyFile(srcRes.fullPath, dstRes.fullPath);
	}

	return `Copied successfully from "${source}" to "${destination}". Run ingestion on the new path if you need it in search.`;
}

export async function mkdirMediaPath(relativePath: string): Promise<string> {
	if (!relativePath.trim()) return 'Error: path is required.';

	const resolved = resolveSafePath(relativePath);
	if (!resolved) return `Error: invalid or out-of-scope path "${relativePath}".`;

	try {
		await fs.mkdir(resolved.fullPath);
	} catch (e: unknown) {
		if (e instanceof Error) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === 'EEXIST') return `Error: a folder already exists at "${relativePath}".`;
			if (code === 'ENOENT') return 'Error: parent directory does not exist.';
		}
		return 'Error: failed to create folder.';
	}

	return `Created directory "${relativePath}".`;
}
