import fs from 'node:fs/promises';
import * as path from '$lib/server/paths';
import { env } from '$env/dynamic/private';

export type MediaType = 'video' | 'audio' | 'image' | 'document' | 'other';

export interface MediaEntry {
	name: string;
	path: string; // relative path from a media root (safe to expose)
	fullPath: string; // absolute path on disk (never expose to client)
	type: 'file' | 'directory';
	mediaType?: MediaType;
	size?: number;
	modified?: string;
	mimeType?: string;
}

export interface DriveInfo {
	index: number;
	path: string;
	name: string;
	available: boolean;
	totalBytes?: number;
	usedBytes?: number;
	freeBytes?: number;
	usedPercent?: number;
}

const MEDIA_EXTENSIONS: Record<string, { mediaType: MediaType; mimeType: string }> = {
	// Video
	mp4: { mediaType: 'video', mimeType: 'video/mp4' },
	mkv: { mediaType: 'video', mimeType: 'video/x-matroska' },
	webm: { mediaType: 'video', mimeType: 'video/webm' },
	avi: { mediaType: 'video', mimeType: 'video/x-msvideo' },
	mov: { mediaType: 'video', mimeType: 'video/quicktime' },
	// Audio
	mp3: { mediaType: 'audio', mimeType: 'audio/mpeg' },
	flac: { mediaType: 'audio', mimeType: 'audio/flac' },
	ogg: { mediaType: 'audio', mimeType: 'audio/ogg' },
	wav: { mediaType: 'audio', mimeType: 'audio/wav' },
	aac: { mediaType: 'audio', mimeType: 'audio/aac' },
	m4a: { mediaType: 'audio', mimeType: 'audio/mp4' },
	// Images
	jpg: { mediaType: 'image', mimeType: 'image/jpeg' },
	jpeg: { mediaType: 'image', mimeType: 'image/jpeg' },
	png: { mediaType: 'image', mimeType: 'image/png' },
	gif: { mediaType: 'image', mimeType: 'image/gif' },
	webp: { mediaType: 'image', mimeType: 'image/webp' },
	avif: { mediaType: 'image', mimeType: 'image/avif' },
	svg: { mediaType: 'image', mimeType: 'image/svg+xml' },
	// Documents
	pdf: { mediaType: 'document', mimeType: 'application/pdf' },
	epub: { mediaType: 'document', mimeType: 'application/epub+zip' },
	cbz: { mediaType: 'document', mimeType: 'application/zip' },
	cbr: { mediaType: 'document', mimeType: 'application/x-rar-compressed' }
};

// Parse MEDIA_ROOTS from env — supports multiple comma-separated paths
export function getMediaRoots(): string[] {
	const raw = env.MEDIA_ROOTS ?? '';
	return raw
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
}

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
	const resolvedRoot = path.resolve(rootPath);
	const resolvedCandidate = path.resolve(candidatePath);
	return (
		resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
	);
}

// Resolve a client-supplied relative path safely — prevents path traversal attacks
export function resolveSafePath(relativePath: string): { fullPath: string; root: string } | null {
	const roots = getMediaRoots();
	if (roots.length === 0) return null;

	// Strip leading slashes, normalize
	const cleaned = path.normalize(relativePath.replace(/^[/\\]+/, ''));

	// Determine which root this path belongs to by prefix
	// Path format from client: "rootIndex/rest/of/path"
	const [rootIndexStr, ...rest] = cleaned.split(path.sep);
	if (!/^\d+$/.test(rootIndexStr ?? '')) {
		return null;
	}

	const rootIndex = parseInt(rootIndexStr, 10);

	if (isNaN(rootIndex) || rootIndex < 0 || rootIndex >= roots.length) {
		return null;
	}

	const root = path.resolve(roots[rootIndex]);
	const relative = rest.join(path.sep);
	const fullPath = path.resolve(root, relative || '.');

	// Security: ensure resolved path is still inside the root
	if (!isPathInsideRoot(fullPath, root)) {
		return null;
	}

	return { fullPath, root };
}

export function getMediaInfo(filename: string) {
	const ext = path.extname(filename).slice(1).toLowerCase();
	return (
		MEDIA_EXTENSIONS[ext] ?? {
			mediaType: 'other' as MediaType,
			mimeType: 'application/octet-stream'
		}
	);
}

export async function getStorageDrives(): Promise<DriveInfo[]> {
	const roots = getMediaRoots();

	return Promise.all(
		roots.map(async (root, index) => {
			const name = path.basename(root) || root;

			try {
				const stat = await fs.statfs(root);
				const totalBytes = stat.blocks * stat.bsize;
				const freeBytes = stat.bfree * stat.bsize;
				const usedBytes = totalBytes - freeBytes;
				const usedPercent = Math.round((usedBytes / totalBytes) * 100);

				return {
					index,
					path: root,
					name,
					available: true,
					totalBytes,
					usedBytes,
					freeBytes,
					usedPercent
				} satisfies DriveInfo;
			} catch {
				return {
					index,
					path: root,
					name,
					available: false
				} satisfies DriveInfo;
			}
		})
	);
}

// List contents of a directory path (relative, client-safe)
export type ClientMediaEntry = Omit<MediaEntry, 'fullPath'> & {
	children?: ClientMediaEntry[];
};

export async function listDirectory(relativePath: string): Promise<MediaEntry[]> {
	const roots = getMediaRoots();
	if (roots.length === 0) throw new Error('No media roots configured');

	// Root-level: merge all roots into one virtual directory
	if (!relativePath || relativePath === '/') {
		const entries: MediaEntry[] = [];
		for (let i = 0; i < roots.length; i++) {
			try {
				const stat = await fs.stat(roots[i]);
				entries.push({
					name: path.basename(roots[i]),
					path: `${i}`,
					fullPath: roots[i],
					type: 'directory',
					modified: stat.mtime.toISOString()
				});
			} catch {
				// Drive not available — skip silently
			}
		}
		return entries;
	}

	const resolved = resolveSafePath(relativePath);
	if (!resolved) throw new Error('Invalid path');

	const dirents = await fs.readdir(resolved.fullPath, { withFileTypes: true });
	const entries: MediaEntry[] = [];

	for (const dirent of dirents) {
		if (dirent.name.startsWith('.')) continue; // skip hidden files

		const fullPath = path.join(resolved.fullPath, dirent.name);
		const childRelative = path.join(relativePath, dirent.name);
		const isDir = dirent.isDirectory();

		if (isDir) {
			const stat = await fs.stat(fullPath);
			entries.push({
				name: dirent.name,
				path: childRelative,
				fullPath,
				type: 'directory',
				modified: stat.mtime.toISOString()
			});
		} else {
			const { mediaType, mimeType } = getMediaInfo(dirent.name);
			const stat = await fs.stat(fullPath);
			entries.push({
				name: dirent.name,
				path: childRelative,
				fullPath,
				type: 'file',
				mediaType,
				mimeType,
				size: stat.size,
				modified: stat.mtime.toISOString()
			});
		}
	}

	// Directories first, then files, both alphabetical
	return entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

export async function listDirectoryTree(relativePath: string): Promise<ClientMediaEntry[]> {
	const entries = await listDirectory(relativePath);

	return await Promise.all(
		entries.map(async (entry) => {
			const { fullPath, ...safeEntry } = entry;
			if (entry.type === 'directory') {
				return {
					...safeEntry,
					children: await listDirectoryTree(entry.path)
				};
			}

			return safeEntry;
		})
	);
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const TEXT_EXTENSIONS = new Set([
	'txt',
	'md',
	'markdown',
	'json',
	'xml',
	'html',
	'htm',
	'css',
	'js',
	'ts',
	'py',
	'rb',
	'go',
	'rs',
	'java',
	'c',
	'cpp',
	'h',
	'hpp',
	'cs',
	'swift',
	'kt',
	'scala',
	'sh',
	'bash',
	'zsh',
	'ps1',
	'bat',
	'cmd',
	'sql',
	'yml',
	'yaml',
	'toml',
	'ini',
	'cfg',
	'conf',
	'log',
	'csv',
	'svg',
	'tex',
	'r',
	'lua',
	'pl',
	'pm',
	'php',
	'vue',
	'svelte',
	'jsx',
	'tsx',
	'graphql',
	'gql',
	'proto',
	'dockerfile',
	'gitignore',
	'env',
	'editorconfig',
	'yaml'
]);

export async function readFileContent(
	fullPath: string,
	mediaType: MediaType
): Promise<string | null> {
	if (mediaType === 'video' || mediaType === 'audio' || mediaType === 'image') {
		return null;
	}

	const ext = path.extname(fullPath).slice(1).toLowerCase();

	if (TEXT_EXTENSIONS.has(ext)) {
		const content = await fs.readFile(fullPath, 'utf-8');
		return content.slice(0, 50000);
	}

	if (ext === 'pdf') {
		return await extractPdfText(fullPath);
	}

	return null;
}

async function extractPdfText(fullPath: string): Promise<string | null> {
	try {
		const { PDFParse } = await import('pdf-parse');
		const buffer = await fs.readFile(fullPath);
		const parser = new PDFParse({ data: new Uint8Array(buffer) });
		const result = await parser.getText();
		const text = result.text?.trim();
		parser.destroy();
		return text ? text.slice(0, 50000) : null;
	} catch {
		return null;
	}
}
