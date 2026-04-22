import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { env } from '$env/dynamic/private';
import { getMediaInfo, type MediaEntry } from '$lib/server/services/storage';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Base directory for all workspace file storage.
 * Defaults to `./workspace-data` relative to process cwd.
 * Each workspace gets a subdirectory: `<WORKSPACE_ROOT>/<workspaceId>/files/`
 */
function getWorkspaceRoot(): string {
	return env.WORKSPACE_ROOT?.trim() || path.join(process.cwd(), 'workspace-data');
}

// ---------------------------------------------------------------------------
// Path resolution & safety
// ---------------------------------------------------------------------------

function workspaceFilesDir(workspaceId: string): string {
	return path.join(getWorkspaceRoot(), workspaceId, 'files');
}

/**
 * Resolve a user-supplied relative path within a workspace's files directory.
 * Returns null if the path attempts traversal outside the workspace.
 */
export function resolveWorkspacePath(
	workspaceId: string,
	relativePath: string
): { fullPath: string; filesRoot: string } | null {
	const filesRoot = workspaceFilesDir(workspaceId);
	const cleaned = path.normalize((relativePath || '').replace(/^[/\\]+/, ''));
	const fullPath = path.resolve(filesRoot, cleaned || '.');

	// Prevent path traversal
	const resolvedRoot = path.resolve(filesRoot);
	if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
		return null;
	}

	return { fullPath, filesRoot: resolvedRoot };
}

// ---------------------------------------------------------------------------
// Directory operations
// ---------------------------------------------------------------------------

/** Ensure the workspace files directory exists. Called on workspace creation. */
export async function ensureWorkspaceDir(workspaceId: string): Promise<void> {
	await fs.mkdir(workspaceFilesDir(workspaceId), { recursive: true });
}

export async function listWorkspaceDirectory(
	workspaceId: string,
	relativePath: string = ''
): Promise<MediaEntry[]> {
	const resolved = resolveWorkspacePath(workspaceId, relativePath);
	if (!resolved) throw new Error('Invalid path');

	// Ensure dir exists
	try {
		await fs.access(resolved.fullPath);
	} catch {
		// If path doesn't exist yet, return empty
		return [];
	}

	const stat = await fs.stat(resolved.fullPath);
	if (!stat.isDirectory()) throw new Error('Not a directory');

	const dirents = await fs.readdir(resolved.fullPath, { withFileTypes: true });
	const entries: MediaEntry[] = [];

	for (const dirent of dirents) {
		if (dirent.name.startsWith('.')) continue;

		const fullPath = path.join(resolved.fullPath, dirent.name);
		const childRelative = relativePath ? path.join(relativePath, dirent.name) : dirent.name;
		const isDir = dirent.isDirectory();

		if (isDir) {
			const s = await fs.stat(fullPath);
			entries.push({
				name: dirent.name,
				path: childRelative,
				fullPath,
				type: 'directory',
				modified: s.mtime.toISOString()
			});
		} else {
			const { mediaType, mimeType } = getMediaInfo(dirent.name);
			const s = await fs.stat(fullPath);
			entries.push({
				name: dirent.name,
				path: childRelative,
				fullPath,
				type: 'file',
				mediaType,
				mimeType,
				size: s.size,
				modified: s.mtime.toISOString()
			});
		}
	}

	return entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

export async function readWorkspaceFile(
	workspaceId: string,
	relativePath: string
): Promise<Buffer> {
	const resolved = resolveWorkspacePath(workspaceId, relativePath);
	if (!resolved) throw new Error('Invalid path');
	return fs.readFile(resolved.fullPath);
}

export async function writeWorkspaceFile(
	workspaceId: string,
	relativePath: string,
	content: Buffer | Uint8Array | string
): Promise<{ fullPath: string; size: number }> {
	const resolved = resolveWorkspacePath(workspaceId, relativePath);
	if (!resolved) throw new Error('Invalid path');

	await fs.mkdir(path.dirname(resolved.fullPath), { recursive: true });
	await fs.writeFile(resolved.fullPath, content);

	const stat = await fs.stat(resolved.fullPath);
	return { fullPath: resolved.fullPath, size: stat.size };
}

export async function deleteWorkspaceFile(
	workspaceId: string,
	relativePath: string
): Promise<void> {
	const resolved = resolveWorkspacePath(workspaceId, relativePath);
	if (!resolved) throw new Error('Invalid path');

	const stat = await fs.stat(resolved.fullPath);
	if (stat.isDirectory()) {
		await fs.rm(resolved.fullPath, { recursive: true, force: true });
	} else {
		await fs.unlink(resolved.fullPath);
	}
}

export async function moveWorkspaceFile(
	workspaceId: string,
	fromPath: string,
	toPath: string
): Promise<void> {
	const from = resolveWorkspacePath(workspaceId, fromPath);
	const to = resolveWorkspacePath(workspaceId, toPath);
	if (!from || !to) throw new Error('Invalid path');

	await fs.mkdir(path.dirname(to.fullPath), { recursive: true });
	await fs.rename(from.fullPath, to.fullPath);
}

export async function copyWorkspaceFile(
	workspaceId: string,
	fromPath: string,
	toPath: string
): Promise<void> {
	const from = resolveWorkspacePath(workspaceId, fromPath);
	const to = resolveWorkspacePath(workspaceId, toPath);
	if (!from || !to) throw new Error('Invalid path');

	await fs.mkdir(path.dirname(to.fullPath), { recursive: true });
	await fs.cp(from.fullPath, to.fullPath, { recursive: true });
}

export async function mkdirInWorkspace(workspaceId: string, relativePath: string): Promise<void> {
	const resolved = resolveWorkspacePath(workspaceId, relativePath);
	if (!resolved) throw new Error('Invalid path');
	await fs.mkdir(resolved.fullPath, { recursive: true });
}

export async function getWorkspaceFileInfo(
	workspaceId: string,
	relativePath: string
): Promise<MediaEntry | null> {
	const resolved = resolveWorkspacePath(workspaceId, relativePath);
	if (!resolved) return null;

	try {
		const stat = await fs.stat(resolved.fullPath);
		const name = path.basename(resolved.fullPath);
		const isDir = stat.isDirectory();

		if (isDir) {
			return {
				name,
				path: relativePath,
				fullPath: resolved.fullPath,
				type: 'directory',
				modified: stat.mtime.toISOString()
			};
		}

		const { mediaType, mimeType } = getMediaInfo(name);
		return {
			name,
			path: relativePath,
			fullPath: resolved.fullPath,
			type: 'file',
			mediaType,
			mimeType,
			size: stat.size,
			modified: stat.mtime.toISOString()
		};
	} catch {
		return null;
	}
}

/** Remove all workspace file storage. Called on workspace deletion. */
export async function removeWorkspaceStorage(workspaceId: string): Promise<void> {
	const dir = path.join(getWorkspaceRoot(), workspaceId);
	await fs.rm(dir, { recursive: true, force: true });
}
