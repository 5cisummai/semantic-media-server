/**
 * Unified path utilities — all operations normalize to posix (forward-slash) format.
 *
 * Uses `path.posix.*` for join/normalize/dirname/basename/extname so separators
 * are always `/` regardless of the host OS. Input backslashes are converted to
 * forward slashes before being passed to posix methods.
 *
 * `resolve` still delegates to the native `nodePath.resolve` (so it correctly
 * handles Windows drive letters), then converts the result to posix.
 *
 * Node.js `fs` accepts forward slashes on all platforms, so posix absolute paths
 * (e.g. `C:/foo/bar`) work correctly with `fs.*` APIs on Windows.
 */
import nodePath from 'node:path';

/** Convert any platform path to posix by replacing backslashes with forward slashes. */
export function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}

/** Join path segments and return a posix-normalized path. */
export function join(...segments: string[]): string {
	return nodePath.posix.join(...segments.map(toPosix));
}

/** Normalize a path (resolve `.` / `..`) and return posix format. */
export function normalize(p: string): string {
	return nodePath.posix.normalize(toPosix(p));
}

/**
 * Resolve segments to an absolute path, returned in posix format.
 * Uses native `nodePath.resolve` so Windows drive letters are handled correctly,
 * then converts the result to posix.
 */
export function resolve(...segments: string[]): string {
	return toPosix(nodePath.resolve(...segments));
}

/** Get the directory component of a path, returned in posix format. */
export function dirname(p: string): string {
	return nodePath.posix.dirname(toPosix(p));
}

/** Get the last component of a path. */
export function basename(p: string, ext?: string): string {
	return nodePath.posix.basename(toPosix(p), ext);
}

/** Get the file extension including the leading dot. */
export function extname(p: string): string {
	return nodePath.posix.extname(toPosix(p));
}

/** Path separator — always posix. */
export const sep = '/';
