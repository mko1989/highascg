# Project API — save, load, sync

Persist show data (looks/scenes, routing, timelines in project JSON, settings mirrors) on the playout host disk. **Does not require Caspar** for core save/load/list/get.

**Implementation:** [`src/api/routes-data.js`](../../../src/api/routes-data.js) · store: [`src/engine/project-store.js`](../../../src/engine/project-store.js)

Advanced sync/bundle: [`src/api/routes-project.js`](../../../src/api/routes-project.js)

---

## Caspar gate

| Route | Caspar |
|-------|--------|
| `GET /api/project`, `/list`, `POST save/load/autosave` | **Not required** |
| `GET /api/project/bundle` | **Not required** |
| `POST /api/project/reconcile`, `/sync`, `/diff`, `/apply-bundle` | **Required** |

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/project` | Active merged project (or `{}` if none) |
| GET | `/api/project/list` | Saved slugs + `activeSlug` |
| POST | `/api/project/save` | Save project to disk |
| POST | `/api/project/load` | Load project by slug |
| POST | `/api/project/autosave` | Autosave with stricter validation |
| GET | `/api/project/bundle` | Export bundle (config + state + Caspar XML + media manifest) |
| POST | `/api/project/reconcile` | Check live looks vs media/template index |
| POST | `/api/project/sync` | Force scene take for all live channels |
| POST | `/api/project/diff` | Manifest diff (body) |
| POST | `/api/project/apply-bundle` | Apply remote bundle, restart |

Legacy **`/api/data/*`** → **410 Gone** — use project routes instead.

---

## Project JSON shape

The `project` object is the same envelope the operator UI saves:

| Area | Typical keys |
|------|----------------|
| Metadata | `name`, `slug`, `savedAt`, `version` |
| Scenes | `scenes.scenes[]` — looks with `layers`, transitions |
| Routing | channel map, multiview, audio (merged into server config on save) |
| Timelines | May be client-localStorage; sync via [`/api/timelines`](timelines.md) separately |

Exact schema evolves with the client; treat as opaque JSON except fields you set.

---

## `GET /api/project`

Startup probe — always **200**:

- Existing project → full JSON
- None yet → `{}` (avoids client boot errors)

```bash
curl -s http://127.0.0.1:4200/api/project | jq '.name, .scenes'
```

---

## `GET /api/project/list`

```json
{
  "activeSlug": "show-a",
  "projects": [
    { "slug": "show-a", "name": "Show A", "savedAt": "…" }
  ]
}
```

---

## `POST /api/project/save`

| Field | Type | Description |
|-------|------|-------------|
| `project` | object | **Required** full project |
| `force` / `allowReplace` | boolean | Bypass stale/replace guards |
| `broadcastProject` | boolean | default true — WebSocket `project_sync` |

```bash
curl -s -X POST http://127.0.0.1:4200/api/project/save \
  -H 'Content-Type: application/json' \
  -d '{"project":{"name":"Demo Show","scenes":{"scenes":[]}}}'
```

**200:**

```json
{
  "ok": true,
  "slug": "demo-show",
  "activeSlug": "demo-show",
  "created": true
}
```

**409** — save rejected (stale tab, unrelated scene set, older `savedAt`):

```json
{
  "error": "Project save rejected: …",
  "reason": "stale_saved_at",
  "incomingSavedAt": "…",
  "storedSavedAt": "…"
}
```

Reasons: `stale_saved_at`, `unrelated_scene_set`, `empty_over_nonempty` (autosave).

Side effects: persists via `persistProject`, optional Art-Net reconfigure, debounced **`project_sync`** WebSocket broadcast.

---

## `POST /api/project/load`

| Field | Type | Description |
|-------|------|-------------|
| `slug` | string | Project file slug; omit to load active slug |

```bash
curl -s -X POST http://127.0.0.1:4200/api/project/load \
  -H 'Content-Type: application/json' \
  -d '{"slug":"demo-show"}'
```

**200** — full project object.  
**404** — `{ "error": "No project stored" }`.

Sets active slug in persistence.

---

## `POST /api/project/autosave`

Same body as save (`project` required). Stricter validation — rejects empty projects that would wipe stored looks.

**409** messages tuned for stale browser tabs.

---

## `GET /api/project/bundle`

Offline/export snapshot:

```json
{
  "config": { },
  "state": { },
  "casparcgConfig": "<configuration>…</configuration>",
  "mediaManifest": [
    { "path": "clip.mov", "size": 12345, "mtime": 1717512345678 }
  ]
}
```

---

## `POST /api/project/reconcile`

Compares **live scene** layers to server media/template catalogs.

**200:**

```json
{
  "ok": true,
  "reconciliation": {
    "usedMedia": [],
    "usedTemplates": [],
    "missingMedia": [],
    "missingTemplates": [],
    "isClean": true
  }
}
```

---

## `POST /api/project/sync`

Runs **hard-cut scene take** (`forceCut: true`) for every channel in live scene state (draft → air). Returns per-channel results array.

---

## `POST /api/project/apply-bundle`

Applies bundle from pre-show tooling; may rewrite config, exit process, restart Caspar. Body: bundle payload (see internal sync tools).

**200:** `{ "ok": true, "message": "Bundle applied. HighAsCG and CasparCG restarting." }`

---

## WebSocket

| Event | When |
|-------|------|
| `project_sync` | After successful save (debounced ~150 ms, `HIGHASCG_PROJECT_SYNC_DEBOUNCE_MS`) |

---

## Related

| Doc | Topic |
|-----|--------|
| [state-and-media.md](state-and-media.md) | `/api/state` snapshot includes `scene.deck` |
| [scene-take.md](scene-take.md) | Resolve `sceneId` from loaded project |
| [timelines.md](timelines.md) | Timeline CRUD separate from project file |

---

## OpenAPI

[`openapi.yaml`](openapi.yaml) — `ProjectSaveRequest`, `ProjectLoadRequest`, `ProjectListResponse`.
