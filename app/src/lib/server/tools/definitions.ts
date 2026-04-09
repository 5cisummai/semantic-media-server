import type { LlmToolDefinition } from '$lib/server/services/llm';

const MEDIA_TYPE_ENUM = ['video', 'audio', 'image', 'document', 'other'] as const;

/** Tools that modify files; the server pauses until the user approves in the UI. */
export const TOOLS_REQUIRING_CONFIRMATION = new Set([
	'delete_file',
	'move_file',
	'move_files',
	'copy_file',
	'mkdir'
]);

export const ASK_TOOLS: LlmToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'search',
			description: 'Semantic search across indexed files in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Natural-language search query.'
					},
					mediaType: {
						type: 'string',
						enum: MEDIA_TYPE_ENUM,
						description: 'Optional media type filter.'
					},
					rootIndex: {
						type: 'number',
						description: 'Optional media root index to search.'
					},
					limit: {
						type: 'number',
						description: 'Maximum results to return.',
						default: 8
					},
					minScore: {
						type: 'number',
						description: 'Minimum similarity score threshold.',
						default: 0.5
					}
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'move_files',
			description:
				'Move many files/folders into a destination directory within the same media root in one action. Each source keeps its original name. Requires user confirmation.',
			parameters: {
				type: 'object',
				properties: {
					source_paths: {
						type: 'array',
						items: { type: 'string' },
						description:
							'List of source paths in rootIndex/path format (e.g. ["0/inbox/a.mp4", "0/inbox/b.mp4"]).'
					},
					destination_directory: {
						type: 'string',
						description: 'Existing destination directory in rootIndex/path format (e.g. "0/archive").'
					}
				},
				required: ['source_paths', 'destination_directory']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_directory',
			description:
				'List directory contents by path. Use empty string to list all configured media roots.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description:
							'Path in rootIndex/path format (for example "0/photos"), or empty string for root.'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_file_info',
			description: 'Get metadata for a single file or directory path.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path in rootIndex/path format.'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description:
				'Read text content from a file path. Returns text for supported text/PDF types only.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path in rootIndex/path format.'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_by_metadata',
			description:
				'Filter indexed files by metadata fields only (no semantic query embedding involved).',
			parameters: {
				type: 'object',
				properties: {
					mediaType: {
						type: 'string',
						enum: MEDIA_TYPE_ENUM,
						description: 'Optional media type filter.'
					},
					rootIndex: {
						type: 'number',
						description: 'Optional media root index.'
					},
					path_contains: {
						type: 'string',
						description: 'Optional case-insensitive path substring filter.'
					}
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'delete_file',
			description:
				'Permanently delete a file or folder under a media root. Requires user confirmation before it runs.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path in rootIndex/path format (e.g. "0/photos/old.jpg").'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'move_file',
			description:
				'Move or rename a file or folder within the same media root. Destination must not exist. Requires user confirmation.',
			parameters: {
				type: 'object',
				properties: {
					source_path: {
						type: 'string',
						description: 'Current path in rootIndex/path format.'
					},
					destination_path: {
						type: 'string',
						description: 'New path in the same root (e.g. move "0/a.txt" to "0/archive/a.txt").'
					}
				},
				required: ['source_path', 'destination_path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'copy_file',
			description:
				'Copy a file or folder to a new path within the same root. Destination must not exist. Requires user confirmation.',
			parameters: {
				type: 'object',
				properties: {
					source_path: { type: 'string', description: 'Source path in rootIndex/path format.' },
					destination_path: {
						type: 'string',
						description: 'Destination path in the same root.'
					}
				},
				required: ['source_path', 'destination_path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'mkdir',
			description:
				'Create a new directory under a media root. Parent must exist. Requires user confirmation.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Directory path to create (e.g. "0/incoming/2026").'
					}
				},
				required: ['path']
			}
		}
	}
];
