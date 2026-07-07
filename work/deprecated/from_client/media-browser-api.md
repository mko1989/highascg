# Media browser file ops API (server handoff)

Client UI: **Sources → Media** (`client/components/sources-panel.js`, `client/components/sources-panel-media.js`).

The web client provides a folder tree browser with multi-select, copy, move, delete, and drag-and-drop onto folders. All filesystem work happens on the **playout server** (Caspar media directory). The browser does not access local disk paths directly except via existing download routes.

Implementation on the client: `client/lib/media-file-ops.js`.

---

## Requirements

| Item | Notes |
|------|--------|
| Media root | Same directory Caspar uses for clip paths (typically under the server’s configured media folder). |
| Path identity | `id` / `sourceId` values are **Caspar-relative** paths using `/` separators, e.g. `clips/intro.mov`, `folder/sub/clip.mp4`. No leading slash. |
| Folders | Represented as `isDir: true` rows in `GET /api/media` **and/or** implied by file path prefixes. Folder delete uses the folder path as `id`. |
| After mutations | Client calls `POST /api/media/refresh` then `GET /api/media` to rescan. Endpoints should leave disk in a consistent state before responding. |
| Collisions | If destination file already exists, return **409** with `{ "error": "..." }` (client shows partial-failure status on batch). |

---

## Path semantics (move / copy)

| Field | Meaning |
|-------|---------|
| `sourceId` | Full media path of the file to act on, e.g. `archive/old.mov` |
| `sourceIds` | Batch variant — array of full paths |
| `targetId` | **Destination folder** path, not the final filename. Empty string `""` = media root. |
| Result path | Server should place the file at `{targetId}/{basename(sourceId)}`, e.g. source `clips/foo.mov` + target `archive` → `archive/foo.mov`. |

Copy must not remove the source. Move must remove the source after a successful write (same volume rename is fine).

**Invalid operations** (return 400):

- Moving/copying a folder via file ops (client only selects files for batch toolbar; folder delete is separate).
- `targetId` equal to the file’s current parent with no name change (no-op move) — may return 200 or 400.
- Moving into a descendant folder, e.g. source `a/b/c.mov` → target `a/b`.

---

## Client call strategy

For **move**, **copy**, and **delete**, the client tries a **batch** body first, then falls back to **per-item** requests if the batch call fails (network error, 404 route missing, or `ok: false`).

| Operation | Batch body (preferred) | Fallback body (per item) |
|-----------|----------------------|---------------------------|
| Move | `{ "sourceIds": ["a.mov","b.mov"], "targetId": "archive" }` | `{ "sourceId": "a.mov", "targetId": "archive" }` |
| Copy | `{ "sourceIds": ["a.mov"], "targetId": "backup" }` | `{ "sourceId": "a.mov", "targetId": "backup" }` |
| Delete | `{ "ids": ["a.mov","folder/sub"] }` | `{ "id": "a.mov" }` |

Batch responses should include a count field the client reads (any one is accepted):

- Move: `moved` or `count`
- Copy: `copied` or `count`
- Delete: `deleted` or `count`

If `ok` is omitted or `true`, the client treats the batch as successful.

---

## Endpoints

### `GET /api/media`

Already used for listing. The **folder picker** and tree browser depend on:

```json
{
  "media": [
    { "id": "clips", "label": "clips", "isDir": true },
    { "id": "clips/intro.mov", "label": "intro.mov", "isDir": false, "resolution": "1920x1080", "durationMs": 5000 }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Caspar-relative path (file or folder) |
| `label` | no | Display name; defaults to `id` |
| `isDir` | folders | `true` for directory rows |
| `resolution`, `durationMs`, `fps`, `codec` | no | Probe metadata for UI |

Alternative top-level shape (also accepted): bare array instead of `{ "media": [...] }`.

**Folder tree rules:**

- Emit explicit `isDir` rows for folders when possible.
- File `id` paths must use `/`; the client derives parent folders from prefixes when `isDir` rows are missing.
- Folder path casing should be stable across refresh (client dedupes case-insensitively but prefers disk casing).

---

### `POST /api/media/mkdir`

Create a folder (used from **+ → New Folder…** and before copy/move when the picker creates a new subfolder).

**Body:**

```json
{ "path": "archive/2026" }
```

| Field | Description |
|-------|-------------|
| `path` | Folder path relative to media root. May contain `/` for nested creation (recommended). |

**Response `200`:**

```json
{ "ok": true, "path": "archive/2026" }
```

**Errors:**

| Status | When |
|--------|------|
| 400 | Invalid path (`..`, absolute path, empty) |
| 409 | Folder already exists (client may ignore — mkdir is best-effort before transfer) |

---

### `POST /api/media/move`

Move one or more files into a destination folder.

**Body (single):**

```json
{ "sourceId": "clips/intro.mov", "targetId": "archive" }
```

**Body (batch):**

```json
{ "sourceIds": ["clips/a.mov", "clips/b.mov"], "targetId": "archive" }
```

**Response `200`:**

```json
{ "ok": true, "moved": 2 }
```

Optional per-file detail:

```json
{
  "ok": true,
  "moved": 1,
  "failed": 1,
  "errors": [{ "id": "clips/b.mov", "error": "file not found" }]
}
```

Client batch helper only checks aggregate `moved`/`count` on full success; partial batch failure should use `ok: false` or non-2xx so the client retries per file.

**Errors (single-item):**

| Status | When |
|--------|------|
| 400 | Missing `sourceId` / bad `targetId` |
| 404 | Source file not found |
| 409 | Destination file already exists |

---

### `POST /api/media/copy` *(new — required for Copy UI)*

Same contract as **move**, but copies bytes and leaves sources intact.

**Body (single):**

```json
{ "sourceId": "clips/intro.mov", "targetId": "backup" }
```

**Body (batch):**

```json
{ "sourceIds": ["clips/a.mov", "clips/b.mov"], "targetId": "backup" }
```

**Response `200`:**

```json
{ "ok": true, "copied": 2 }
```

(`count` is also accepted.)

**Errors:** Same as move (404 source, 409 collision).

If this route is missing (**404**), the client falls back to per-file POSTs; copy remains broken until implemented.

---

### `POST /api/media/delete`

Delete a file or folder (recursive for folders).

**Body (single):**

```json
{ "id": "clips/old.mov" }
```

**Body (batch):**

```json
{ "ids": ["clips/a.mov", "clips/b.mov"] }
```

Folder delete (from folder row 🗑 in UI):

```json
{ "id": "archive/2026" }
```

Server should delete the directory and all contents.

**Response `200`:**

```json
{ "ok": true, "deleted": 3 }
```

**Errors:**

| Status | When |
|--------|------|
| 400 | Missing `id` / `ids` |
| 404 | Path not found |
| 409 | File in use (optional) |

---

### `POST /api/media/refresh`

Rescan media folder and update Caspar clip index / probe cache. Called after copy, move, delete, ingest.

**Body (optional):**

```json
{ "ensureHqThumbs": true }
```

**Response:** `{ "ok": true }` or similar. Client does not depend on response shape beyond success.

---

## Related endpoints (unchanged)

| Route | Use |
|-------|-----|
| `GET /api/local-media/:id/file` | Download single file (⌘/Ctrl+click in browser) |
| `POST /api/media/cinf` | Clip info probe from timeline editor |
| `POST /api/project/reconcile` | Missing-media check after project load (`client/lib/project-media-reconcile.js`) |

---

## UI triggers (reference)

| User action | API sequence |
|-------------|----------------|
| Select files → **Move to…** | `POST /api/media/mkdir` (if new folder) → `POST /api/media/move` (batch or loop) → `POST /api/media/refresh` → `GET /api/media` |
| Select files → **Copy to…** | mkdir (if needed) → `POST /api/media/copy` → refresh → GET |
| Select files → **Delete** | `POST /api/media/delete` (batch or loop) → refresh → GET |
| Drag files onto folder | `POST /api/media/move` (per batch) |
| Alt+drag onto folder | `POST /api/media/copy` |
| Folder 🗑 | `POST /api/media/delete` `{ "id": "<folderPath>" }` |
| ⌘⌥+click file | `POST /api/media/delete` `{ "id": "<file>" }` |

---

## Security and ops

- Validate paths: reject `..`, leading `/`, Windows drive prefixes, and NUL bytes.
- Restrict to the configured media root (realpath check after resolve).
- Log move/copy/delete at info level with `{ sourceId, targetId }` or `{ ids }`.
- Same auth / trust boundary as other `/api/media/*` routes.

---

## Client files (reference)

| File | Role |
|------|------|
| `client/lib/media-file-ops.js` | Batch + fallback wrappers for move/copy/delete |
| `client/components/sources-panel.js` | Selection bar, folder picker orchestration |
| `client/components/sources-panel-media.js` | Tree UI, drag-drop onto folders |
| `client/components/media-folder-picker-modal.js` | Destination folder dialog |
| `client/components/sources-panel-helpers.js` | Multi-drag payload, single-file delete shortcut |

---

## Test checklist

1. `GET /api/media` returns files and `isDir` folders with consistent paths.
2. `POST /api/media/mkdir` `{ "path": "testdir" }` creates folder; appears in GET.
3. `POST /api/media/move` `{ "sourceId": "a.mov", "targetId": "testdir" }` → file at `testdir/a.mov`, gone from root.
4. `POST /api/media/copy` same shape → source remains, copy exists in `testdir`.
5. Batch move `{ "sourceIds": ["x","y"], "targetId": "testdir" }` returns `{ "ok": true, "moved": 2 }`.
6. Batch delete `{ "ids": ["testdir/x","testdir/y"] }` returns `{ "ok": true, "deleted": 2 }`.
7. Delete folder `{ "id": "testdir" }` removes tree recursively.
8. Collision on copy/move → 409; client shows “Moved N of M — K failed” when using per-file fallback.
9. `POST /api/media/refresh` after mutations updates list for WebSocket/catalog consumers.

---

## Minimal implementation order

1. **move** + **delete** (single-body) — already assumed by older client; confirm batch variants.
2. **copy** (single + batch) — unblocks Copy toolbar and Alt+drag.
3. **mkdir** nested paths — folder picker “new subfolder” before transfer.
4. Batch aggregate responses — avoids N sequential round-trips for large selections.
