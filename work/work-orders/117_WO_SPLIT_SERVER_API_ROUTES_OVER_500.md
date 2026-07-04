# WO-117 — Split server API route files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Done — all five route aggregators split 2026-07-03  
**Priority:** **High** (clear handler boundaries)

**Touches:** `src/api/routes-*.js`, `src/api/router.js` (register only)

---

## 1. Problem

| Lines | File |
|------:|------|
| 628 | `src/api/routes-streaming-channel.js` |
| 595 | `src/api/routes-data.js` |
| 574 | `src/api/routes-scene.js` |
| 555 | `src/api/routes-replication.js` |
| 529 | `src/api/routes-mixer.js` |

---

## 2. Split plan

Pattern: one file per **route prefix** or **handler cluster**; thin aggregator re-exports `registerRoutes(router, ctx)`.

### 2.1 `routes-data.js` (595)

| New module | Routes / handlers |
|------------|-------------------|
| `routes-data-project.js` | `/api/project/*`, save/load/list, sync broadcast |
| `routes-data-store.js` | `/api/data/store`, retrieve, list, remove |
| `routes-data-hardware.js` | hardware config inject/apply on project load |

Keep debounce timer + `scheduleProjectSyncBroadcast` in project module or small `routes-data-shared.js`.

### 2.2 `routes-streaming-channel.js` (628)

| New module | Responsibility |
|------------|----------------|
| `routes-streaming-channel-status.js` | GET status, health |
| `routes-streaming-channel-config.js` | PUT config, FFmpeg args |
| `routes-streaming-channel-ports.js` | UDP port allocation |

### 2.3 `routes-scene.js` (574)

| New module | Responsibility |
|------------|----------------|
| `routes-scene-deck.js` | deck CRUD, layer ops |
| `routes-scene-take.js` | take, clear, transition triggers |
| `routes-scene-compose.js` | compose preview endpoints |

### 2.4 `routes-replication.js` (555)

| New module | Responsibility |
|------------|----------------|
| `routes-replication-pairing.js` | pairing, role, identity |
| `routes-replication-sync.js` | project push, playhead, mirror |
| `routes-replication-ws.js` | WebSocket upgrade helpers if inline |

Note: some replication helpers may already live in `src/replication/` — move logic there, keep routes thin.

### 2.5 `routes-mixer.js` (529)

| New module | Responsibility |
|------------|----------------|
| `routes-mixer-channels.js` | per-channel gain/mute |
| `routes-mixer-effects.js` | effect catalog apply |

---

## 3. Tasks

- [x] **T117.0** Split `routes-data.js` (largest); add/extend smoke: `smoke-project-media-root`, project save/load.
- [x] **T117.1** Split streaming channel routes (`shared`, `log`, `rtmp`, `record` → aggregator 50 lines).
- [x] **T117.2** Split scene routes (`shared`, `take`, `border`, `preview` → aggregator 29 lines).
- [x] **T117.3** Split replication (`shared`, `get`, `post` → aggregator 7 lines) + mixer (`stretch`, `inspector`).
- [x] **T117.4** All five aggregators ≤ 500 lines; router registration unchanged from outside.

---

## 4. Verification

```bash
npm run lint
npm run test:ci
npm run test:replication
npm run smoke:streaming-ch
```

---

## Work Log

### 2026-07-03 — Created

- **Instructions for Next Agent:** Start with `routes-data.js` — split project vs data-store handlers; lowest cross-file coupling.

### 2026-07-03 — WO-117 T117.0 + mixer split

- Split `routes-data.js` (595 → 40) into `routes-data-project-sync.js`, `routes-data-project-slug.js`, `routes-data-project-read.js`, `routes-data-project-handlers.js`.
- Fixed `handleProjectDelete` missing `ctx` (router now passes ctx).
- Split `routes-mixer.js` (529 → 218) into `routes-mixer-stretch.js`, `routes-mixer-inspector.js`.
- Added `tools/ci/check-max-file-lines.js` + npm scripts `check:file-lines` / `check:file-lines:warn`.
### 2026-07-03 — WO-117 complete (streaming, scene, replication)

- Split `routes-streaming-channel.js` (629 → 50) into `routes-streaming-channel-shared.js`, `-log.js`, `-rtmp.js`, `-record.js`.
- Split `routes-scene.js` (575 → 29) into `routes-scene-shared.js`, `-take.js`, `-border.js`, `-preview.js`.
- Split `routes-replication.js` (556 → 7) into `routes-replication-shared.js`, `-get.js`, `-post.js`.
- `check:file-lines` count: 46 → 42 files over 500 (none in `src/api/routes-*.js`).
- **Instructions for Next Agent:** WO-112 — `device-view.js` (851 lines) per WO-111 execution order.
