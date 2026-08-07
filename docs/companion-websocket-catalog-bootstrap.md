# Companion module: WebSocket slim bootstrap & catalog loading

HighAsCG can send a **small first `state` frame** on WebSocket connect when the operator enables slim bootstrap on the server. Companion modules that assumed **`state.media`** and **`state.templates`** were always populated in that first message need a small adaptation.

This document is for **maintainers of Bitfocus Companion modules** (or any HTTP/WS client) that connect to HighAsCG’s WebSocket API.

**Related:** variable/topic docs in [`companion-module-ui-selection.md`](./companion-module-ui-selection.md); performance context in [`work/work-orders/performance/PF-01-big-snapshots-ws-state.md`](../work/work-orders/performance/PF-01-big-snapshots-ws-state.md).

---

## 1. When this applies

Slim bootstrap is active on the server when **`HIGHASCG_WS_SLIM_BOOTSTRAP`** is set to **`1`** or **`true`** (case-insensitive). If unset, the server behaves like the legacy style: the first WS **`state`** message usually includes full **`media`** and **`templates`** arrays (subject to other caps such as CINF limits on HTTP-style snapshots).

There is **no separate capability flag** beyond inspecting the first **`state`** payload.

---

## 2. How to detect “deferred catalog” mode

On the first inbound WebSocket message with **`type: "state"`**, check **`data`** (the parsed JSON body):

| Field | Meaning |
|--------|--------|
| **`catalogDeferred: true`** | Catalog bodies are omitted from this **`state`**; fill them via HTTP or WS catalog messages (below). |
| **`mediaCount`** | Integer — number of media rows on the server (CLS + app merge). |
| **`templateCount`** | Integer — template count. |
| **`media`**, **`templates`** | Typically **empty arrays** when `catalogDeferred` is true. |

If **`catalogDeferred`** is **missing or false**, treat the snapshot as **full** (existing module logic can stay as-is).

---

## 3. Recovery strategies (pick one)

### Option A — **Single HTTP full state** (smallest code change)

After connect, if **`data.catalogDeferred`**:

1. **`GET /api/state`** (same host/port as WS).
2. Replace your cached snapshot with the JSON body (it includes **`media`**, **`templates`**, **`variables`**, **`channelMap`**, etc.).

This matches the HighAsCG web client **fallback** and is the most compatible path for modules that already poll or merge **`GET /api/state`**.

**Caveat:** On installations with **very large** media lists, this request is heavier than chunked loading or **`GET /api/media`** alone.

---

### Option B — **HTTP catalog only** (lighter than full state)

If you only need file/template pickers:

1. **`GET /api/media`** — returns the media list (optional query **`?full_cinf=1`** or **`?fullCinf=1`** for full CINF parsing server-side).
2. **`GET /api/templates`** — returns `{ id, label }[]`.

Merge **`media`** and **`templates`** into whatever structure your module expects (often the same shape as inside **`GET /api/state`**).

---

### Option C — **WebSocket catalog chunks** (best for huge catalogs)

Use JSON messages on the **same** WebSocket as the rest of your traffic. All client messages are JSON objects; the server responds with **`type: "catalog_chunk"`** (and **`catalog_error`** on failure).

#### C.1 — Templates (one request)

Send:

```json
{
  "type": "catalog_request",
  "slice": "templates",
  "offset": 0,
  "limit": 100000,
  "id": "companion-templates-1"
}
```

- **`id`** — your correlation id; echoed as **`requestId`** on the matching **`catalog_chunk`** (recommended).

You will receive exactly one chunk (templates are small):

```json
{
  "type": "catalog_chunk",
  "data": {
    "slice": "templates",
    "offset": 0,
    "total": 42,
    "items": [{ "id": "...", "label": "..." }],
    "done": true,
    "requestId": "companion-templates-1"
  }
}
```

Use **`data.items`** as **`templates`**.

#### C.2 — Media — **subscribe** (server streams chunks)

Send:

```json
{
  "type": "catalog_subscribe",
  "slice": "media",
  "id": "companion-media-1",
  "limit": 600,
  "fullCinf": false
}
```

- **`slice`** — must be **`"media"`** for subscribe (templates use **`catalog_request`** only).
- **`limit`** — optional; server clamps to a safe maximum. Default server chunk size comes from **`HIGHASCG_WS_CATALOG_CHUNK_LIMIT`** (typically **600**).
- **`fullCinf`** — optional boolean (or **`"1"`**). When true, disables CINF cap for **each chunk** (can be expensive on large rigs).

The server sends **multiple** **`catalog_chunk`** messages with the **same** **`requestId`** until **`done: true`**:

```json
{
  "type": "catalog_chunk",
  "data": {
    "slice": "media",
    "offset": 0,
    "total": 15000,
    "items": [ /* … rows for this slice … */ ],
    "done": false,
    "requestId": "companion-media-1",
    "streamId": "cat-1700000000000-abc123"
  }
}
```

**Reassembly rule:** allocate an array of length **`total`**, then for each chunk assign:

`array[data.offset + i] = data.items[i]`

When **`data.done`** is **true**, the catalog is complete. Use **`array`** as **`media`** in your snapshot.

#### C.3 — Media — **single chunk** (**`catalog_request`**)

For manual paging, send **`catalog_request`** with **`slice: "media"`**, **`offset`**, and **`limit`**. The server returns one **`catalog_chunk`**. Repeat with increasing **`offset`** until **`done`** or **`offset >= total`**.

---

## 4. Errors

```json
{
  "type": "catalog_error",
  "data": {
    "message": "…",
    "requestId": "companion-media-1",
    "streamId": "cat-…"
  },
  "id": "companion-media-1"
}
```

Correlate failures with your **`id`** / **`requestId`**. Fall back to **Option A** or **B** if needed.

---

## 5. Server tuning (operator / deployment)

| Variable | Effect |
|----------|--------|
| **`HIGHASCG_WS_SLIM_BOOTSTRAP`** | Enables slim first **`state`** + **`catalogDeferred`**. |
| **`HIGHASCG_WS_CATALOG_CHUNK_LIMIT`** | Max rows per **media** chunk (clamped). |
| **`HIGHASCG_WS_CATALOG_CHUNK_ENRICH`** | **`0`** / **`false`** — raw CLS-style rows in chunks (fastest WS path). Default enriches chunks similarly to **`GET /api/media`** (probe + CINF rules, per chunk). |

---

## 6. Other WebSocket behavior changes (FYI)

These affect **all** WS clients, not only slim bootstrap:

| Topic | Behavior |
|--------|-----------|
| **`change`** events | May be **coalesced** within **`HIGHASCG_WS_CHANGE_COALESCE_MS`** (default ~75 ms). **Last write wins** per `path` within the window — do not rely on receiving every intermediate `change` if your UI animates on each tick. |
| **`log_line`** | Rate-limited by **`HIGHASCG_WS_LOG_LINE_MAX_HZ`** (default **50**/s; **`0`** disables). |
| **Periodic full `state`** | If the server is configured with a WS broadcast interval, those ticks may use a **full** catalog snapshot (implementation detail). Do not assume periodic **`state`** is always slim. |

---

## 7. WebSocket URL

Same patterns as today:

- **`ws://<host>:<port>/api/ws`**
- **`ws://<host>:<port>/ws`**
- **`ws://<host>:<port>/instance/<instanceId>/api/ws`** (when using instance-prefixed HTTP as well)

Messages are **JSON text** frames: **`{"type":"…", …}`**.

---

## 8. Minimal implementation checklist

- [ ] After first **`state`**, if **`catalogDeferred`**, do **not** assume **`media.length > 0`**.
- [ ] Implement at least **Option A** (`GET /api/state`) or **Option B** (`/api/media` + `/api/templates`).
- [ ] For large lists, prefer **Option C** ( **`catalog_subscribe`** for **media** + one **`catalog_request`** for **templates**).
- [ ] Handle **`catalog_error`** and fall back to HTTP if WS catalog fails.
- [ ] If your module depended on **every** **`change`** message, verify behavior with coalescing (§6).

---

## 9. Source map (for code archeology)

| Area | Path |
|------|------|
| Slim snapshot shape | `src/api/get-state.js` (`slimCatalog`) |
| WS catalog dispatch | `src/server/ws-catalog-handlers.js` |
| WS attach / `change` coalescing | `src/server/ws-server.js` |
| Raw catalog merge | `src/api/media-catalog.js` |
| Web UI reference client | `client/lib/deferred-catalog-ws.js`, `client/lib/app-ws-handlers.js` |
