# Media Server — HTTP API Reference

This document describes the REST and streaming APIs exposed by the SvelteKit application under `app/`. All paths are relative to your deployment origin (for example `https://media.example.com`).

## Base URL and format

- **Prefix**: Routes live under `/api/...` unless noted.
- **Content type**: JSON request bodies use `Content-Type: application/json` unless noted (file uploads use `multipart/form-data`).
- **Character encoding**: UTF-8.

## Authentication

The server distinguishes **public** routes (no session) from **protected** routes. For protected routes, the client must present a valid **access JWT**.

### How to authenticate

1. **Bearer token (recommended for mobile / non-browser clients)**  
   Send the access token on each request:

   ```http
   Authorization: Bearer <accessToken>
   ```

2. **Refresh cookie (browser-oriented)**  
   After login or signup (when tokens are issued), an HTTP-only cookie `refreshToken` may be set. The server can resolve the user from this cookie when no `Authorization` header is present. Native apps typically use **login + Bearer** instead.

### Obtaining tokens

- `POST /api/auth/login` — returns `accessToken` in the JSON body; sets `refreshToken` cookie.
- `POST /api/auth/signup` — may return `accessToken` if the new user is auto-approved (e.g. first user); may set cookie in that case.
- `POST /api/auth/refresh` — returns a new `accessToken`; requires `refreshToken` cookie.

### Public routes

Only these paths are allowed **without** a logged-in user (see `hooks.server.ts`):

- `GET`/`POST` page routes: `/login`, `/signup` (not API).
- `POST /api/auth/login`
- `POST /api/auth/signup`

All other `/api/*` routes return **401** if neither a valid Bearer access token nor a valid refresh cookie establishes `locals.user`. The response body is typically JSON: `{ "error": "Unauthorized" }` for API routes blocked at the hook.

### Roles

Some endpoints require `role === 'ADMIN'`. The JWT payload includes `role` (`USER` or `ADMIN` depending on your schema).

---

## Path conventions (media files)

Paths are **client-safe relative paths**, not arbitrary filesystem paths.

- **Format**: `"{rootIndex}/{pathWithinRoot}"` where `rootIndex` is a non-negative integer indexing configured media roots (`MEDIA_ROOTS` in server env).
- **Examples**:
  - `"0"` — virtual root listing for drive `0` (see browse).
  - `"0/photos/vacation"` — folder or file under root `0`.
- The server resolves these via `resolveSafePath()` and rejects traversal outside the configured root.

---

## Error responses

Endpoints use SvelteKit `error(status, message)` or `json()` for success.

- **401** — Missing/invalid auth (or invalid credentials on login).
- **403** — Authenticated but not allowed (wrong role, ownership, etc.).
- **404** — Resource not found.
- **409** — Conflict (e.g. duplicate username, folder exists).
- **413** — Payload too large (upload).
- **416** — Range not satisfiable (streaming).

Error bodies are usually JSON with a `message` string (SvelteKit convention), except the global hook 401 for unauthenticated API access which may return `{ "error": "Unauthorized" }`. Clients should read the response body as JSON when `Content-Type` is `application/json`.

---

## API endpoints

### Auth — login

`POST /api/auth/login`

**Auth**: Public.

**Body**:

| Field      | Type   | Required |
|-----------|--------|----------|
| `username`| string | yes      |
| `password`| string | yes      |

**Success (200)**: JSON

| Field         | Type   |
|---------------|--------|
| `accessToken` | string |
| `role`        | string |
| `username`    | string |
| `displayName` | string |

Also sets `refreshToken` HTTP-only cookie (browser).

**Errors**: 400 invalid body, 401 invalid credentials, 403 account pending approval.

---

### Auth — signup

`POST /api/auth/signup`

**Auth**: Public.

**Body**:

| Field         | Type   | Required |
|---------------|--------|----------|
| `username`    | string | yes (min 3 chars) |
| `displayName` | string | yes      |
| `password`    | string | yes (min 8 chars) |

**Success (200)**: JSON may include `id`, `username`, `approved`, `role`, and `accessToken` if the user is auto-approved; cookie may be set in that case.

**Errors**: 400 validation, 409 username taken.

---

### Auth — current user

`GET /api/auth/me`

**Auth**: Required.

**Success (200)**: JSON user object:

| Field         | Type    |
|---------------|---------|
| `id`          | string  |
| `username`    | string  |
| `displayName` | string  |
| `role`        | string  |
| `approved`    | boolean |

**Errors**: 401, 404 user not found.

---

### Auth — refresh access token

`POST /api/auth/refresh`

**Auth**: Uses `refreshToken` cookie (not Bearer).

**Success (200)**:

```json
{ "accessToken": "<new JWT>" }
```

**Errors**: 401 if cookie missing or invalid.

---

### Auth — list pending users (admin)

`GET /api/auth/pending`

**Auth**: Required, **ADMIN**.

**Success (200)**: JSON array of `{ id, username, displayName, createdAt }`.

**Errors**: 401, 403.

---

### Auth — approve user (admin)

`POST /api/auth/approve`

**Auth**: Required, **ADMIN**.

**Body**: `{ "userId": "<string>" }`

**Success (200)**: `{ "success": true }`

**Errors**: 400, 401, 403, 404, 409 if already approved.

---

### Auth — reject pending user (admin)

`DELETE /api/auth/approve`

**Auth**: Required, **ADMIN**.

**Body**: `{ "userId": "<string>" }`

**Success (200)**: `{ "success": true }`

**Errors**: 400, 401, 403, 404, 409 if user already approved.

---

### Auth — list all users (admin)

`GET /api/auth/users`

**Auth**: Required, **ADMIN**.

**Success (200)**: JSON array of users with `id`, `username`, `displayName`, `role`, `approved`, `createdAt`.

---

### Storage — drives / roots info

`GET /api/storage`

**Auth**: Required (enforced by hook).

**Success (200)**: JSON array of drive info:

| Field          | Type    | Description |
|----------------|---------|-------------|
| `index`        | number  | Root index |
| `path`         | string  | Server path (internal) |
| `name`         | string  | Display name |
| `available`    | boolean | Whether stat succeeded |
| `totalBytes`   | number? | If available |
| `usedBytes`    | number? | If available |
| `freeBytes`    | number? | If available |
| `usedPercent`  | number? | If available |

---

### Browse — full tree

`GET /api/browse`

**Auth**: Required.

**Success (200)**: JSON array — recursive directory tree from `listDirectoryTree('')`. Entries omit `fullPath` from the underlying `MediaEntry` shape; may include nested `children` for directories.

---

### Browse — list single path

`GET /api/browse/[...path]`

**Auth**: Required.

**Path parameter**: `path` — URL-encoded path segments (e.g. `0/photos`). Empty segments may apply depending on routing.

**Success (200)**: JSON array of entries with `fullPath` stripped. Each entry includes fields such as `name`, `path`, `type` (`file` | `directory`), optional `mediaType`, `size`, `modified`, `mimeType`.

**Errors**: 500 with message on failure (e.g. invalid path).

---

### Semantic search

`GET /api/search`

**Auth**: Required.

**Query parameters**:

| Param       | Type   | Required | Description |
|------------|--------|----------|-------------|
| `q`        | string | yes      | Search query (embedded search) |
| `mediaType`| string | no       | One of: `video`, `audio`, `image`, `document`, `other` |
| `root`     | number | no       | Media root index |
| `limit`    | number | no       | Max results |
| `minScore` | number | no       | Minimum similarity score |

**Success (200)**:

```json
{
  "query": "<string>",
  "count": <number>,
  "results": [ /* SearchResult[] */ ]
}
```

Each **SearchResult** item:

| Field        | Type   |
|-------------|--------|
| `id`        | string |
| `score`     | number |
| `name`      | string |
| `path`      | string |
| `type`      | `"file"` |
| `mediaType` | string |
| `mimeType`  | string? |
| `size`      | number? |
| `modified`  | string? |
| `rootIndex` | number |

**Errors**: 400 if `q` missing, 500 on search failure.

---

### Reindex semantic collection (admin)

`POST /api/search/reindex`

**Auth**: Required, **ADMIN**.

**Success (200)**:

```json
{
  "success": true,
  "summary": {
    "totalFiles": <number>,
    "indexed": <number>,
    "skipped": <number>,
    "deleted": <number>,
    "imageContentEmbeddingsUsed": <number>
  }
}
```

**Errors**: 403, 500.

---

### Brain — ask (agent + tools)

`POST /api/brain/ask`

**Auth**: Required.

Runs a **server-side agent loop** (up to 20 iterations) with tool calling (`search_files`, `list_directory`, `get_file_info`, `read_file`, `search_by_metadata`). The same pipeline runs for both JSON and streaming modes.

**Body**:

| Field       | Type    | Required | Description |
|------------|---------|----------|-------------|
| `question` | string  | yes      | User question |
| `history`  | array   | no       | Prior turns; see **LlmMessage** below |
| `filters`  | object  | no       | Default scope for `search_files` tool |
| `stream`   | boolean | no       | If `true`, NDJSON stream; if false/omitted, single JSON response |

**filters** (optional; defaults applied when the model calls `search_files` without overriding):

| Field       | Type   | Description |
|------------|--------|-------------|
| `mediaType`| string | Optional media type filter |
| `rootIndex`| number | Optional root index |
| `fileIds`  | string[] | Present in API; tool path may not use directly — reserved for future scoping |
| `limit`    | number | Default **8** if omitted |
| `minScore` | number | Default **0.5** if omitted |

**LlmMessage** (for `history`):

| Field           | Type   | Description |
|----------------|--------|-------------|
| `role`         | `"user"` \| `"assistant"` \| `"system"` \| `"tool"` | Server normalizes history to user/assistant only for the agent turn |
| `content`      | string | Message text |
| `tool_call_id` | string | Optional (tool role) |
| `name`         | string | Optional (tool role) |
| `tool_calls`   | unknown| Optional (assistant with tool calls) |

Clients may send only `{ role, content }` pairs for `user` and `assistant`.

#### Response — `stream: false` (default)

**Success (200)**: `Content-Type: application/json`

| Field         | Type   | Description |
|---------------|--------|-------------|
| `answer`      | string | Final assistant text |
| `sources`     | array  | Accumulated from `search_files` tool calls |
| `filters`     | object | Echo of normalized filters |
| `model`       | string | LLM model id from env |
| `toolCalls`   | array  | Tool invocations summary |
| `iterations`  | number | Agent loop iterations used |

**Source** item:

| Field       | Type   |
|------------|--------|
| `fileId`   | string |
| `filePath` | string |
| `chunk`    | string |
| `score`    | number |

**toolCalls** item:

| Field            | Type   |
|-----------------|--------|
| `tool`           | string |
| `args`           | object |
| `resultSummary`  | string |

#### Response — `stream: true`

**Success (200)**:

- `Content-Type: application/x-ndjson; charset=utf-8`
- **Newline-delimited JSON** (one JSON object per line).

Line types:

| `type`   | Description |
|----------|-------------|
| `meta`   | First meaningful line: includes `sources`, `filters`, `model`, `toolCalls`, `iterations` (same as non-stream final metadata) |
| `delta`  | `{ "type": "delta", "text": "<chunk>" }` — concatenated `text` forms the full `answer` |
| `done`   | `{ "type": "done" }` — stream complete |
| `error`  | `{ "type": "error", "message": "<string>" }` — terminal error in stream |

**Note**: Streaming runs the full agent on the server first, then chunks the final `answer` for compatibility with clients that expect incremental text. Metadata reflects the completed agent run.

**Errors**: 400 missing `question`, 401, 500.

---

### Stream file (media)

`GET /api/stream/[...path]`

**Auth**: Required (hook).

**Path**: Media file path, e.g. `0/videos/movie.mp4`.

**Headers**:

- Optional `Range: bytes=start-end` for partial content (video/audio seeking).

**Success**:

- **200** — Full file: `Content-Type` from detected MIME, `Content-Length`, `Accept-Ranges: bytes`, `Cache-Control: no-store`.
- **206** — Partial content with `Content-Range`.

**Errors**: 400 invalid path or not a file, 404 not found, 416 bad range.

`GET /api/stream` (no path) returns **400** “No path provided”.

---

### Upload file

`POST /api/upload`

**Auth**: Required.

**Content-Type**: `multipart/form-data`

**Fields**:

| Field         | Type | Required | Description |
|---------------|------|----------|-------------|
| `file`        | file | yes      | File binary |
| `destination` | string | yes    | Relative directory path (e.g. `0/uploads`) where the file should be written |

**Success (200)**:

```json
{
  "success": true,
  "name": "<sanitized filename>",
  "relativePath": "<destination>/<name>"
}
```

**Errors**: 400 missing fields / invalid path / bad filename, 401, 413 too large (see `MAX_UPLOAD_SIZE` env).

---

### Upload — index paths (semantic filename index)

`POST /api/upload/index`

**Auth**: Required (hook; no extra role in handler).

**Body**:

```json
{
  "paths": ["0/foo.txt", "0/bar.pdf"]
}
```

**Success (200)**:

```json
{
  "indexed": <number>,
  "failed": <number>,
  "failures": ["<paths that rejected>"]
}
```

---

### Delete file or folder

`DELETE /api/delete/[...path]`

**Auth**: Required.

**Behavior**:

- Cannot delete a media root directory itself (403).
- **Non-admin**: may delete **files** only if the file is recorded as uploaded by the current user; **cannot** delete directories.
- **Admin**: may delete files and directories.

Also removes matching `uploadedFile` rows and attempts semantic index cleanup for affected paths.

**Success (200)**: `{ "success": true }`

**Errors**: 400, 401, 403, 404.

---

### Create directory

`POST /api/mkdir/[...path]`

**Auth**: Required (hook; handler does not check role).

**Path**: Parent must exist; creates the leaf directory named in the path.

**Success (200)**: `{ "success": true }`

**Errors**: 400 missing/invalid path, 409 folder exists, 400 parent missing, 500.

---

### Ingest — single file (chunks + embeddings)

`POST /api/ingest/file`

**Auth**: Required.

**Body**: `{ "path": "<relativePath>" }` — file to ingest into the ingest collection (text/PDF pipeline per server implementation).

**Success (200)**: `{ "success": true, "summary": { ... } }` — summary includes counters such as `filesIndexed`, `chunksIndexed`, `collection`, etc. (see `IngestSummary` in `ingestion.ts`).

**Errors**: 400, 401, 500.

---

### Ingest — directory (admin)

`POST /api/ingest/directory`

**Auth**: Required, **ADMIN**.

**Body**: `{ "rootIndex": <integer> }`

**Success (200)**: `{ "success": true, "summary": { ... } }`

**Errors**: 400, 403, 500.

---

## Agent tools (server-side)

Tool schemas are defined in `app/src/lib/server/tools/definitions.ts`. The LLM may call:

| Tool                 | Purpose |
|----------------------|---------|
| `search_files`       | Semantic search over the filename/metadata index (`semanticSearch`) |
| `list_directory`     | List folder contents (`list_directory`) |
| `get_file_info`      | File or directory metadata |
| `read_file`          | Read text-oriented file content where supported |
| `search_by_metadata` | Filter vector DB by metadata without a semantic query |

Clients do not invoke these directly; they are used inside `POST /api/brain/ask`.

---

## Mobile (iOS) integration notes

1. **Login**: `POST /api/auth/login` → store `accessToken` securely (Keychain).
2. **Calls**: Send `Authorization: Bearer <accessToken>` on every `/api/*` request except login/signup.
3. **Refresh**: Either implement cookie jar for `POST /api/auth/refresh`, or re-login when access JWT expires (depends on your JWT expiry settings in `auth`).
4. **Brain**: Use `POST /api/brain/ask` with JSON or NDJSON streaming as documented; **no need to reimplement** search/browse/read logic on the client.
5. **Paths**: Always use `rootIndex/...` paths as returned by browse/upload APIs.

---

## Changelog

Document significant API changes in your release notes; this file reflects the implementation in the repository at the time of writing.
