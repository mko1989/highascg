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

## On-disk layout

| Location | Role |
|----------|------|
| `~/highascg/projects/<slug>.json` | Working copy on the playout host |
| `~/highascg/projects/_autosave/<slug>.json` | Autosave for active slug |
| **USB stick** `HIGHASCGEXF` → `projects/*.json` + `projects/_autosave/*.json` | **Field catalog** — listed when stick is mounted; boot pulls stick → working dir |
| **Bridge disk** `HIGHASCGDAT` → `projects/*.json` + `_autosave/` | Production sync — bidirectional mtime sync with working dir |

**Save behaviour:** each save/autosave writes the working copy and `_autosave/`, then pushes **only that slug** (main + autosave files) to USB and/or bridge when those volumes are mounted.

**Boot behaviour:** `exfat-sync --boot` pulls `projects/` **including `_autosave/`** from the stick (and bridge when mounted). On load, `readAutosaveFile` refreshes from the newest volume copy so reboot restores where the operator left off.

**List behaviour:** when USB is mounted, `GET /api/project/list` reads the catalog from the stick (`source: "usb"`). Without USB, local + bridge entries are merged (newest `savedAt` wins).

Sync map pairs: `usb-projects` (`direction: to_project`, boot pull only) and `bridge-projects` (`direction: both`).

---

The `project` object is the same envelope the operator UI saves:

| Area | Typical keys |
|------|----------------|
| Metadata | `name`, `slug`, `savedAt`, `version` |
| Scenes | `scenes.scenes[]` — looks with `layers`, transitions |
| **`hardwareConfig`** | Injected on **save/autosave** from live server config (v2) |
| Timelines | May be client-localStorage; sync via [`/api/timelines`](timelines.md) separately |

### `hardwareConfig` (server-injected, v2)

Written by the server on `POST /api/project/save` and `POST /api/project/autosave`; restored on `POST /api/project/load` into `highascg.config.json`.

| Key | Contents |
|-----|----------|
| `version` | `2` |
| `deviceGraph` | Device View graph |
| `screenDestinations` | PGM/PRV/multiview bindings |
| `osDisplay` | GPU xrandr layout (`screen_N_os_*`, `multiview_os_*`, `screen_count`, …) |
| `gpuPhysicalTopology` | Physical GPU port map (when present) |
| `casparServer` | Caspar generator settings dict |
| `audioRouting`, `streamingChannel`, `dmx`, `*Outputs` | Routing extras |
| `multiviewLayout` | Multiview editor layout |
| `fingerprint` | `{ hostname }` — informational for client mismatch UI |

**Load does not** run `apply-os`, regenerate `casparcg.config`, or restart Caspar — client should call those after applying hardware when heads changed.

Implementation: [`src/engine/project-hardware-config.js`](../../../src/engine/project-hardware-config.js)

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

Returns the project catalog merged from mounted volumes. Each entry includes a `source` field indicating which volume supplied the winning copy.

| Field | Type | Description |
|-------|------|-------------|
| `activeSlug` | string \| null | Last loaded slug (persistence) |
| `projects[]` | array | Catalog entries (newest `savedAt` per slug) |
| `projects[].source` | `"usb"` \| `"bridge"` \| `"local"` | Origin of the listed entry |
| `volumes.usb` | object | `{ mount, mounted }` for `HIGHASCGEXF` |
| `volumes.bridge` | object | `{ mount, mounted }` for `HIGHASCGDAT` |

**Catalog rules:**

- USB mounted → scan stick `projects/` as the primary catalog; merge bridge entries when bridge is also mounted.
- USB absent → scan local `~/highascg/projects/` and merge bridge when mounted.
- Tie on `savedAt` → USB wins when the stick is mounted (field catalog).

```bash
curl -s http://127.0.0.1:4200/api/project/list | jq .
```

```json
{
  "activeSlug": "show-a",
  "volumes": {
    "usb": { "mount": "/home/casparcg/exfat", "mounted": true },
    "bridge": { "mount": "/home/casparcg/bridge", "mounted": false }
  },
  "projects": [
    {
      "slug": "show-a",
      "name": "Show A",
      "savedAt": "2026-06-07T12:00:00.000Z",
      "path": "/home/casparcg/exfat/projects/show-a.json",
      "source": "usb"
    }
  ]
}
```

**Load side effect:** `POST /api/project/load` (and any read by slug) calls `pullProjectSlugFromUsbIfNewer` — if the stick copy has a newer mtime, it refreshes the working file under `~/highascg/projects/` before returning JSON.

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

**409** messages tuned for stale browser tabs. Expected **`stale_saved_at`** when `scene_deck_sync` already wrote a newer copy — client should refresh from `GET /api/project` or `project_sync` WS (see `from_client/project-persistence-client-agent.md`).

Triggers USB/bridge push on success. **`scene_deck_sync`** (WebSocket) debounces local disk writes (default 750ms, `HIGHASCG_SCENE_DECK_SYNC_DEBOUNCE_MS`) and does **not** push to USB.

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
| [system-settings-hardware.md](system-settings-hardware.md) | exFAT sync pairs (`usb-projects`, `bridge-projects`) |
| [BRIDGE_DISK_AND_USB_EXFAT.md](../../BRIDGE_DISK_AND_USB_EXFAT.md) | Volume layout, boot order, seed scripts |

---

## OpenAPI

[`openapi.yaml`](openapi.yaml) — `ProjectSaveRequest`, `ProjectLoadRequest`, `ProjectListResponse`.
