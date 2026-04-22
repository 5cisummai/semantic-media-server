/**
 * File extensions treated as plain text in the media viewer (preview + save).
 * MIME hints: see `storage.ts` (getMediaInfo).
 */
export const TEXT_EDITOR_EXTENSIONS: readonly string[] = [
	...new Set([
		// General & markup
		'adoc',
		'asciidoc',
		'bib',
		'cls',
		'cson',
		'csv',
		'diff',
		'htm',
		'html',
		'ipynb',
		'json',
		'json5',
		'jsonc',
		'latex',
		'ltx',
		'log',
		'markdown',
		'md',
		'mdx',
		'patch',
		'rst',
		'sty',
		'text',
		'tsv',
		'txt',
		'xhtml',
		'xml',
		'yaml',
		'yml',

		// Styles & web components
		'css',
		'less',
		'sass',
		'scss',
		'styl',
		'svelte',
		'vue',

		// JavaScript / TypeScript
		'cjs',
		'js',
		'jsx',
		'mjs',
		'mts',
		'cts',
		'ts',
		'tsx',

		// C / C++
		'c',
		'cc',
		'cpp',
		'cxx',
		'h',
		'hh',
		'hpp',
		'hxx',
		'idl',
		'inl',
		'ipp',

		// Systems & native
		'ada',
		'adb',
		'ads',
		'd',
		'di',
		'f',
		'f03',
		'f90',
		'f95',
		'for',
		'go',
		'nim',
		'rs',
		'v',
		'zig',

		// Shell & scripting
		'bash',
		'bat',
		'cmd',
		'fish',
		'ksh',
		'nu',
		'ps1',
		'psd1',
		'psm1',
		'sh',
		'zsh',

		// Python, Ruby, PHP, Lua, R, Julia
		'erb',
		'jl',
		'lua',
		'luau',
		'php',
		'phtml',
		'pl',
		'pm',
		'py',
		'pyi',
		'pyw',
		'r',
		'rb',

		// JVM / FP on JVM
		'clj',
		'cljc',
		'cljs',
		'edn',
		'gradle',
		'groovy',
		'java',
		'kt',
		'kts',
		'sc',
		'scala',

		// .NET
		'cs',
		'fs',
		'fsi',
		'fsx',
		'vb',

		// Swift / Obj-C
		'm',
		'mm',
		'swift',

		// Data / API DSLs
		'avsc',
		'graphql',
		'gql',
		'prisma',
		'proto',
		'sql',
		'thrift',
		'wat',

		// Config & tooling
		'bazel',
		'bzl',
		'cmake',
		'conf',
		'config',
		'containerignore',
		'dockerignore',
		'editorconfig',
		'env',
		'eslintrc',
		'gitattributes',
		'gitignore',
		'gni',
		'gn',
		'hcl',
		'ini',
		'mak',
		'mk',
		'nvmrc',
		'npmrc',
		'prettierrc',
		'properties',
		'tf',
		'tfvars',
		'toml',
		'yarnrc',

		// Haskell / ML / FP
		'elm',
		'erl',
		'ex',
		'exs',
		'gleam',
		'hrl',
		'hs',
		'lhs',
		'ml',
		'mli',

		// Lisps / small langs
		'cl',
		'coffee',
		'cr',
		'lisp',
		'lsp',
		'rkt',
		'scm',
		'sol',

		// Pascal / misc
		'dart',
		'pas',
		'pp',

		// TeX
		'tex'
	])
].sort((a, b) => a.localeCompare(b));

const textEditorExtensionSet = new Set(TEXT_EDITOR_EXTENSIONS);

export function isTextEditorExtension(ext: string): boolean {
	return textEditorExtensionSet.has(ext.toLowerCase());
}
