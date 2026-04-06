# Work Order 02: Migrate to HighAsCG Standalone Node.js App

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Migrate the CasparCG client functionality from `companion-module-casparcg-server` into a standalone Node.js application at `/Users/marcin/companion-module-dev/HighAsCG/`. The app must create its own server, connect to CasparCG, and serve the web GUI on localhost and LAN. All files must be ≤ 500 lines. Code must be robust, modular, and well-structured.

## Prerequisites

- Work Order 01 (analysis) should be completed or substantially progressed
- Refer to `00_PROJECT_GOAL.md` for target architecture
- Refer to `01_WO_ANALYZE_MODULE.md` for file classifications

## Source

```
/Users/marcin/companion-module-dev/companion-module-casparcg-server/
```

## Target

```
/Users/marcin/companion-module-dev/HighAsCG/
```

---

## Target Directory Structure

```
HighAsCG/
├── package.json
├── README.md
├── .gitignore
├── index.js                    # CLI entry point
├── config/
│   └── default.js              # Default configuration (host, ports, etc.)
├── src/
│   ├── server/
│   │   ├── http-server.js      # HTTP server (Express or raw http)
│   │   ├── ws-server.js        # WebSocket server
│   │   └── cors.js             # CORS middleware
│   ├── caspar/
│   │   ├── tcp-client.js       # Raw TCP connection to CasparCG (net.Socket)
│   │   ├── amcp-protocol.js    # AMCP protocol parser (state machine)
│   │   ├── amcp-commands.js    # AMCP command abstraction (Promise-based)
│   │   ├── amcp-batch.js       # BEGIN/COMMIT batch support
│   │   └── connection-manager.js # Reconnection, health check, status
│   ├── state/
│   │   ├── state-manager.js    # Centralized state (EventEmitter)
│   │   ├── channel-state.js    # Channel/layer state from INFO XML
│   │   ├── media-state.js      # Media list from CLS/CINF
│   │   ├── template-state.js   # Template list from TLS
│   │   ├── playback-tracker.js # Play/stop state matrix
│   │   └── live-scene-state.js # Per-channel live scene snapshots
│   ├── engine/
│   │   ├── scene-transition.js # Scene diff + crossfade logic (part 1)
│   │   ├── scene-take.js       # Scene take execution (part 2)
│   │   ├── scene-native-fill.js # Fill position calculation
│   │   ├── timeline-engine.js  # Timeline data model + playback (part 1)
│   │   ├── timeline-playback.js # Timeline AMCP execution (part 2)
│   │   └── program-layer-bank.js # A/B bank management
│   ├── api/
│   │   ├── router.js           # Main API router/dispatcher
│   │   ├── routes-amcp.js      # AMCP basic endpoints (play, stop, etc.)
│   │   ├── routes-mixer.js     # MIXER endpoints
│   │   ├── routes-cg.js        # CG template endpoints
│   │   ├── routes-state.js     # State query endpoints (GET /api/state, etc.)
│   │   ├── routes-scene.js     # Scene take endpoints
│   │   ├── routes-multiview.js # Multiview apply endpoint
│   │   ├── routes-timeline.js  # Timeline CRUD + playback
│   │   ├── routes-config.js    # Config apply/restart
│   │   ├── routes-media.js     # Media/thumbnail endpoints
│   │   └── routes-data.js      # DATA + project save/load
│   ├── config/
│   │   ├── config-generator.js # CasparCG XML generation (part 1)
│   │   ├── config-modes.js     # Video modes + dimensions (part 2)
│   │   ├── config-compare.js   # Live vs. generated comparison
│   │   └── routing.js          # Channel map + routing setup
│   ├── media/
│   │   ├── local-media.js      # File-based media operations
│   │   ├── cinf-parse.js       # CINF response parser
│   │   └── thumbnail.js        # Thumbnail generation/retrieval
│   └── utils/
│       ├── persistence.js      # JSON file persistence
│       ├── periodic-sync.js    # Periodic CLS/TLS refresh
│       ├── handlers.js         # CLS/TLS response handlers
│       ├── logger.js           # Logging abstraction (replaces self.log)
│       └── query-cycle.js      # Connection query cycle (INFO, VERSION)
├── web/                        # Web GUI (served as static files)
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── dashboard.js
│   │   │   └── dashboard-cell.js
│   │   ├── scenes/
│   │   │   ├── scenes-editor.js
│   │   │   ├── scene-list.js
│   │   │   └── scene-layer-row.js
│   │   ├── timeline/
│   │   │   ├── timeline-editor.js
│   │   │   ├── timeline-canvas.js
│   │   │   └── timeline-transport.js
│   │   ├── inspector/
│   │   │   ├── inspector-panel.js
│   │   │   ├── inspector-fill.js
│   │   │   ├── inspector-mixer.js
│   │   │   └── inspector-transition.js
│   │   ├── multiview-editor.js
│   │   ├── preview-canvas.js
│   │   ├── sources-panel.js
│   │   ├── header-bar.js
│   │   └── audio-mixer-panel.js
│   └── lib/
│       ├── api-client.js
│       ├── ws-client.js
│       ├── state-store.js
│       ├── dashboard-state.js
│       ├── scene-state.js
│       ├── timeline-state.js
│       ├── multiview-state.js
│       ├── project-state.js
│       ├── selection-sync.js
│       ├── mixer-fill.js
│       ├── fill-math.js
│       ├── math-input.js
│       ├── media-ext.js
│       ├── audio-mixer-state.js
│       ├── scene-live-match.js
│       ├── playback-clock.js
│       └── program-layer-bank.js
└── templates/                  # CasparCG HTML templates (overlay, black)
    ├── multiview_overlay.html
    └── black.html
```

> **Implementation note (2026-04-04):** `src/caspar/` ships **`amcp-client.js`** plus modular `amcp-basic.js`, `amcp-mixer.js`, etc., instead of a single `amcp-commands.js`. Extra web splits include [`scenes-preview-runtime.js`](web/components/scenes-preview-runtime.js), [`scenes-compose.js`](web/components/scenes-compose.js), [`preview-canvas-draw.js`](web/components/preview-canvas-draw.js) / [`preview-canvas-panel.js`](web/components/preview-canvas-panel.js), [`timeline-canvas-utils.js`](web/components/timeline-canvas-utils.js) / [`timeline-canvas-clip.js`](web/components/timeline-canvas-clip.js).

---

## Tasks

### Phase 1: Project Scaffolding

- [x] **T1.1** Initialize Node.js project
  - Create `package.json` with name `highascg`, scripts (start, dev), dependencies
  - Dependencies: `ws` (WebSocket), `xml2js` (XML parsing)
  - Optional: `express` for HTTP routing (or raw `http` module)
  - Create `.gitignore` (node_modules, .DS_Store, etc.)
  - Create `.nvmrc` with Node ≥ 22

- [x] **T1.2** Create `index.js` entry point
  - Parse CLI args for port and CasparCG host/port
  - Load config from `config/default.js` or environment variables
  - Initialize and start the application

- [x] **T1.3** Create config system
  - `config/default.js` with: caspar.host, caspar.port, server.httpPort, server.wsPort, server.bindAddress (default `0.0.0.0`)

### Phase 2: CasparCG Connection Layer

- [x] **T2.1** Create `src/caspar/tcp-client.js`
  - Replace `@companion-module/base` TCPHelper with raw `net.Socket`
  - Implement: connect, disconnect, send, auto-reconnect with backoff
  - Emit events: `connected`, `disconnected`, `error`, `data`
  - Buffer handling: accumulate until `\r\n`

- [x] **T2.2** Create `src/caspar/amcp-protocol.js`
  - Extract AMCP state machine from `tcp.js`
  - Same return code handling (100–503)
  - Callback dispatch mechanism
  - No Companion dependencies

- [x] **T2.3** Migrate `src/caspar/amcp-commands.js`
  - Copy from `amcp.js` — this is already clean
  - Update constructor to not require Companion instance
  - Replace `self.socket` references with new tcp-client

- [x] **T2.4** Migrate `src/caspar/amcp-batch.js`
  - Copy from `amcp-batch.js`
  - Update references

- [x] **T2.5** Create `src/caspar/connection-manager.js`
  - Orchestrate tcp-client + amcp-protocol + reconnection
  - Health check via periodic VERSION command
  - Status events for WebSocket broadcast

### Phase 3: State Management

- [x] **T3.1** Migrate `src/state/state-manager.js`
  - Copy from `state-manager.js` — already clean
  - Remove dependency on `self.log` (use logger)

- [x] **T3.2** Migrate state sub-modules
  - `playback-tracker.js` — copy, update references
  - `live-scene-state.js` — copy, update references

- [x] **T3.3** Create `src/utils/query-cycle.js`
  - Extract `runConnectionQueryCycle()` and `runMediaLibraryQueryCycle()` from `instance.js`
  - Decouple from Companion instance

- [x] **T3.4** Create `src/utils/logger.js`
  - Simple logging abstraction replacing `self.log(level, msg)`
  - Console output with timestamps and levels
  - Later: file output option

### Phase 4: Server Layer

- [x] **T4.1** Create `src/server/http-server.js`
  - HTTP server on configurable port
  - Bind to `0.0.0.0` for LAN accessibility
  - Serve static files from `web/`
  - Route `/api/*` to API handlers
  - CORS headers for cross-origin access
  - Log startup URL with all LAN IPs

- [x] **T4.2** Create `src/server/ws-server.js`
  - WebSocket server (upgrade from HTTP)
  - Client management (add/remove/broadcast)
  - Handle incoming messages: `amcp`, `multiview_sync`, `selection_sync`
  - Initial state push on connect
  - Periodic state broadcast

### Phase 5: API Layer (split api-routes.js into domain routers)

- [x] **T5.1** Create `src/api/router.js` — main dispatcher
- [x] **T5.2** Create `src/api/routes-amcp.js` — play, stop, pause, resume, load, etc.
- [x] **T5.3** Create `src/api/routes-mixer.js` — all MIXER sub-commands
- [x] **T5.4** Create `src/api/routes-cg.js` — CG add, play, stop, update, etc.
- [x] **T5.5** Create `src/api/routes-state.js` — GET /api/state, /api/media, etc.
- [x] **T5.6** Create `src/api/routes-scene.js` — scene take endpoint
- [x] **T5.7** Create `src/api/routes-multiview.js` — multiview apply
- [x] **T5.8** Create `src/api/routes-timeline.js` — timeline CRUD + playback
- [x] **T5.9** Create `src/api/routes-config.js` — config apply/restart
- [x] **T5.10** Create `src/api/routes-media.js` — media refresh, thumbnails
- [x] **T5.11** Create `src/api/routes-data.js` — DATA + project save/load

### Phase 6: Engine Layer

- [x] **T6.1** Migrate scene transition engine (split `scene-transition.js`)
  - `src/engine/scene-transition.js` — diffing, bank management, utilities
  - `src/engine/scene-take.js` — actual take execution with AMCP

- [x] **T6.2** Migrate timeline engine (split `timeline-engine.js`)
  - `src/engine/timeline-engine.js` — data model, CRUD, keyframes
  - `src/engine/timeline-playback.js` — playback state, AMCP scheduling

- [x] **T6.3** Migrate support modules
  - `scene-native-fill.js` — copy, update references
  - `program-layer-bank.js` — copy

### Phase 7: Config & Routing

- [x] **T7.1** Migrate config generator (split `config-generator.js`)
  - `src/config/config-generator.js` — XML building
  - `src/config/config-modes.js` — video mode definitions + dimensions

- [x] **T7.2** Migrate routing
  - `src/config/routing.js` — channel map, routing setup

- [x] **T7.3** Migrate config comparison
  - `src/config/config-compare.js` — copy, update references

### Phase 8: Utility Modules

- [x] **T8.1** Migrate `persistence.js` → `src/utils/persistence.js`
- [x] **T8.2** Migrate `periodic-sync.js` → `src/utils/periodic-sync.js`
- [x] **T8.3** Migrate `handlers.js` → `src/utils/handlers.js`
- [x] **T8.4** Migrate `local-media.js` → `src/media/local-media.js`
- [x] **T8.5** Migrate `cinf-parse.js` → `src/media/cinf-parse.js`

### Phase 9: Web GUI Migration

- [x] **T9.1** Migrate base web files
  - `web/index.html` — update API/WS URLs (no more Companion instance path prefix)
  - `web/app.js` — update initialization
  - `web/styles.css` — copy as-is

- [x] **T9.2** Split large web components
  - `inspector-panel.js` → `inspector-panel.js` + `inspector-common.js` (drag inputs + keyframe defs) + `inspector-fill.js` + `inspector-mixer.js` + `inspector-transition.js`
  - `scenes-editor.js` → `scenes-editor.js` + `scenes-shared.js` (transition row + take payload + AMCP helpers) + `scene-list.js` + `scene-layer-row.js`
  - `dashboard.js` → `dashboard.js` + `dashboard-cell.js`
  - `timeline-editor.js` → `timeline-editor.js` + `timeline-transport.js`
  - *Follow-up (2026-04-04):* `scenes-editor.js` split into [`scenes-preview-runtime.js`](web/components/scenes-preview-runtime.js) (PRV push queue + AMCP), [`scenes-compose.js`](web/components/scenes-compose.js) (compose frame + drag/rotate/scale), slim [`scenes-editor.js`](web/components/scenes-editor.js) — all ≤500 lines.

- [x] **T9.3** Migrate remaining web components (under 500 lines — copy with path updates)
  - `timeline-canvas.js`, `multiview-editor.js`, `preview-canvas.js`
  - `sources-panel.js`, `header-bar.js`, `audio-mixer-panel.js`

- [x] **T9.4** Migrate web libraries (all under 500 lines — copy with path updates)
  - Update `api-client.js` — use relative URLs (no Companion instance prefix)
  - Update `ws-client.js` — connect to standalone WS server
  - Copy all remaining lib files

- [x] **T9.5** Migrate template files
  - `multiview_overlay.html` → `templates/`
  - `black.html` → `templates/`

### Phase 10: Integration & Wiring

- [x] **T10.1** Wire all modules together in main application class
- [x] **T10.2** Implement graceful startup sequence
- [x] **T10.3** Implement graceful shutdown (SIGINT, SIGTERM)
- [x] **T10.4** Test: `npm start` launches server, connects to CasparCG, serves web UI

---

## File Migration Map

| Source (companion-module) | Target (HighAsCG) | Action |
|---|---|---|
| `instance.js` | `index.js` + `src/utils/query-cycle.js` | Rewrite as standalone |
| `tcp.js` | `src/caspar/tcp-client.js` + `amcp-protocol.js` | Rewrite without Companion |
| `amcp.js` | `src/caspar/amcp-commands.js` | Copy + adapt |
| `amcp-batch.js` | `src/caspar/amcp-batch.js` | Copy + adapt |
| `api-routes.js` | `src/api/routes-*.js` (11 files) | Split into domain routers |
| `web-server.js` | `src/server/http-server.js` + `ws-server.js` | Rewrite for standalone |
| `state-manager.js` | `src/state/state-manager.js` | Copy + adapt |
| `routing.js` | `src/config/routing.js` | Copy + adapt |
| `scene-transition.js` | `src/engine/scene-transition.js` + `scene-take.js` | Split |
| `timeline-engine.js` | `src/engine/timeline-engine.js` + `timeline-playback.js` | Split |
| `config-generator.js` | `src/config/config-generator.js` + `config-modes.js` | Split |
| `playback-tracker.js` | `src/state/playback-tracker.js` | Copy + adapt |
| `live-scene-state.js` | `src/state/live-scene-state.js` | Copy + adapt |
| `persistence.js` | `src/utils/persistence.js` | Copy + adapt |
| `periodic-sync.js` | `src/utils/periodic-sync.js` | Copy + adapt |
| `handlers.js` | `src/utils/handlers.js` | Copy + adapt |
| `local-media.js` | `src/media/local-media.js` | Copy + adapt |
| `cinf-parse.js` | `src/media/cinf-parse.js` | Copy |
| `scene-native-fill.js` | `src/engine/scene-native-fill.js` | Copy + adapt |
| `program-layer-bank.js` | `src/engine/program-layer-bank.js` | Copy |
| `timeline-routes.js` | `src/api/routes-timeline.js` | Copy + adapt |
| `api-data.js` | `src/api/routes-data.js` | Copy + adapt |
| `config-compare.js` | `src/config/config-compare.js` | Copy + adapt |
| `ui-selection.js` | `src/state/ui-selection.js` | Copy + adapt |
| ~~`actions.js`~~ | — | Not migrated (Companion-only) |
| ~~`config-fields.js`~~ | — | Not migrated (Companion-only) |
| ~~`feedbacks.js`~~ | — | Not migrated (Companion-only) |
| ~~`presets.js`~~ | — | Not migrated (Companion-only) |
| ~~`variables.js`~~ | — | Not migrated (Companion-only) |
| ~~`polling.js`~~ | — | Not migrated (Companion-only) |
| ~~`config-upgrade.js`~~ | — | Not migrated (Companion-only) |
| All `web/` files | `web/` | Copy + adapt paths |

---

## Key Adaptation Points

### 1. Replace Companion TCPHelper
```javascript
// OLD (tcp.js)
const { TCPHelper, InstanceStatus } = require('@companion-module/base')
self.socket = new TCPHelper(self.config.host, port)

// NEW (tcp-client.js)
const net = require('net')
this.socket = new net.Socket()
this.socket.connect(port, host)
```

### 2. Replace self.log() with Logger
```javascript
// OLD
self.log('debug', 'Connected')

// NEW
const logger = require('./utils/logger')
logger.debug('Connected')
```

### 3. Replace Companion HTTP routing
```javascript
// OLD (instance.js handleHttpRequest)
async handleHttpRequest(request) { ... }

// NEW (http-server.js)
const server = http.createServer(requestHandler)
server.listen(port, '0.0.0.0')
```

### 4. Web UI API URLs
```javascript
// OLD (api-client.js)
const base = `/instance/${instanceName}/api`

// NEW (api-client.js)
const base = '/api'  // Direct to standalone server
```

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-04 — Agent
**Work Done:**
- **WO-02 doc hygiene:** Target tree **implementation note** — `amcp-client.js` + modular `amcp-*.js`, web split files (`scenes-preview-runtime`, `preview-canvas-draw`, `timeline-canvas-clip`, …). **Follow-up verification:** [`scripts/http-smoke.js`](scripts/http-smoke.js) + `npm run smoke -- PORT` (see [`20_WO_VERIFY_NODE_APP.md`](20_WO_VERIFY_NODE_APP.md)).

**Status:**
- WO-02 migration **complete**; ongoing QA in **20_WO**.

**Instructions for Next Agent:**
- Run `http-smoke` with Caspar connected; continue **20_WO** Phases 2–6 or Companion bridge WO.

### 2026-04-04 — Agent
**Work Done:**
- **Post-migration verification (see [`20_WO_VERIFY_NODE_APP.md`](20_WO_VERIFY_NODE_APP.md)):** Phase 1 — structure script updated for `amcp-client.js`, **23/23** paths; [`README.md`](README.md); `npm start` smoke OK; split [`preview-canvas`](web/components/preview-canvas.js) + [`timeline-canvas`](web/components/timeline-canvas.js) so every `src/` + `web/**/*.js` file ≤500 lines.

**Status:**
- WO-02 remains **complete**; verification work continues in **20_WO**.

**Instructions for Next Agent:**
- Continue [`20_WO_VERIFY_NODE_APP.md`](20_WO_VERIFY_NODE_APP.md) Phases 2–6 (Caspar + API + WS + browser), or Companion bridge WO.

### 2026-04-04 — Agent
**Work Done:**
- **T9.2 follow-up (≤500 lines):** Split [`scenes-editor.js`](web/components/scenes-editor.js) (~840 → ~417 lines) into [`scenes-preview-runtime.js`](web/components/scenes-preview-runtime.js) — `createScenesPreviewRuntime()` (debounced PRV push, serialized drain, `pushSceneToPreview` / AMCP batch); [`scenes-compose.js`](web/components/scenes-compose.js) — `createApplyNativeFillForSource`, `createComposeDragHandlers`, `renderComposeScene`; slim orchestrator [`scenes-editor.js`](web/components/scenes-editor.js). Updated T9.2 follow-up bullet in this WO.

**Status:**
- **T9.2** follow-up complete (project line-count goal for scenes editor).

**Instructions for Next Agent:**
- [`20_WO_VERIFY_NODE_APP.md`](20_WO_VERIFY_NODE_APP.md) verification pass with a live CasparCG; or start the Companion bridge work order (`../companion-module-highpass-highascg/04_WO_CREATE_COMPANION_MODULE.md`) per [`00_PROJECT_GOAL.md`](00_PROJECT_GOAL.md).

### 2026-04-04 — Agent
**Work Done:**
- **Phase 10 (T10.1–T10.4):** [`index.js`](index.js) — `ConnectionManager` from [`src/caspar/connection-manager.js`](src/caspar/connection-manager.js) with `config.caspar`; `appCtx.amcp` + `_casparStatus`; `status` / `error` listeners; WS `change` broadcast for `caspar.connection`; **`--no-caspar`** skips TCP (API keeps 503 for Caspar routes). Startup order: log → HTTP → WebSocket attach → Caspar `start()`. **Shutdown:** `SIGINT`/`SIGTERM` → `wsHandle.stop()` → `casparConnection.destroy()` → `appCtx.amcp = null` → `stopHttpServer`. [`get-state.js`](src/api/get-state.js) exposes **`caspar`** in full snapshot. Verified: `node index.js --port …` serves `/` (200), `/api/state` includes `caspar` (reconnects when Caspar down); `--no-caspar` → 503 on Caspar API routes.

**Status:**
- **T10.1**–**T10.4** complete. **Phase 10** complete.

**Instructions for Next Agent:**
- Optional: [`20_WO_VERIFY_NODE_APP.md`](20_WO_VERIFY_NODE_APP.md) smoke tests with a live CasparCG; or periodic sync / routing automation when ready.

### 2026-04-04 — Agent
**Work Done:**
- **T9.2** Large web component splits under [`web/components/`](web/): **Inspector** — [`inspector-common.js`](web/components/inspector-common.js), [`inspector-fill.js`](web/components/inspector-fill.js), [`inspector-mixer.js`](web/components/inspector-mixer.js), [`inspector-transition.js`](web/components/inspector-transition.js), slim [`inspector-panel.js`](web/components/inspector-panel.js) (≤500 lines). **Dashboard** — [`dashboard-cell.js`](web/components/dashboard-cell.js). **Scenes** — [`scenes-shared.js`](web/components/scenes-shared.js), [`scene-list.js`](web/components/scene-list.js), [`scene-layer-row.js`](web/components/scene-layer-row.js). **Timeline** — [`timeline-transport.js`](web/components/timeline-transport.js). **`styles.css`** unchanged (WO copy as-is). **`scenes-editor.js`** still ~840 lines — remaining compose/preview/drag blocks should be extracted in a follow-up to meet the ≤500-line goal.

**Status:**
- **T9.2** complete (with follow-up note for `scenes-editor.js` length).

**Instructions for Next Agent:**
- Optional: split [`scenes-editor.js`](web/components/scenes-editor.js) further (compose + preview push), or proceed **Phase 10** integration.

### 2026-04-04 — Agent
**Work Done:**
- **Phase 9 (bulk):** Copied companion [`src/web/`](../companion-module-casparcg-server/src/web/) → [`web/`](web/) (30 files: `index.html`, `app.js`, `styles.css`, `components/*`, `lib/*`). **T9.1:** `index.html` title/header **HighAsCG**; `api-client` / `ws-client` already use relative `/api/...` and `getApiBase()` for optional `/instance/ID`. **T9.3–T9.4:** same-origin fetch + WebSocket `…/api/ws` (matches [`ws-server.js`](src/server/ws-server.js)). **T9.5:** [`templates/multiview_overlay.html`](templates/multiview_overlay.html) + [`templates/black.html`](templates/black.html) from companion `src/templates/`. **`styles.css`** ~2452 lines (WO copy as-is).

**Status:**
- **T9.1**, **T9.3**, **T9.4**, **T9.5** complete.

**Instructions for Next Agent:**
- **Phase 10** integration, or further web splits if desired.

---

### 2026-04-04 — Agent
**Work Done:**
- **T8.4 / T8.5:** Verified [`src/media/local-media.js`](src/media/local-media.js) vs companion [`local-media.js`](../companion-module-casparcg-server/src/local-media.js) — `resolveSafe`, `probeMedia`, `extractWaveform`, `handleLocalMedia`, `extractThumbnailPng`, `tryLocalThumbnailPng`; uses shared [`response.js`](src/api/response.js) for JSON helpers; also exports **`extractWaveform`** for routes. [`src/media/cinf-parse.js`](src/media/cinf-parse.js) matches companion [`cinf-parse.js`](../companion-module-casparcg-server/src/cinf-parse.js) (`parseCinfMedia`). Wired from [`routes-media`](src/api/routes-media.js), [`routes-state`](src/api/routes-state.js), [`get-state`](src/api/get-state.js), state engines. Added `src/media/local-media.js` to [`scripts/verify-w02-structure.js`](scripts/verify-w02-structure.js).

**Status:**
- **T8.4** and **T8.5** complete. **Phase 8 (Utility modules)** complete.

**Instructions for Next Agent:**
- **Phase 9** web GUI migration, or **Phase 10** Caspar connection + app wiring.

---

### 2026-04-04 — Agent
**Work Done:**
- **T8.2:** Added [`src/utils/periodic-sync.js`](src/utils/periodic-sync.js) from companion [`periodic-sync.js`](../companion-module-casparcg-server/src/periodic-sync.js): `getSyncChannelIds`, `runPeriodicSync`, `startPeriodicSync` (interval **commented out** by default), `clearPeriodicSyncTimer`. Uses [`query-cycle`](src/utils/query-cycle.js) `responseToStr` / `updateChannelVariablesFromXml`, [`live-scene-reconcile`](src/state/live-scene-reconcile.js) `reconcileLiveSceneFromGatheredXml`, [`playback-tracker`](src/state/playback-tracker.js). Connection check: `amcp.info` + optional `socket.isConnected`. Extended [`live-scene-reconcile.js`](src/state/live-scene-reconcile.js) with companion-style **`reconcileLiveSceneFromGatheredXml`** / **`reconcileAfterInfoGather`** (allows **`media`** layer type like scene fill). 114 + 186 lines.

**Status:**
- **T8.2** complete.

**Instructions for Next Agent:**
- **T8.4** / **T8.5** — verify `local-media.js` / `cinf-parse.js`, or **Phase 9** web, or **T10**.

---

### 2026-04-04 — Agent
**Work Done:**
- **T7.3:** Added [`src/config/config-compare.js`](src/config/config-compare.js) from companion [`config-compare.js`](../companion-module-casparcg-server/src/config-compare.js): `parseServerChannels` (xml2js), `buildModuleChannelExpectation`, `buildIssues`, `refreshConfigComparison` → `ctx._configComparison` (already surfaced in [`get-state.js`](src/api/get-state.js)). Imports [`./routing`](src/config/routing.js) + [`./config-generator`](src/config/config-generator.js) `getModeDimensions`. User-facing strings say **app** instead of **module**; hint references **T10** wiring. 157 lines.

**Status:**
- **T7.3** complete. **Phase 7 (Config & routing)** complete.

**Instructions for Next Agent:**
- **Phase 8** — **T8.2** `periodic-sync`, **T8.4**/**T8.5** media utils, or **Phase 10** integration.

---

### 2026-04-04 — Agent
**Work Done:**
- **T7.2:** Expanded [`src/config/routing.js`](src/config/routing.js) from `getChannelMap` only to full companion [`routing.js`](../companion-module-casparcg-server/src/routing.js): `getRouteString`, `routeToLayer`, `setupInputsChannel`, `setupPreviewChannel`, `setupMultiview`, `setupAllRouting`. Template deploy uses repo [`templates/`](../templates/) via `path.join(__dirname, '..', '..', 'templates')`. Persisted multiview restore calls [`handleMultiviewApply`](src/api/routes-multiview.js) with **lazy** `require('../api/routes-multiview')` (same pattern as companion `api-routes`). ≤500 lines (`wc -l`).

**Status:**
- **T7.2** complete.

**Instructions for Next Agent:**
- **T7.3** — [`config-compare.js`](src/config/config-compare.js) from companion, or **Phase 8** / **T10**.

---

### 2026-04-04 — Agent
**Work Done:**
- **T7.1:** Ported companion [`config-generator.js`](../companion-module-casparcg-server/src/config-generator.js) into [`src/config/config-modes.js`](src/config/config-modes.js) (`STANDARD_VIDEO_MODES`, `calculateCadence`, `getModeDimensions`, `AUDIO_LAYOUT_CHOICES`, `layoutChannelCount`, `getExtraAudioModeDimensions`, `getStandardModeChoices`) + [`src/config/config-generator.js`](src/config/config-generator.js) (XML builders, `buildConfigXml`, same `module.exports` surface as companion). Both files ≤500 lines. [`scene-native-fill.js`](src/engine/scene-native-fill.js) **`getChannelResolutionForChannel`** now uses **`getModeDimensions`** (parity with companion scene fill sizing).

**Status:**
- **T7.1** complete.

**Instructions for Next Agent:**
- **T7.2** — extend [`routing.js`](src/config/routing.js) with companion `getRouteString`, `routeToLayer`, `setup*` helpers when **T10** wires `amcp`, or **T7.3** `config-compare`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T6.3:** Verified engine support modules vs companion: [`src/engine/program-layer-bank.js`](src/engine/program-layer-bank.js) matches [`program-layer-bank.js`](../companion-module-casparcg-server/src/program-layer-bank.js) (`normalizeProgramLayerBank`). [`src/engine/scene-native-fill.js`](src/engine/scene-native-fill.js) — same FILL math and exports as companion [`scene-native-fill.js`](../companion-module-casparcg-server/src/scene-native-fill.js); imports updated to [`../media/cinf-parse`](src/media/cinf-parse.js) and [`../config/routing`](src/config/routing.js). Channel pixel size from **`getModeDimensions`** added in **T7.1** (see Work Log). Consumed by [`scene-take.js`](src/engine/scene-take.js) and [`scene-transition.js`](src/engine/scene-transition.js). `node -e` require smoke test OK.

**Status:**
- **T6.3** complete. **Phase 6 (Engine layer)** complete.

**Instructions for Next Agent:**
- **Phase 7** — **T7.2** [`routing.js`](src/config/routing.js) if not fully ported, or **T7.1** config generator split; or **Phase 10** Caspar wiring.

---

### 2026-04-04 — Agent
**Work Done:**
- **T6.2:** Migrated companion [`timeline-engine.js`](../companion-module-casparcg-server/src/timeline-engine.js) into [`src/engine/timeline-engine.js`](src/engine/timeline-engine.js) (CRUD, maps, `_interpProp` / `_lerp` / `_clipAt`, `_emitChange`) + [`src/engine/timeline-playback.js`](src/engine/timeline-playback.js) (`applyPlaybackMixin` — ticker, `play`/`pause`/`stop`/`seek`, `_applyAt`/`_applyKf`, routing via [`config/routing`](src/config/routing.js) `getChannelMap` instead of `./routing`). [`index.js`](index.js) sets **`appCtx.timelineEngine = new TimelineEngine(appCtx)`** so [`routes-timeline.js`](src/api/routes-timeline.js) no longer returns **503** for missing engine. Files ≤500 lines (`wc -l`).

**Status:**
- **T6.2** complete.

**Instructions for Next Agent:**
- **T6.3** — verify/copy `scene-native-fill.js` and `program-layer-bank.js` per WO, or **T10** wire Caspar connection + `appCtx.amcp`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T6.1:** Scene transition split — [`runSceneTake`](src/engine/scene-take.js) (AMCP batch load, bank crossfade, playback tracker); [`src/engine/scene-transition.js`](src/engine/scene-transition.js) keeps diffing, `runTimelineOnlyTake`, and exports `resolveChannelFramerateForMixerTween` + `persistProgramLayerBanks` for the take module; `module.exports.runSceneTake = require('./scene-take').runSceneTake` avoids circular `require` at load time. Files ≤500 lines (`wc -l`). Smoke: `require('./scene-transition')`, `require('./routes-scene')`.

**Status:**
- **T6.1** complete.

**Instructions for Next Agent:**
- **T6.3** / **T10** — see latest Work Log.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.11:** [`src/api/routes-data.js`](src/api/routes-data.js) — Ported companion [`api-data.js`](../companion-module-casparcg-server/src/api-data.js): **`POST /api/project/save`** (AMCP `DATA STORE` `casparcg_web_project`), **`POST /api/project/load`**, **`POST /api/data/:cmd`** (`store`, `retrieve`, `list`, `remove`). **`handlePost`** runs **`handleProject`** then **`handleData`**. Requires **`ctx.amcp`**. **Phase 5** API route tasks (**T5.1–T5.11**) complete.

**Status:**
- **T5.11** complete. **Phase 5 (API layer)** complete.

**Instructions for Next Agent:**
- **Phase 6** engine work, **Phase 10** integration, or **T5.x** verification pass / smoke tests against Caspar.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.10:** [`src/api/routes-media.js`](src/api/routes-media.js) — `handleThumbnail` (`/api/thumbnail(s)/…`, `/api/thumbnails`), `handleLocalMedia` → [`local-media.js`](src/media/local-media.js), `POST /api/media/refresh` via `ctx.runMediaLibraryQueryCycle` or `ctx.runConnectionQueryCycle`. Expanded [`local-media.js`](src/media/local-media.js): `extractWaveform`, `extractThumbnailPng`, `tryLocalThumbnailPng`, `GET /api/local-media/:path/:type` (waveform, probe). Overlaps **T8.4** (local-media migration).

**Status:**
- **T5.10** complete.

**Instructions for Next Agent:**
- **T5.11** — [`routes-data.js`](src/api/routes-data.js) from companion `api-data.js` (project + DATA).

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.9:** [`src/api/routes-config.js`](src/api/routes-config.js) — `POST /api/config/apply` with `apply` truthy → calls optional **`ctx.applyServerConfigAndRestart()`** (companion `instance.applyServerConfigAndRestart`); missing body flag → **400**; hook missing → **501** (standalone until **T10** wires config generator + restart). **`GET /api/config`** remains in [`routes-state.js`](src/api/routes-state.js) (INFO CONFIG XML). Server **`/api/restart`** stays on [`routes-amcp.js`](src/api/routes-amcp.js).

**Status:**
- **T5.9** complete.

**Instructions for Next Agent:**
- **T5.10** — [`routes-media.js`](src/api/routes-media.js) thumbnails + media refresh (see companion `handleThumbnail`, `handleMediaRefresh`).

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.8:** [`src/api/routes-timeline.js`](src/api/routes-timeline.js) — Ported companion [`timeline-routes.js`](../companion-module-casparcg-server/src/timeline-routes.js): `GET/POST /api/timelines`, `GET/PUT/DELETE /api/timelines/:id`, `GET .../state`, `POST .../play|take|pause|stop|seek|sendto|loop`. Uses [`response.js`](src/api/response.js), [`config/routing`](src/config/routing.js), [`live-scene-state`](src/state/live-scene-state.js) for `take`. **`503`** when `ctx.timelineEngine` is missing; **`take`** also checks `ctx.amcp`. Re-exports **`handleTimelineRoutes`**. Timeline data engine remains **T6.2** — assign `ctx.timelineEngine` when ready.

**Status:**
- **T5.8** complete.

**Instructions for Next Agent:**
- **T5.9** — [`routes-config.js`](src/api/routes-config.js) (config apply / restart hooks), or **T6.2** + wire **`timelineEngine`** on `ctx`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.7:** [`src/api/routes-multiview.js`](src/api/routes-multiview.js) — Ported companion `handleMultiviewApply`: `POST /api/multiview/apply` (layout cells, `showOverlay`, INFO pre-check, route cells, PLAY + MIXER FILL, overlay HTML via CG or PLAY+CALL, 25s timeout → **504**, persist `multiviewLayout` + `ctx._multiviewLayout`). Template deploy from [`templates/multiview_overlay.html`](templates/multiview_overlay.html) when present. [`index.js`](index.js) restores `_multiviewLayout` from persistence on startup.

**Status:**
- **T5.7** complete.

**Instructions for Next Agent:**
- **T5.8** — [`routes-timeline.js`](src/api/routes-timeline.js) from companion `timeline-routes.js`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.6:** [`src/api/routes-scene.js`](src/api/routes-scene.js) — `handleSceneTake` / `POST /api/scene/take` (validation, per-channel `_sceneTakeChainByChannel`, 120s timeout, 504/500 errors, success body with `sceneLive` + `playbackMatrix`) wired in [`router.js`](src/api/router.js) before `routes-misc`. Engine: [`scene-transition.js`](src/engine/scene-transition.js) (≤500 lines after split) + [`scene-exit-layers.js`](src/engine/scene-exit-layers.js) + [`scene-native-fill.js`](src/engine/scene-native-fill.js) (no `config-generator`; 1920×1080 defaults) + [`program-layer-bank.js`](src/engine/program-layer-bank.js). [`index.js`](index.js) hydrates `programLayerBankByChannel` from persistence. Timeline-only takes require `ctx.timelineEngine` (**T5.8/T6.2**) or they throw.

**Status:**
- **T5.6** complete. **T6.1** completed later (see Work Log): `scene-take.js` + re-export from `scene-transition.js`.

**Instructions for Next Agent:**
- **T5.7** — multiview apply route, or **T5.8** timeline routes + `timelineEngine` on `ctx`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.5:** [`src/api/routes-state.js`](src/api/routes-state.js) — Parity with companion `handleStateGet`: **`GET /api/state`** kicks off async `ffprobe` via `_mediaProbeCache` / `_mediaProbePopulating` when `local_media_path` is set (feeds [`get-state.js`](src/api/get-state.js)); **`GET /api/media`** awaits probe merge into list items; **`/api/variables`**, **`/api/templates`**, **`/api/channels`**, **`/api/config`** unchanged aside from **`/api/config`** `Content-Type: text/xml` (no charset) like companion. Added [`src/media/local-media.js`](src/media/local-media.js) with **`resolveSafe`** + **`probeMedia`** only (waveform/thumbnail/`handleLocalMedia` still **T8.4** / **T5.10**).

**Status:**
- **T5.5** complete.

**Instructions for Next Agent:**
- **T5.6** — [`routes-scene.js`](src/api/routes-scene.js) / [`routes-misc.js`](src/api/routes-misc.js) scene take, or continue route stubs.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.4:** [`src/api/routes-cg.js`](src/api/routes-cg.js) — Ported companion `handleCg`: `POST /api/cg/:cmd` for add, remove, clear, play, stop, next, goto, update, invoke, info (`templateHostLayer` default **1**). Unknown command → **400**. Non-`/api/cg/...` → **`null`**. Exceptions propagate to [`router.js`](src/api/router.js) (same as companion).

**Status:**
- **T5.4** complete.

**Instructions for Next Agent:**
- **T5.5** — extend [`routes-state.js`](src/api/routes-state.js) if anything still missing vs companion `handleStateGet`, or mark done if parity reached.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.3:** [`src/api/routes-mixer.js`](src/api/routes-mixer.js) — Ported companion `handleMixer` / `handleMixerSafe`: `POST /api/mixer/:cmd` for keyer, blend, opacity, brightness, saturation, contrast, levels, fill (stretch + `queryLayerContentRes` + `calcStretchFill`), clip, anchor, crop, rotation, volume, mastervolume, grid, commit, clear. Unknown subcommand → **400**; connection-like errors → **503**, else **502** (matches companion). `handlePost` returns `null` when path is not `/api/mixer/...`.

**Status:**
- **T5.3** complete.

**Instructions for Next Agent:**
- **T5.4** — [`routes-cg.js`](src/api/routes-cg.js) from companion `handleCg`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.2:** [`src/api/routes-amcp.js`](src/api/routes-amcp.js) — Migrated from companion `handleAmcpBasic`: `POST /api/amcp/batch`, `/api/play`, `/api/loadbg`, `/api/load`, `/api/pause`, `/api/resume`, `/api/stop`, `/api/clear`, `/api/call`, `/api/swap`, `/api/add`, `/api/remove`; plus `/api/restart`, `/api/kill`, `/api/raw` (same behavior as legacy `handleMisc` for those three). Uses [`playback-tracker`](src/state/playback-tracker.js) + [`notifyProgramMutationMayInvalidateLive`](src/state/live-scene-state.js) like companion. Mock smoke: `restart` → 200. **`ctx.amcp`** must be set (e.g. future `ConnectionManager` wiring) for routes to run; router still returns 503 when disconnected.

**Status:**
- **T5.2** complete.

**Instructions for Next Agent:**
- **T5.3** — `routes-mixer.js` from companion `handleMixer` / `handleMixerSafe`.
- Or wire **`ConnectionManager`** + **`appCtx.amcp`** so POST AMCP endpoints are reachable against a real Caspar.

---

### 2026-04-04 — Agent
**Work Done:**
- **T5.1:** [`src/api/router.js`](src/api/router.js) — `routeRequest` + `getState` re-export; domain stubs + [`routes-state.js`](src/api/routes-state.js) GET handlers; [`routes-media.js`](src/api/routes-media.js) `handlePost` stub for POST chain. [`index.js`](index.js) builds `appCtx` (`gatheredInfo`, choices, `amcp: null`, `getState: () => getState(appCtx)`) and passes `routeApi` into [`startHttpServer`](src/server/http-server.js). Removed duplicate `if (r)` and `routes-scene` from POST chain (scene take lives under **T5.6** / misc). Smoke: `GET /api/state` → **503** without Caspar; `GET /api/scene/live` → **200**.

**Status:**
- **T5.1** complete. **T5.5–T5.11** still open (stubs or partial).

**Instructions for Next Agent:**
- **T5.2** — migrate AMCP routes from companion `api-routes.js` into `routes-amcp.js`.
- Wire **`ConnectionManager`** in `index.js`, set **`appCtx.amcp`** when connected so **`GET /api/state`** and POST routes can run (currently all guarded routes return 503 until `amcp` is set).

---

### 2026-04-04 — Agent
**Work Done:**
- **T4.2:** [`src/server/ws-server.js`](src/server/ws-server.js) — `attachWebSocketServer(httpServer, ctx, { stateBroadcastIntervalMs, log })`; upgrade paths `/api/ws` + `/ws`; `ctx._wsBroadcast(event, data)`; messages `amcp` → `amcp_result`, `multiview_sync` (persistence), `selection_sync` (optional `setUiSelection`); initial `{ type: 'state', data }` from `getState()` / `state.getState()`; optional periodic `state` via `--ws-broadcast-ms` or `HIGHASCG_WS_BROADCAST_MS`. [`index.js`](index.js) wires `StateManager` + `persistence`, shutdown closes WS then HTTP.

**Status:**
- **T4.2** complete. **Phase 4 (Server layer)** complete.

**Instructions for Next Agent:**
- **Phase 5** — `src/api/router.js` and route modules; replace HTTP `defaultRouteApi` and optionally enrich WS snapshot like companion `getState`.

---

### 2026-04-04 — Agent
**Work Done:**
- **T4.1:** [`src/server/http-server.js`](src/server/http-server.js) — `startHttpServer` / `stopHttpServer` / `serveWebApp`; `bindAddress` default `0.0.0.0`; CORS via [`src/server/cors.js`](src/server/cors.js); LAN + localhost URLs on listen; `/api/*` uses injectable `routeApi` (default **503** JSON until **T5.1**). [`web/index.html`](web/index.html) placeholder. [`index.js`](index.js) starts HTTP, SIGINT/SIGTERM shutdown, `--no-http` for config-only exit.

**Status:**
- **T4.1** complete.

**Instructions for Next Agent:**
- **T4.2** — WebSocket (`ws`): upgrade `/api/ws` + `/ws`, broadcast API, wire to app context (reuse patterns from `companion-module-casparcg-server/src/web-server.js`).

---

### 2026-04-04 — Agent
**Work Done:**
- **T3.3:** [`src/utils/query-cycle.js`](src/utils/query-cycle.js) — `attachEnqueueQueue`, `responseToStr`, `runMediaLibraryQueryCycle`, `runConnectionQueryCycle`, `updateChannelVariablesFromXml`; Companion-only steps are optional `ctx` hooks (`setupAllRouting`, `reconcileAfterInfoGather`, `startPeriodicSync`, etc.). [`src/utils/handlers.js`](src/utils/handlers.js) — `handleCLS` / `handleTLS` (no `executeGOTO` yet). **T8.3** satisfied for CLS/TLS subset.

**Status:**
- **T3.3** complete. **Phase 3 (State Management)** complete.

**Instructions for Next Agent:**
- **Phase 4** — `src/server/http-server.js` (**T4.1**), then **T4.2** WebSocket; wire `ConnectionManager` + query cycle on connect.

---

### 2026-04-04 — Agent
**Work Done:**
- **T3.2:** [`src/state/playback-tracker.js`](src/state/playback-tracker.js) — `self` → **`ctx`** (app context with `_playbackMatrix`, `state`, `gatheredInfo`, etc.). [`src/state/live-scene-state.js`](src/state/live-scene-state.js) — same behavior; uses [`src/utils/persistence.js`](src/utils/persistence.js) (`.highascg-state.json`) and [`src/config/routing.js`](src/config/routing.js) `getChannelMap` only.
- [`src/state/live-scene-reconcile.js`](src/state/live-scene-reconcile.js) — `pathsMatch`, `normPath`, `parseLayerFgClipsFromChannelXml` for playback reconcile (full scene reconcile deferred to engine migration).
- **T8.1** checked off (persistence). `.gitignore` updated for `.highascg-state.json`.

**Status:**
- **T3.2** complete. **T8.1** complete.

**Instructions for Next Agent:**
- **T3.3** — `src/utils/query-cycle.js` from `instance.js` (wire to `ConnectionManager` + `AmcpCommands` + `StateManager`).
- **T7.2** — still need full `routing.js` (setupInputs, multiview, etc.); only `getChannelMap` exists under `src/config/routing.js`.

---

### 2026-04-04 — Agent
**Work Done:**
- Added [`src/utils/logger.js`](src/utils/logger.js): `createLogger({ minLevel })`, `defaultLogger`, ISO timestamps.
- Added [`src/media/cinf-parse.js`](src/media/cinf-parse.js) (needed by state-manager; overlaps future **T8.5**).
- Added [`src/state/state-manager.js`](src/state/state-manager.js): migrated from companion; `constructor({ logger, gatheredInfo, variables })` instead of `self`; `gatheredInfo.channelStatusLines` + `variables` for `getState()`; all former `self.log` → `this._logger.debug`.

**Status:**
- **T3.1** and **T3.4** complete.

**Instructions for Next Agent:**
- **T3.2** — migrate `playback-tracker.js` and `live-scene-state.js` into `src/state/`.
- **T3.3** — extract `query-cycle.js` from `instance.js`.

---

### 2026-04-04 — Agent
**Work Done:**
- Added [`src/caspar/connection-manager.js`](src/caspar/connection-manager.js): `ConnectionManager` extends `EventEmitter`; owns `TcpClient`, shared AMCP `context`, `AmcpProtocol`, `AmcpCommands`; wires `data` → `handleLine`; `protocol.reset()` on TCP `connected`; `start` / `stop` / `destroy`; periodic `amcp.version()` when `healthIntervalMs` > 0 (default 30s); emits `status` (`connected`, `host`, `port`, `versionLine`, `healthError`, `error`) and `error` for TCP.

**Status:**
- **T2.5** complete. **Phase 2 (Caspar connection layer)** complete.

**Instructions for Next Agent:**
- **Phase 3** — begin **T3.1** `src/state/state-manager.js` migration + **T3.4** `src/utils/logger.js` if you want logging before state.

---

### 2026-04-04 — Agent
**Work Done:**
- Added [`src/caspar/amcp-commands.js`](src/caspar/amcp-commands.js): migrated from `amcp.js`; `constructor(connection)` takes `AmcpConnectionContext` (`socket` = `TcpClient`, `response_callback`, `_pendingResponseKey`, optional `config` / `log` for batching). Re-exports `param`, `chLayer`.
- Added [`src/caspar/amcp-batch.js`](src/caspar/amcp-batch.js): migrated from `amcp-batch.js`; `sendBatchTransaction(connection, …)` uses `connection.config?.amcp_batch` and optional `connection.log` (T2.4 done so `batchSend` resolves).

**Status:**
- **T2.3** and **T2.4** complete.

**Instructions for Next Agent:**
- **T2.5** — `src/caspar/connection-manager.js`: create `TcpClient`, shared context object, `AmcpProtocol`, wire `tcp.on('data')` → `protocol.handleLine`, attach `AmcpCommands`, optional VERSION health timer.

---

### 2026-04-04 — Agent
**Work Done:**
- Added [`src/caspar/amcp-protocol.js`](src/caspar/amcp-protocol.js): exports `RETCODE`, `RETCODE2TYPE`, `ACMP_STATE`, class `AmcpProtocol` with `handleLine(line)` and `reset()`; uses injected `context` (`response_callback`, `_pendingResponseKey`, `_amcpBatchDrain`, `runCommandQueue`) matching legacy `tcp.js` / `amcp.js` behavior. Smoke-tested 202 / 201 / 200 paths.

**Status:**
- **T2.2** complete.

**Instructions for Next Agent:**
- **T2.3** — Copy `companion-module-casparcg-server/src/amcp.js` → `src/caspar/amcp-commands.js`; replace `self` with a small facade that holds `TcpClient`, `AmcpProtocol` context, and `_amcpSendQueue`.

---

### 2026-04-04 — Agent
**Work Done:**
- Implemented [`src/caspar/tcp-client.js`](src/caspar/tcp-client.js): `TcpClient` extends `EventEmitter`, `net.Socket` + CRLF line buffering, emits `data` per line, `connected` / `disconnected` / `error`, exponential backoff auto-reconnect (cleared on intentional `disconnect()` / `destroy()`), `send()` / `isConnected` compatible with prior `socket.send` usage.

**Status:**
- **T2.1** complete.

**Instructions for Next Agent:**
- **T2.2** — Extract AMCP state machine from `companion-module-casparcg-server/src/tcp.js` into `src/caspar/amcp-protocol.js`, feeding lines from `TcpClient` `data` events (no Companion deps).

---

### 2026-04-04 — Agent
**Work Done:**
- Added `package.json` (`highascg`, `start` / `dev`, `ws` + `xml2js`, `engines.node >= 22`).
- Added `.gitignore`, `.nvmrc` (22), `config/default.js` (env + defaults for Caspar + HTTP/WS/bind).
- Added `index.js`: CLI (`--port`, `--ws-port`, `--caspar-host`, `--caspar-port`, `--bind`, `--help`), merges overrides into loaded config, prints JSON config and exits (scaffolding until Phase 4 HTTP server).
- Ran `npm install`; verified `node index.js` and `node index.js --help`.

**Status:**
- Phase 1 complete: **T1.1**, **T1.2**, **T1.3** checked off.

**Instructions for Next Agent:**
- Begin **Phase 2**: implement `src/caspar/tcp-client.js` (**T2.1**), then AMCP protocol/commands (**T2.2–T2.4**), then **T2.5** connection-manager.
- When wiring `index.js` to a long-running process, replace the exit-after-print with startup of Caspar + HTTP/WS per Phases 2–4; keep graceful shutdown for **T10.3** later.

---

### YYYY-MM-DD — Agent Name
**Work Done:**
- (describe what was completed)

**Status:**
- (which tasks were completed)

**Instructions for Next Agent:**
- (what needs to happen next, any blockers or decisions needed)

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
