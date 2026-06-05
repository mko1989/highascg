# State, variables, selection & media

Query and update server snapshots for the operator UI, Companion variables, and the media library.

**Implementation:** [`src/api/routes-state.js`](../../../src/api/routes-state.js) · [`src/api/get-state.js`](../../../src/api/get-state.js) · [`src/api/routes-media.js`](../../../src/api/routes-media.js) · [`src/api/media-catalog.js`](../../../src/api/media-catalog.js)

Project persistence: [project.md](project.md).

---

## Caspar gate summary

| Route | Caspar required? |
|-------|------------------|
| `GET /api/variables`, `/variables/batch`, `/variables/custom` | **No** |
| `POST /api/variables/batch`, `/variables/custom` | **No** |
| `POST /api/selection` | **No** |
| `GET /api/project`, `/media`, `POST /api/media/cinf` (ffprobe fallback) | **No** (cinf prefers AMCP when up) |
| `GET /api/state`, `/channels`, `/templates`, `/fonts`, `/server/*`, `/help` | **Yes** |
| Thumbnails via Caspar `THUMBNAIL RETRIEVE` | **Yes** (local PNG cache may work without) |

---

## `GET /api/state`

Full UI bootstrap snapshot (requires Caspar).

```bash
curl -s http://127.0.0.1:4200/api/state | jq 'keys'
```

Query: `?full_cinf=1` — enrich all media entries with CINF (can be heavy).

### Top-level fields (typical)

| Key | Description |
|-----|-------------|
| `variables` | Companion/UI variable map |
| `channels` | Channel id list |
| `channelStatus` | Status lines per channel |
| `media` | Media catalog (id, label, duration, resolution, …) |
| `templates` | CG template list |
| `caspar` | `{ connected, host, port }` |
| `channelMap` | PGM/PRV routing resolved for UI |
| `scene` | `live`, `deck`, `programLayerBankByChannel`, `globalBorders` |
| `timeline` | `list`, `playback` |
| `playback.matrix` | Layer play tracker |
| `screenDestinations` | Output routing metadata |
| `osc` | OSC snapshot when enabled |

WebSocket may send slim catalog first (`catalogDeferred: true`) then chunk media separately.

---

## Variables

### `GET /api/variables`

All variables. Query `?prefix=ui_` filters keys.

### `GET /api/variables/batch?categories=ui,channel`

Returns variables whose keys start with `category_` (adds `_` if missing).

### `POST /api/variables/batch`

```json
{ "keys": ["ui_selection_context", "channel_1_framerate"] }
```

Max **2000** keys — **400** if exceeded. Returns only keys that exist.

### `GET /api/variables/custom`

```json
{ "labels": { "my_var": "Friendly name" } }
```

### `POST /api/variables/custom`

```json
{ "labels": { "my_var": "New label", "old_var": null } }
```

`null` or `""` removes a label. Persisted on disk.

---

## `POST /api/selection`

Sync UI inspector selection into variables (**no Caspar**).

```json
{
  "context": "scene_layer",
  "lookId": "sc_abc",
  "layerIndex": 2,
  "previewChannel": 2,
  "casparLayer": 10
}
```

Drives mixer [UI integration](mixer.md) (`ui_selection_*` keys). Debounced ~100 ms in the client.

**200:** `{ "ok": true }`

---

## Channels & server introspection

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/channels` | `ids`, `status`, `channelXml` |
| GET | `/api/channels/{n}` | `INFO` channel |
| GET | `/api/channels/{n}/delay` | `INFO` delay |
| GET | `/api/templates` | Template catalog |
| GET | `/api/config` | Caspar `INFO CONFIG` XML (text/xml) |
| GET | `/api/fonts` | `FLS` font list |
| GET | `/api/server` | Server info |
| GET | `/api/server/queues` | Queue stats |
| GET | `/api/server/threads` | Thread stats |
| GET | `/api/server/gl` | OpenGL info |
| GET | `/api/help` | AMCP HELP |
| GET | `/api/help/{command}` | HELP for one command |

---

## Media catalog

### `GET /api/media`

Media index (CLS + disk scan). Works **without Caspar**.

```bash
curl -s 'http://127.0.0.1:4200/api/media?full_cinf=1' | jq '.[0]'
```

Entries typically include `id`, `label`, optional `durationMs`, `resolution`, `fps` after enrichment.

### `POST /api/media/cinf`

Duration/metadata for one file (timeline drop):

```json
{ "id": "media/clip.mov" }
```

Also accepts `filename`. Uses Caspar `CINF` when connected; **ffprobe** fallback on disk when AMCP is down.

**200:**

```json
{
  "ok": true,
  "id": "media/clip.mov",
  "durationMs": 120000,
  "cinf": "…",
  "source": "cinf"
}
```

### `POST /api/media/refresh`

Triggers CLS/TLS media scan cycle.

### `POST /api/media/delete`

```json
{ "id": "media/old.mov" }
```

Prefer over `DELETE /api/local-media/...` when paths contain slashes.

### `POST /api/media/mkdir` · `POST /api/media/move`

```json
{ "path": "folder/sub" }
```

```json
{ "sourceId": "a.mov", "targetId": "folder/a.mov" }
```

### `GET /api/local-media/{path}`

Serve file from configured local media root.

### `DELETE /api/local-media/{path}`

Delete by URL path (encoding pitfalls — prefer `POST /api/media/delete`).

---

## Thumbnails

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/thumbnails` | Caspar thumbnail index |
| GET | `/api/thumbnail?filename=` | One image (query) |
| GET | `/api/thumbnail/{filename}` | One image (path) |
| GET | `/api/thumbnail/live/{channel}` | Cached PRINT still |
| POST | `/api/thumbnails/generate` | Generate one |
| POST | `/api/thumbnails/generate-all` | Generate all |
| POST | `/api/thumbnail/live/capture` | Capture from PRINT |
| POST | `/api/thumbnail/live/upload` | Upload still |

Thumbnail GET tries **local ffmpeg cache** first (`hq=1` default); Caspar retrieve with `?fallback=1`.

Query params: `w` (max width), `t` (seek seconds), `hq`, `fallback`.

---

## Examples

```bash
# Bootstrap UI (Caspar up)
curl -s http://127.0.0.1:4200/api/state | jq '{caspar, scene: .scene.live, timelines: .timeline.list | length}'

# Media without Caspar
curl -s http://127.0.0.1:4200/api/media | jq 'length'

# Clip duration for timeline
curl -s -X POST http://127.0.0.1:4200/api/media/cinf \
  -H 'Content-Type: application/json' \
  -d '{"id":"AMB"}' | jq .

# Companion variable batch
curl -s -X POST http://127.0.0.1:4200/api/variables/batch \
  -H 'Content-Type: application/json' \
  -d '{"keys":["channel_1_framerate","ui_selection_context"]}'
```

---

## Legacy

`POST/GET /api/data/store|retrieve|list|remove` → **410** with message to use project save/load.

---

## OpenAPI

[`openapi.yaml`](openapi.yaml) — `StateSnapshot`, `VariablesBatchRequest`, `MediaCinfRequest`, `SelectionPayload`.
