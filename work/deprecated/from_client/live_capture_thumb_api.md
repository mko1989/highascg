# Live source still capture API (server handoff)

Client UI: **Sources → Live** (`client/components/sources-panel-live-render.js`) and **Looks compose** layer thumb refresh (`client/components/scenes-compose.js`).

Live rows show a small still (Caspar **channel** composite via `PRINT`), not file-based ffmpeg thumbs. Helpers: `client/lib/thumbnail-url.js` (`getLiveThumbnailChannelForSource`, `getLiveThumbnailUrl`).

Server implementation target: `src/media/live-thumbnail-cache.js` (wired from `src/api/routes-media.js` and `src/api/router.js`).

---

## What the client needs

| Need | Detail |
|------|--------|
| Per-channel cache | One cached PNG per **Caspar channel number** (1-based), keyed as `ch-{N}.png` under a server data dir (e.g. `data/live-thumbnails/`). |
| Caspar `PRINT` | Capture uses AMCP `PRINT {channel}`; server finds the new scratch PNG Caspar writes into the **media root** and copies it into the cache. |
| No polling | Client captures **on demand** (camera button or compose refresh), not on a timer. |
| JSON errors | All non-image responses use `Content-Type: application/json` and `{ "error": "..." }` on failure. Use `JSON_HEADERS` from `api/response.js` — missing import caused `502 JSON_HEADERS is not defined`. |
| Works when Caspar down? | **GET** may 404 if no cache yet. **POST capture** should return **503** when AMCP unavailable (not an unhandled exception). Route is registered **before** the global Caspar gate so capture can return a proper 502/503 instead of blanket 503. |

---

## How the client picks a channel

`getLiveThumbnailChannelForSource(source)` (`client/lib/thumbnail-url.js`):

| Source | Channel used |
|--------|----------------|
| `route://N` or `route://N-L` | **N** (full-channel still; layer suffix is ignored for PRINT) |
| `thumbnailChannel` / `liveThumbChannel` / `producerChannel` on extra live sources | That positive integer |
| Direct NDI (`useDirect: true` + `ndi://…`) | **No channel** — no thumb UI / no capture (client shows placeholder only) |
| Otherwise | Preview bus fallback when provided |

Live tab rows only show capture/upload controls when resolved channel `> 0`.

---

## Endpoints

### `GET /api/thumbnail/live/:channel`

Serve the cached PNG for Caspar channel `:channel` (integer, ≥ 1).

| Status | Body |
|--------|------|
| **200** | Raw `image/png` (`Cache-Control: no-cache` recommended) |
| **404** | `{ "error": "No live thumbnail cached" }` (or similar) |

Client loads with cache-bust query: `/api/thumbnail/live/3?v=1710000000000` (`getLiveThumbnailUrl`).

---

### `POST /api/thumbnail/live/capture`

Trigger capture and refresh cache.

**Request:** JSON body

```json
{ "channel": 3, "force": true }
```

| Field | Required | Notes |
|-------|----------|--------|
| `channel` | yes | Positive integer — Caspar channel for `PRINT` |
| `force` | no | Client always sends `true` on manual capture. When `false`/omitted, server may skip if cache already exists. |

**Success (200):**

```json
{ "ok": true, "channel": 3 }
```

Optional fields: `cached: true` (skipped PRINT), `printFile` (basename of scratch PNG).

**Errors:**

| Status | When |
|--------|------|
| **400** | Missing/invalid `channel` |
| **404** | PRINT ran but no new PNG found in media folder |
| **502** | AMCP/PRINT failed |
| **503** | Caspar not connected |

After success, client immediately `GET`s `/api/thumbnail/live/:channel?v=…`.

---

### `POST /api/thumbnail/live/upload?channel=N`

Replace cached still with an operator-uploaded image (Live tab upload button).

**Request:** Raw image body (`image/png` or `image/jpeg`), `Content-Type` set from file.

**Query:** `channel` — positive integer (required).

**Success (200):**

```json
{ "ok": true, "channel": 3 }
```

**Errors:** **400** (missing channel/body), **500** (write failed).

---

## Client call sites

| Location | Action |
|----------|--------|
| Live tab — camera icon | `POST /api/thumbnail/live/capture` with `{ channel, force: true }`, then reload `GET` URL |
| Live tab — upload icon | `POST /api/thumbnail/live/upload?channel=N` with file bytes |
| Compose layer — live thumb refresh | Same capture POST + `getLiveThumbnailUrl(channel, Date.now())` |

On failure, client shows `err.message` (from API client, typically `HTTP {status}: {error}`).

---

## Server behaviour notes

1. **Scratch PNG location:** After `PRINT`, Caspar writes a timestamped `.png` at the **root** of the configured media folder (`local_media_path` / default ingest path). Server should pick the newest root-level `.png` created after the PRINT request (see `findNewestRootPngSince` in `live-thumbnail-cache.js`).
2. **Cache path:** Copy scratch file to `data/live-thumbnails/ch-{channel}.png` (or configurable `live_thumbnail_cache_dir`).
3. **Do not** require Caspar for upload — only capture needs AMCP.
4. **Future (not required by current client):** per-source cache keys (`value` hash), layer-aware PRINT, wait-for-play before capture — see WO-42 in playout repo. Current client only passes **channel**.

---

## Related (file media, not live)

| Endpoint | Use |
|----------|-----|
| `GET /api/thumbnail/:fileId?hq=1&w=…&t=…` | Scene/media file stills (`getThumbnailUrl`) |
| `GET /api/thumbnails` | Caspar thumbnail list (legacy) |

Live sources must **not** use the file thumbnail route unless `value` is a real media path.
