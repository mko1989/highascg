# Client agent — project persistence & autosave

**Audience:** Agent working on the **operator UI** (`dist-web/` on playout, or UI sources in highascg-client).

**Server repo:** `highascg` — this document describes what the server expects from the browser UI for project save, autosave, and live deck sync.

---

## Two persistence paths (do not duplicate)

| Path | Transport | When to use | USB stick push |
|------|-----------|-------------|----------------|
| **`scene_deck_sync`** | WebSocket → server | While editing looks/layers in the scenes UI | **No** (local disk only; debounced) |
| **`POST /api/project/autosave`** | HTTP | Periodic full-project backup timer | **Yes** |
| **`POST /api/project/save`** | HTTP | Explicit “Save project” / export | **Yes** |

The server **debounces** `scene_deck_sync` disk writes (default **750ms**, env `HIGHASCG_SCENE_DECK_SYNC_DEBOUNCE_MS`). Rapid edits coalesce into one write. USB/bridge copy runs only on explicit **save** and **autosave**.

**Do not** fire `scene_deck_sync` on every keystroke without client-side debounce (recommended **≥ 300ms**). The server debounces persistence, but large JSON payloads over WS still cost CPU/network.

---

## WebSocket: `scene_deck_sync`

Send when the look deck or layer content changes (rename look, edit layers, presets, preview selection).

```json
{
  "type": "scene_deck_sync",
  "data": {
    "looks": [
      { "id": "uuid", "name": "Look 1", "mainScope": "0" }
    ],
    "sceneSnapshots": [
      {
        "id": "uuid",
        "name": "Look 1",
        "mainScope": "0",
        "layers": [
          {
            "layerNumber": 20,
            "source": { "type": "template", "value": "LOWER-THIRDS/LT-CLASSIC-BOX" },
            "cgData": {
              "data": { "name": "Alex Rivera", "title": "Lead Designer" },
              "style": { "primaryColor": "#00bcd4", "textColor": "#ffffff" }
            }
          }
        ]
      }
    ],
    "previewSceneId": "uuid-or-null",
    "layerPresets": [],
    "lookPresets": []
  }
}
```

### Rules

1. **`sceneSnapshots`** must contain full look JSON (layers, fills, sources) for each edited look — this is what `POST /api/scene/take` resolves via `sceneId`.
2. Server sets **`savedAt`** to `now` on each accepted sync (after debounced flush).
3. Client **must not** assume `scene_deck_sync` pushes to USB — operator unplugging stick without an autosave may lose the last ~750ms of deck edits unless autosave runs.

---

## HTTP: `POST /api/project/autosave`

Periodic full-project snapshot from the client.

```http
POST /api/project/autosave
Content-Type: application/json

{
  "project": {
    "version": 2,
    "name": "My Show",
    "savedAt": "2026-06-22T21:01:53.243Z",
    "scenes": { "scenes": [ … ], "layerPresets": [], "lookPresets": [] },
    "hardwareConfig": { … }
  }
}
```

### `savedAt` contract (critical)

- Every save/autosave body **must** include `project.savedAt` (ISO-8601).
- Before building an autosave payload, set `savedAt` from the **latest known server copy**:
  - After **`project_sync`** WebSocket (broadcast after save/autosave), or
  - After **`GET /api/project`**, or
  - After a successful **`POST /api/project/save`** / **`autosave`** response.
- If the client sends an **older** `savedAt` than disk, the server returns **409** `stale_saved_at`. This is normal when `scene_deck_sync` already wrote a newer version.

### On 409 `stale_saved_at`

```json
{
  "error": "Autosave rejected: payload is older than the stored project",
  "reason": "stale_saved_at",
  "incomingSavedAt": "2026-06-22T21:01:36.062Z",
  "storedSavedAt": "2026-06-22T21:01:53.243Z"
}
```

**Client must:**

1. **Not retry** the same payload.
2. **`GET /api/project`** (or apply last `project_sync` message).
3. Update in-memory `savedAt` and project JSON.
4. Continue — server already has newer data from deck sync.

Do **not** treat 409 as an error toast unless autosave is the **only** persistence path in use.

### Other 409 reasons

| `reason` | Meaning | Client action |
|----------|---------|---------------|
| `empty_over_nonempty` | Empty project would wipe looks | Reload page / `GET /api/project` |
| `unrelated_scene_set` | Look IDs don't match stored show (stale tab) | Close tab or reload |
| `stale_saved_at` | Older timestamp | Refresh from server (above) |

---

## HTTP: `POST /api/project/save`

Same body as autosave. Optional flags:

```json
{
  "project": { … },
  "force": true,
  "broadcastProject": true
}
```

| Field | Description |
|-------|-------------|
| `force` / `allowReplace` | Bypass unrelated-scene-set guard (manual overwrite) |
| `broadcastProject` | Default `true` — debounced **`project_sync`** WS broadcast |

Use for explicit operator save. Triggers USB/bridge push when volumes are mounted.

---

## WebSocket: `project_sync` (server → client)

After save/autosave, server may broadcast:

```json
{
  "type": "project_sync",
  "data": { … full project … }
}
```

**Client must** merge this into local project state and update **`savedAt`** before the next autosave timer fires.

---

## Template / lower-third text on look layers

For HTML templates on a look layer, put CG JSON on the layer (scene take reads these fields in order):

1. `cgData`
2. `templateData`
3. `source.data`
4. `source.cgData`
5. `params`

Shape:

```json
{
  "data": { "name": "Primary line", "title": "Secondary line" },
  "style": { "primaryColor": "#00bcd4", "textColor": "#ffffff", "position": "left" }
}
```

Include this inside **`sceneSnapshots`** layers when syncing via `scene_deck_sync`, so takes and persistence stay consistent.

Alternative: standalone **`POST /api/lower-thirds/*`** API (see `from_client/lower-thirds-api.md`) — targets explicit `channel` / `layer`; defaults `1` / `20`. Not tied to look `layerNumber` unless you pass matching values.

---

## Recommended client timers

| Timer | Suggested interval | Notes |
|-------|-------------------|--------|
| `scene_deck_sync` debounce | 300–500ms after last edit | Coalesce UI edits before WS send |
| `POST /api/project/autosave` | 30–60s | Skip tick if no edits since last successful save/sync |
| Refresh `savedAt` | On every `project_sync` | Prevents stale autosave 409 spam |

---

## Environment variables (server operator tuning)

| Variable | Default | Effect |
|----------|---------|--------|
| `HIGHASCG_SCENE_DECK_SYNC_DEBOUNCE_MS` | `750` | Debounce disk write after `scene_deck_sync` |
| `HIGHASCG_PROJECT_SYNC_DEBOUNCE_MS` | `150` | Debounce `project_sync` WS broadcast after save |
| `HIGHASCG_PERSISTENCE_FLUSH_MS` | `200` | Debounce `.highascg-state.json` rewrite |

---

## Anti-patterns

1. **Autosave every 5s with a stale `savedAt`** while deck sync runs → 409 spam and wasted HTTP.
2. **`scene_deck_sync` on every mousemove** → large WS frames; debounce on client.
3. **Posting full `incomingScene` on every take** when looks are already on server — use `sceneId` only (see `work/WALKTHROUGH_client-agent-pgm-look-take.md`).
4. **Lower-third names only in client RAM** — must be in `cgData` on the layer inside `sceneSnapshots`, or sent via `/api/lower-thirds/load`.

---

## Server implementation references

| Piece | File |
|-------|------|
| Debounced deck sync persist | `src/engine/project-scenes.js` |
| Save / autosave HTTP | `src/api/routes-data.js` |
| WS handler | `src/server/ws-server.js` |
| Project API wiki | `docs/wiki/api/project.md` |
