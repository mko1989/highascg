# Work Order 01: Analyze Companion Module (companion-module-casparcg-server)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Perform a thorough deep-dive analysis of the existing `companion-module-casparcg-server` codebase. The output is a **detailed understanding** of every module, its responsibilities, dependencies, and how it maps to the target HighAsCG architecture. This analysis is a prerequisite for Work Order 02 (migration).

## Source Location

```
/Users/marcin/companion-module-dev/companion-module-casparcg-server/
```

## Codebase Stats

- **Total lines**: ~17,744 across 64 JS files
- **Server-side modules**: 36 files in `src/`
- **Web UI**: 10 components + 17 lib files in `src/web/`
- **Dependencies**: `@companion-module/base`, `ws`, `xml2js`

---

## Tasks

### Phase 1: Server-Side Module Analysis

- [x] **T1.1** Analyze `instance.js` (522 lines) — Main module class
  - Document constructor setup (AmcpCommands, StateManager, TimelineEngine)
  - Map init flow: config → variables → actions → feedbacks → presets → TCP → API server
  - Document `runConnectionQueryCycle()` — full AMCP query chain (CLS→CINF→TLS→VERSION→INFO)
  - Document `handleHttpRequest()` — how Companion routes HTTP to API
  - Identify what is Companion-specific vs. reusable in HighAsCG

- [x] **T1.2** Analyze `tcp.js` (193 lines) — TCP connection + AMCP protocol parser
  - Document the AMCP state machine: NEXT → SINGLE_LINE / MULTI_LINE
  - Document return codes and callback dispatch mechanism
  - Identify dependency on `@companion-module/base` (TCPHelper, InstanceStatus)
  - **Migration note**: This MUST be reimplemented with raw `net.Socket` for standalone

- [x] **T1.3** Analyze `amcp.js` (420 lines) — AMCP command abstraction
  - Document the `_send()` method — serialized command queue via Promise chain
  - Map all AMCP methods: Basic (PLAY/STOP/etc.), Mixer, CG, Data, Query, Thumbnail
  - Document the `batchSend()` mechanism (BEGIN/COMMIT transactions)
  - **Migration note**: This is fully reusable — no Companion dependency

- [x] **T1.4** Analyze `api-routes.js` (1,107 lines) — HTTP API dispatch
  - Map all 50+ API endpoints with method, path, handler function
  - Document `getState()` — the state snapshot assembly
  - Document `handleMultiviewApply()` — complex multiview layout logic
  - Document `handleSceneTake()` — scene transition orchestration via API
  - **Migration note**: Split into domain-specific route files (≤500 lines each)

- [x] **T1.5** Analyze `web-server.js` (179 lines) — HTTP + WebSocket server
  - Document standalone server setup (http.createServer + ws.Server)
  - Document WebSocket message handling (amcp, multiview_sync, selection_sync)
  - Document `_wsBroadcast` mechanism
  - **Migration note**: Core of HighAsCG server — needs enhancement for LAN binding

- [x] **T1.6** Analyze `state-manager.js` (278 lines) — Centralized state
  - Document state schema (channels, media, templates, serverInfo, decklinkInputs, routes)
  - Document EventEmitter change tracking + delta mechanism
  - Document XML parsing from INFO responses
  - **Migration note**: Fully reusable

- [x] **T1.7** Analyze `routing.js` (302 lines) — Channel map + routing
  - Document `getChannelMap()` — screen count, program/preview channels, multiview, inputs
  - Document `setupAllRouting()` — preview channels, inputs, multiview restore
  - **Migration note**: Fully reusable

- [x] **T1.8** Analyze `scene-transition.js` (518 lines) — Scene/look transitions
  - Document A/B bank crossfade system (PGM_BANK_B_OFFSET = 100)
  - Document `diffScenes()` — enter/exit/update/unchanged layer diffing
  - Document `runSceneTake()` — batch AMCP orchestration
  - Document `runTimelineOnlyTake()` — timeline-specific take logic
  - **Migration note**: Fully reusable, needs splitting (batch PLAY vs. crossfade logic)

- [x] **T1.9** Analyze `timeline-engine.js` (509 lines) — Timeline model + playback
  - Document CRUD operations, playback state machine (play/pause/stop/seek)
  - Document `_applyAt()` — AMCP command scheduling per tick
  - Document keyframe interpolation (`_lerp`, `_interpProp`)
  - **Migration note**: Fully reusable

- [x] **T1.10** Analyze remaining server-side modules
  - `config-fields.js` (592 lines) — Companion config UI definitions
  - `config-generator.js` (533 lines) — CasparCG XML config generation
  - `config-compare.js` (157 lines) — Live vs. generated config comparison
  - `actions.js` (598 lines) — Companion button action definitions
  - `cg-actions.js` (239 lines) — CG template actions
  - `mixer-actions.js` (193 lines) — Mixer actions
  - `data-actions.js` (103 lines) — DATA command actions
  - `selection-actions.js` (55 lines) — UI selection actions
  - `feedbacks.js` (47 lines) — Tally feedback definitions
  - `presets.js` (139 lines) — Dynamic preset generation
  - `variables.js` (185 lines) — Variable definitions
  - `polling.js` (21 lines) — Poll timer management
  - `handlers.js` (87 lines) — CLS/TLS response processors
  - `persistence.js` (87 lines) — JSON file persistence
  - `playback-tracker.js` (157 lines) — Play/stop state matrix
  - `live-scene-state.js` (123 lines) — Per-channel live scene snapshots
  - `live-scene-reconcile.js` (190 lines) — Reconciliation after INFO
  - `periodic-sync.js` (100 lines) — Periodic CLS/TLS sync
  - `local-media.js` (250 lines) — File-based media probe (ffprobe)
  - `cinf-parse.js` (28 lines) — CINF response parser
  - `ui-selection.js` (424 lines) — Web UI selection state sync
  - `amcp-batch.js` (141 lines) — BEGIN/COMMIT batch sender
  - `scene-native-fill.js` (195 lines) — Fill position calculation
  - `timeline-routes.js` (121 lines) — Timeline API endpoints
  - `api-data.js` (80 lines) — Project save/load handlers
  - `program-layer-bank.js` (14 lines) — Bank normalization utility

### Phase 2: Web UI Analysis

- [x] **T2.1** Analyze web architecture
  - `index.html` — Entry point, layout structure
  - `app.js` (173 lines) — App initialization, panel management
  - `styles.css` (43,866 bytes) — Full CSS, identify design system

- [x] **T2.2** Analyze web components (10 files)
  - `dashboard.js` (511 lines) — Column/layer grid with drag-and-drop
  - `scenes-editor.js` (1,125 lines) — Scene management + take system
  - `timeline-editor.js` (633 lines) — Timeline panel with transport
  - `timeline-canvas.js` (669 lines) — Canvas-based timeline rendering
  - `multiview-editor.js` (441 lines) — Multiview layout editor
  - `inspector-panel.js` (1,302 lines) — Property inspector
  - `sources-panel.js` (346 lines) — Media/template browser
  - `preview-canvas.js` (513 lines) — Live preview rendering
  - `header-bar.js` (200 lines) — Top navigation bar
  - `audio-mixer-panel.js` (303 lines) — Audio level controls

- [x] **T2.3** Analyze web libraries (17 files)
  - `api-client.js` (107 lines) — REST API wrapper
  - `ws-client.js` (120 lines) — WebSocket connection manager
  - `state-store.js` (69 lines) — Reactive state container
  - `dashboard-state.js` (361 lines) — Dashboard data model
  - `scene-state.js` (441 lines) — Scene data model
  - `timeline-state.js` (313 lines) — Timeline data model
  - `multiview-state.js` (262 lines) — Multiview data model
  - `project-state.js` (104 lines) — Project save/load state
  - `selection-sync.js` (169 lines) — Selection synchronization
  - `mixer-fill.js` (195 lines) — Mixer fill math for UI
  - `fill-math.js` (69 lines) — Fill calculation helpers
  - `math-input.js` (121 lines) — Mathematical input parser
  - `media-ext.js` (88 lines) — Media file extension helpers
  - `audio-mixer-state.js` (65 lines) — Audio state management
  - `scene-live-match.js` (76 lines) — Scene-to-live matching
  - `playback-clock.js` (25 lines) — Playback time tracking
  - `program-layer-bank.js` (9 lines) — Client-side bank helper

### Phase 3: Dependency & Migration Classification

- [x] **T3.1** Classify every file as:
  - 🟢 **Direct reuse** — No Companion dependency, copy as-is
  - 🟡 **Needs adaptation** — Uses Companion API that must be replaced
  - 🔴 **Companion-only** — Not migrated (actions, presets, feedbacks, config-fields)
  - 🔵 **New code needed** — Standalone server, LAN binding, CLI, etc.

- [x] **T3.2** Document all inter-module dependencies (require graph)

- [x] **T3.3** Identify shared libraries between HighAsCG and new Companion module

---

## Deliverables

1. Updated task list with all boxes checked — **done** (tasks T1.1–T3.3)
2. File-by-file classification table (🟢🟡🔴🔵) — **done** (Phase 3, T3.1)
3. Dependency graph — **done** (Phase 3, T3.2)
4. Notes on splitting strategy for files > 500 lines — **see** `00_PROJECT_GOAL.md` + T3.1 pointer
5. List of Companion SDK APIs used and their standalone replacements — **done** (Phase 3, Companion SDK table)

---

## T1.1 Analysis: `instance.js`

**Source:** `companion-module-casparcg-server/src/instance.js` (~522 lines)

### Constructor setup

- Extends `InstanceBase` from `@companion-module/base`.
- **`this.amcp`** — `AmcpCommands(this)`; AMCP send/queue API used across actions and API routes.
- **`this.state`** — `StateManager(this)`; central channel/media/template/server state + `EventEmitter` for WebSocket deltas.
- **`this.timelineEngine`** — `TimelineEngine(this)`; scheduled playback; instance wires `tick` / `playback` to `_wsBroadcast` in `_startApiServer()`.
- **`response_callback`** — Map of AMCP response keys (e.g. `CLS`, `INFO`, `DATA`) to callback queues; paired with `requestData()` and TCP receive logic in `tcp.js`.
- **Lists / caches:** `CHOICES_TEMPLATES`, `CHOICES_MEDIAFILES` (populated from CLS/TLS via handlers), `commandQueue` for serialized `enqueue`/`runCommandQueue`, `mediaDetails` (filename → CINF string), `gatheredInfo` (channel IDs, status lines, INFO PATHS/SYSTEM/CONFIG strings, per-channel XML, decklink hints from config).
- **`this.variables`** — Flat object mirrored to Companion variables (`setVariableValues`); pre-seeded keys for server info and example channel 1 layer 0 keys.

### Init flow (`init` → TCP → “API server”)

Order in `init(config)`:

1. **Config & UI state:** `this.config`, `_uiSelection = null`.
2. **Persistence:** `multiviewLayout`, `programLayerBankByChannel` (normalized via `normalizeProgramLayerBank`).
3. **Helpers:** `summarizeConsumersFromConfig` delegates to `variables.summarizeConsumersFromConfig`.
4. **`variables.initVariables(this)`** — Registers Companion variable definitions.
5. **`init_actions()`** — `setActionDefinitions(compileActionDefinitions(this))`.
6. **`feedbacks.initFeedbacks(this)`**, **`presets.initPresets(this)`** — Companion UI.
7. **`initTcp(this)`** — Creates `TCPHelper` socket; on **`connect`**, calls **`runConnectionQueryCycle()`** (full query chain).
8. **`_startApiServer()`** — In current design does **not** start a standalone HTTP server when traffic is via Companion; it stops any prior `apiServer`, clears `_wsBroadcast`, and **re-binds `timelineEngine` events** (`tick`, `playback`) to WebSocket broadcast when that path exists.
9. **`this.state.on('change', …)`** — Forwards state path/value changes to `_wsBroadcast('change', …)` for WebSocket clients.

`configUpdated` refreshes config comparison, re-inits TCP and API wiring, and may refresh `server_consumers_summary` from generated XML.

### `runConnectionQueryCycle()` — AMCP query chain

Clears `commandQueue`, `mediaDetails`, and `gatheredInfo`, then enqueues:

1. **`CLS`** → `handlers.handleCLS`, `state.updateFromCLS`.
2. **Optional `CINF`** per media file (up to `max_cinf`, if `query_cinf` enabled) — fills `mediaDetails`.
3. **`TLS`** → merge `mediaDetails` into state via `state.updateMediaDetails`, `handlers.handleTLS`, `state.updateFromTLS`.
4. **`VERSION`** (server) → variables + `state.updateServerInfo({ version })`.
5. **`VERSION FLASH`** / **`VERSION TEMPLATEHOST`** → flash/template host versions.
6. **`INFO`** (list) → parses lines for channel IDs and status lines; sets `channel_list` variable.
7. **`INFO PATHS`**, **`INFO SYSTEM`**, **`INFO CONFIG`** → stored in `gatheredInfo` and server info; CONFIG triggers consumer summary, DeckLink parse, template path, `config-compare` refresh.
8. **If `channelIds.length === 0`:** after INFO CONFIG, runs dynamic variables/presets, clears poll timers, tally feedbacks, **`setupAllRouting`**, **`reconcileAfterInfoGather`**, **`startPeriodicSync`** (no per-channel INFO).
9. **Else:** for each channel ID, **`INFO <n>`** → channel XML into `gatheredInfo.channelXml`, `state.updateFromInfo`, `updateChannelVariablesFromXml`; **on the last channel** same “finalize” step as above (variables, presets, routing, reconcile, periodic sync).

`runMediaLibraryQueryCycle()` is a subset: CLS → CINF* → TLS only (no VERSION/INFO/routing).

### `handleHttpRequest(request)`

- Normalizes path (strip query): `reqPath = (request.path || '/').split('?')[0]`.
- If path is `/api` or starts with `/api/` → **`routeRequest(method, reqPath, request.body, this)`** (`api-routes.js`).
- Else → **`serveWebApp(reqPath)`** — static files from `src/web/`, templates, SPA fallback to `index.html`.
- Returns `{ status, headers, body }` for Companion to serve (Companion routes instance HTTP to this handler; comment in `_startApiServer` states API is served at `/instance/<id>/api/...` when not using optional standalone port).

### Companion-specific vs HighAsCG-reusable

| Area | Companion-specific | Reusable / portable |
|------|-------------------|---------------------|
| Class / lifecycle | `InstanceBase`, `updateStatus`, `log`, `destroy` integration | Core object graph: `AmcpCommands`, `StateManager`, `TimelineEngine` |
| Config / UI | `getConfigFields`, actions/feedbacks/presets/variables modules | `buildConfigXml`, persistence keys, routing/reconcile/sync orchestration |
| HTTP | Request shape from Companion; path under instance | `routeRequest` + `serveWebApp` logic can move to standalone `http` server |
| TCP | `TCPHelper` in `tcp.js` | Same enqueue/query cycles with `net.Socket` + same AMCP parsing |
| State | `setVariableValues`, `checkFeedbacks` | `gatheredInfo`, `runConnectionQueryCycle`, `updateChannelVariablesFromXml` (xml2js) |

---

## T1.2 Analysis: `tcp.js`

**Source:** `companion-module-casparcg-server/src/tcp.js` (~193 lines)

### Role

- **`initTcp(self)`** — Tear down any existing socket and timers, optionally open a new TCP connection to `self.config.host` and `self.config.port` (default **5250**), wire **line-oriented AMCP framing** (`\r\n`), and drive **`self.response_callback`** / **`self._pendingResponseKey`** so `instance.requestData()` callbacks receive payloads.
- Imports **`clearPeriodicSyncTimer`** from `periodic-sync.js` so reconnect clears CLS/TLS sync timers.

### `@companion-module/base` usage

| API | Usage |
|-----|--------|
| **`TCPHelper(host, port)`** | Replaces raw `net.Socket`; instance stored as `self.socket`. Events used: `data`, `connect`, `error`, `status_change`. Methods: `destroy()`, `send()` (from `instance.js` / `amcp.js`). Code **re-emits** parsed lines as **`self.socket.emit('receiveline', line)`** after splitting buffers on `\r\n`. |
| **`InstanceStatus`** | `Connecting` before connect, `Disconnected` when destroying old socket; `status_change` forwarded to **`self.updateStatus(status, message)`** (Companion UI). |

Standalone HighAsCG should use **`require('net').createConnection`** (or `Socket`) with the same buffer split + `receiveline` pattern; replace **`updateStatus`** with an internal connection-state API or logging.

### AMCP state machine (`ACMP_STATE`)

States:

1. **`NEXT`** — Expecting a **status line**: `^(\d+)\s+(\S*)` (numeric code + optional status token, e.g. `202 OK`, `101 INFODATA CLS`).
2. **`SINGLE_LINE`** — After **101/201** (data line) or **400/500** (error detail line): next non-status line is the **single payload line** (then return to `NEXT`).
3. **`MULTI_LINE`** — After **200 OKMULTIDATA**: subsequent lines are body rows until a line that is **exactly empty** (`''` after trim… actually the code checks `line === ''`), then callback fires with **`multilinedata` array** and state returns to `NEXT`.

**Framing:** Raw `data` chunks are accumulated in `receivebuffer`; each complete `\r\n` line is emitted to the `receiveline` handler (CasparCG AMCP line protocol).

### Return codes (`RETCODE`) and transitions

| Code | Name | Behavior in parser |
|------|------|-------------------|
| 100 | INFO | Stay `NEXT`; clear `error_code`. |
| 101 | INFODATA | → `SINGLE_LINE`; `response_current` = status token (e.g. command name for callback key). |
| 200 | OKMULTIDATA | → `MULTI_LINE`; `response_current` = status; reset `multilinedata` to `[]`. |
| 201 | OKDATA | → `SINGLE_LINE`; `response_current` = status. |
| 202 | OK | Stay `NEXT`. |
| 400 | COMMAND_UNKNOWN_DATA | Error; → `SINGLE_LINE` for detail line. |
| 401–404, 501–503 | Various errors | `error` / `error_code` set; stay `NEXT` (or single-line path for 400/500 family as above). |
| 500 | INTERNAL_SERVER_ERROR_DATA | Error; → `SINGLE_LINE`. |
| 501 | INTERNAL_SERVER_ERROR | Error; stay `NEXT`. |

Unrecognized first line: log error and **return** (no state advance).

### Callback dispatch mechanism

- **`self.response_callback`** — Object: **uppercase key** → **array of callbacks** (FIFO). Keys match AMCP “response type” words (`CLS`, `INFO`, `DATA`, etc.). **`instance.requestData()`** pushes onto the array and sets **`self._pendingResponseKey`** to the key used for the *next* expected reply.
- **First line in `NEXT` when the next state is still `NEXT`** (e.g. `202 OK`, error codes that do not transition to `SINGLE_LINE` for payload):
  - Resolves **`cbKey`**: if **`status`** (second capture group) has a non-empty queue under `response_callback[status.toUpperCase()]`, use that; else **`self._pendingResponseKey`**.
  - **Shifts** one callback; if key matched `_pendingResponseKey`, clears it.
  - Invokes **`cb(error ? new Error(line) : null, line)`** — two-argument form for DATA STORE / error replies on single line.
- **`SINGLE_LINE` success path** — Uses **`response_current`** (uppercased) to **`shift`** from `response_callback[response_current]` and **`cb(line)`** (single payload string).
- **`SINGLE_LINE` error path** (after 400/500-style) — Uses **`_pendingResponseKey`**, passes **`new Error(errType + ': ' + line)`**, may call **`self.runCommandQueue()`** if defined.
- **`MULTI_LINE`** — On terminating **empty line**, **`cb(multilinedata)`** (array of lines).

### Batch bypass: `_amcpBatchDrain`

If **`self._amcpBatchDrain`** is set and **`onLine`** is a function, **every** `receiveline` is forwarded to **`_amcpBatchDrain.onLine(line)`** and the normal state machine **does not run**. Used by **`amcp-batch.js`** (BEGIN/COMMIT) so raw lines are consumed without stealing `response_callback` entries. On exception, drain is cleared.

### `initTcp` lifecycle

- Clears **`pollTimer`**, **`realtimePollTimer`**, **`clearPeriodicSyncTimer(self)`**.
- If **`self.socket`** exists: **`updateStatus(Disconnected)`**, **`destroy()`**, delete socket.
- If **`self.config.host`** is set: **`updateStatus(Connecting)`**, new **`TCPHelper`**, wire events.
- On **`connect`**: reset **`_amcpSendQueue`** to a resolved Promise if present; **`self.runConnectionQueryCycle()`**.

### Migration note (standalone)

- **Preserve** buffer splitting, `receiveline` dispatch, `ACMP_STATE` / `RETCODE` switch, and **`response_callback` / `_pendingResponseKey` / `_amcpBatchDrain`** behavior — this is the AMCP client core.
- **Replace** `TCPHelper` with **`net.Socket`**: `connect(port, host)`, `setEncoding` optional, `on('data')` feeding the same buffer loop, **`write()`** instead of **`send()`** (or wrap).
- **Replace** `InstanceStatus` + `updateStatus` with app-specific “connected / connecting / error” signaling.

---

## T1.3 Analysis: `amcp.js`

**Source:** `companion-module-casparcg-server/src/amcp.js` (~420 lines)  
**Related:** `amcp-batch.js` (batch transactions)

### Helpers (exported)

- **`param(str)`** — Escapes backslashes/quotes; wraps in double quotes if whitespace.
- **`chLayer(channel, layer)`** — `channel` or `channel-layer` string for AMCP targets.

### `AmcpCommands` constructor

- Holds **`this.self`** (module instance).
- Initializes **`self._amcpSendQueue = Promise.resolve()`** — **serialization lock** so concurrent API/HTTP calls do not interleave TCP sends (comment: would stall callbacks).

### `_send(cmd, responseKey?)` — Promise + queue

1. **`responseKey`** defaults to first word of `cmd` (uppercased); must match **`tcp.js`** dispatch keys (`CLS`, `INFO`, `PLAY`, `CG`, `DATA`, `THUMBNAIL`, etc.).
2. If **`!self.socket || !self.socket.isConnected`** → **`Promise.reject('Not connected')`**.
3. Builds inner **`Promise p`** that pushes onto **`self.response_callback[key]`** a unified callback: **`(a, b) =>`** if first arg is **`Error`** → reject; else **`data = b !== undefined ? b : a`** → **`resolve({ ok: true, data })`** so both **`(err, line)`** and **`(line)`** / **`(lines)`** shapes from **`tcp.js`** work.
4. **Queue chain:**  
   `self._amcpSendQueue = self._amcpSendQueue.then(() => { self._pendingResponseKey = key; self.socket.send(cmd.trim() + '\r\n'); return p }).catch(() => {})`  
   - Each send waits for the **previous** queued operation’s **`then`** to run before issuing the next **`socket.send`** (the returned **`p`** is chained so the queue advances when that command’s response is processed — actually: the `.then` returns **`p`**, so the next `_send` waits until **`p`** settles).  
   - Trailing **`.catch(() => {})`** swallows rejection on the queue rail so a failed command does not permanently break subsequent **`_amcpSendQueue`** links (individual **`p`** still rejects to caller).
5. Uses **`socket.send`** (not **`requestData`**) so **command casing** in parameters is preserved.

### `batchSend(commandLines, opts?)` → `amcp-batch.sendBatchTransaction`

- **`opts.force`** — If true, allows BEGIN/COMMIT when **`self.config.amcp_batch`** is off (e.g. scene take layer build).
- Implementation summary (see **T1.10** / **`amcp-batch.js`** for full detail):
  - Lines trimmed; each validated by **`validateBatchLine`** (whitelist: **`MIXER|PLAY|STOP|PAUSE|RESUME|LOADBG|LOAD|CLEAR|SWAP|ADD|REMOVE`**; excludes **`CALL`**, **`CG`**, queries, **`BEGIN`**, etc.; max **96** commands).
  - If **not** batching (**≤1 line** or batch disabled and not **`force`**): **`sequentialRaw`** — **`reduce`** over lines, each **`amcp._send(line, firstWord)`** chained (avoids async deadlock inside queue).
  - If batching: single payload **`BEGIN\r\n` + lines + `\r\nCOMMIT\r\n`**, set **`self._amcpBatchDrain`** to collect lines until a line matches **COMMIT** + **OK**; **20s** timeout; fallback to **`sequentialRaw`** on error.

### Method map (by AMCP area)

| Area | Methods |
|------|---------|
| **Basic** | `loadbg`, `load`, `play`, `pause`, `resume`, `stop`, `clear`, `call`, `swap`, `add`, `remove` |
| **Mixer** | `_mixer` (internal); `mixerKeyer`, `mixerBlend`, `mixerOpacity`, `mixerBrightness`, `mixerSaturation`, `mixerContrast`, `mixerLevels`, `mixerFill`, `mixerClip`, `mixerAnchor`, `mixerCrop`, `mixerRotation`, `mixerPerspective`, `mixerMipmap`, `mixerVolume`, `mixerMastervolume`, `mixerGrid`, `mixerCommit`, `mixerClear` |
| **CG** | `cgAdd`, `cgRemove`, `cgClear`, `cgPlay`, `cgStop`, `cgNext`, `cgGoto`, `cgUpdate`, `cgInvoke`, `cgInfo` |
| **Data** | `dataStore`, `dataRetrieve`, `dataList`, `dataRemove` |
| **Query** | `cinf`, `cls`, `tls`, `version`, `info`, `infoPaths`, `infoSystem`, `infoConfig`, `infoTemplate` |
| **Misc** | `diag`, `bye`, `channelGrid`, `restart`, `kill` |
| **Thumbnail** | `thumbnailList`, `thumbnailRetrieve`, `thumbnailGenerate`, `thumbnailGenerateAll` |
| **Escape hatch** | **`raw(cmd)`** — first word used as **`responseKey`**. |

**Note:** `mixerBrightness` sends Caspar’s typo **`BRIGTHNESS`** (documented in code).

### Dependencies

- **No** `@companion-module/base` import. Depends on instance shape: **`socket.isConnected`**, **`socket.send`**, **`response_callback`**, **`_pendingResponseKey`**, **`_amcpSendQueue`**, **`config`**, **`log`** (batch fallback only).

### Migration note

- **Fully portable** with **`tcp.js`** + socket abstraction unchanged. **`batchSend`** lives in **`amcp-batch.js`** — migrate together.

---

## T1.4 Analysis: `api-routes.js`

**Primary source:** `companion-module-casparcg-server/src/api-routes.js` (~1,107 lines)  
**Delegates to:** `timeline-routes.js`, `api-data.js`, `local-media.js` (plus dynamic `require` of `ui-selection`, `live-scene-state`, `scene-transition`)

### `routeRequest(method, path, body, self)`

1. Strips **`?query`** → **`parseQueryString`** for thumbnail width etc.
2. Normalizes Companion prefix: **`/instance/<id>/...`** → **`/api/...`**.
3. Requires path to start with **`/api/`** (else 404).
4. **Does not require `self.amcp`:**  
   - **`POST /api/selection`** — UI selection (`ui-selection.setUiSelection`).  
   - **`GET /api/scene/live`** — persisted live scene snapshots + `programLayerBankByChannel`.  
   - **`GET`** — **`handleThumbnail`** (may use local ffmpeg via `tryLocalThumbnailPng` without Caspar), **`handleLocalMedia`** (`/api/local-media/...`).
5. Then **`if (!self.amcp)` → 503** for remaining routes.
6. **`GET`:** **`handleStateGet`** (`/api/state`, `/api/variables`, `/api/media`, `/api/templates`, `/api/channels`, `/api/config`).
7. **`POST`:** **`handleAmcpBasic`** → **`handleMixerSafe`** → **`handleCg`** → **`handleProject`** → **`handleData`** → config/media/multiview → **`handleMisc`**.
8. **Timeline:** **`handleTimelineRoutes`** (all methods) — runs after POST block; catches **`GET /api/timelines/.../state`** etc.
9. Top-level **`try/catch`** → **502** JSON error.

**Exports:** `{ routeRequest, getState, handleMultiviewApply }` (re-exported for tests or external use).

### `getState(self)` — snapshot assembly

- **`getChannelMap(config)`** + **`config-generator`** helpers → **`channelMap`**: `screenCount`, `decklinkCount`, program/preview channel numbers per screen, `multiviewCh`, `inputsCh`, per-screen resolutions, audio layouts, decklink resolution merge logic (config vs `gatheredInfo.decklinkFromConfig`).
- Base payload: **`self.state.getState()`** if available, else fallback from **`variables`**, **`gatheredInfo`**, **`CHOICES_*`**.
- Enriches **`media`** with **`parseCinfMedia`**, **`mediaDetails`**, **`_mediaProbeCache`**.
- Returns merged object: **`...base`**, **`channelMap`**, **`scene.live`** + **`programLayerBankByChannel`**, **`playback.matrix`** (`playback-tracker`), **`localMediaEnabled`**, **`configComparison`**.

### `handleMultiviewApply(body, self)` — summary

- Validates **`layout`** array; **`getChannelMap`** must have multiview enabled.
- **`amcp.info(multiviewCh)`** preflight with user-facing 503/400 errors.
- **`routeForCell`**: maps cells to **`route://`** sources (PGM/PRV per screen, DeckLink inputs, legacy `route://N-11` normalization).
- **`doApply`:** clear layers 1…N (+ overlay layer 50 if overlay); for each cell **`PLAY`** route source + **`MIXER FILL`**; **`MIXER COMMIT`**.
- Optional **`showOverlay`:** deploy/copy **`multiview_overlay.html`**, **`loadOverlayTemplate`** (CG ADD path or **`PLAY [html]`** + **`CALL`**), JSON keyed for PGM/PRV/decklink slots; else clear CG/stop overlay layer.
- **`Promise.race`** with **25s** timeout → **504**; on success persists **`persistence.set('multiviewLayout', ...)`**.

### `handleSceneTake(body, self)` — summary

- Validates **`channel`**, **`incomingScene`** with **`layers`** and content (`layerHasContent`).
- **`currentScene`:** from body or **`live-scene-state.getChannel`** unless **`useServerLive === false`**.
- **`isTimelineOnlyScene`** → **`runTimelineOnlyTake`**; else **`runSceneTake(self.amcp, { …, self })`** from **`scene-transition.js`**.
- Updates **`live-scene-state`**, **`broadcastSceneLive`**.
- **Per-channel Promise chain** **`_sceneTakeChainByChannel`** serializes takes; **120s** race timeout → **504** / **500**.
- Response: **`sceneLive`**, **`playbackMatrix`**.

### HTTP endpoint map (by dispatcher)

| Method | Path pattern | Handler / notes |
|--------|----------------|-------------------|
| POST | `/api/selection` | UI selection sync |
| GET | `/api/scene/live` | Live scene + bank state |
| GET | `/api/thumbnail(s)/:file` | Thumbnail PNG (local or Caspar base64); query **`w`** |
| GET | `/api/thumbnails` | `THUMBNAIL LIST` |
| GET | `/api/local-media/:file/:type` | `waveform` \| `probe` (`local-media.js`) |
| GET | `/api/state` | Full **`getState()`** (+ async ffprobe kickoff for media) |
| GET | `/api/variables` | Flat `self.variables` |
| GET | `/api/media` | Media list + probe merge |
| GET | `/api/templates` | Template choices |
| GET | `/api/channels` | IDs, status lines, channel XML |
| GET | `/api/config` | Raw INFO CONFIG XML |
| POST | `/api/amcp/batch` | `amcp.batchSend(commands[])` |
| POST | `/api/play`, `/loadbg`, `/load`, `/pause`, `/resume`, `/stop`, `/clear`, `/call`, `/swap`, `/add`, `/remove` | `handleAmcpBasic`; play/stop/clear update playback + live scene hints |
| POST | `/api/mixer/:cmd` | keyer, blend, opacity, brightness, saturation, contrast, levels, **fill** (stretch modes + `queryLayerContentRes` / `calcStretchFill`), clip, anchor, crop, rotation, volume, mastervolume, grid, commit, clear |
| POST | `/api/cg/:cmd` | add, remove, clear, play, stop, next, goto, update, invoke, info |
| POST | `/api/project/save`, `/api/project/load` | DATA STORE/RETRIEVE `casparcg_web_project` |
| POST | `/api/data/:cmd` | store, retrieve, list, remove |
| POST | `/api/config/apply` | `applyServerConfigAndRestart` if `apply: true` |
| POST | `/api/media/refresh` | `runMediaLibraryQueryCycle` or fallback |
| POST | `/api/multiview/apply` | **`handleMultiviewApply`** |
| POST | `/api/scene/take` | **`handleSceneTake`** |
| POST | `/api/restart`, `/api/kill` | AMCP |
| POST | `/api/raw` | `amcp.raw(cmd)` |
| * | `/api/timelines` … | **`timeline-routes`**: CRUD; **`POST …/play|take|pause|stop|seek|sendto|loop`**; **`GET …/state`** |

### Migration note

- Split into **domain routers** (e.g. `routes/amcp-basic.js`, `routes/mixer.js`, `routes/state.js`, `routes/scene.js`, `routes/multiview.js`) each **≤500 lines**; keep **`routeRequest`** as thin orchestrator.
- No `@companion-module/base` in **`api-routes.js`** itself — depends on **`self`** (instance) shape.

---

## T1.5 Analysis: `web-server.js`

**Source:** `companion-module-casparcg-server/src/web-server.js` (~179 lines)

### Role vs Companion

- When **`api_port`** is **0** (typical Companion deployment), **no** standalone server runs; **`instance.handleHttpRequest`** + **`serveWebApp`** serve HTTP. When **`api_port` > 0**, **`startWebServer(port, self)`** creates **`http.Server`** + **`ws.Server`** (`noServer: true`, manual upgrade).
- **`stopWebServer`** closes the HTTP server (used in **`instance.destroy`** / **`_startApiServer`** when resetting).

### HTTP server

- **`http.createServer`**: reads full body via **`for await (const chunk of req)`**; **`OPTIONS`** → **204** + CORS headers.
- **`/api` or `/api/...`** → **`routeRequest(method, reqPath, body, self)`** (same handler as Companion path).
- Else → **`serveWebApp(reqPath)`** — static **`src/web/`**, **`/templates/`** from **`src/templates/`**, SPA fallback to **`index.html`**, rejects **`..`**.
- Response merges **`CORS_HEADERS`** with handler headers; **`res.end(result.body ?? '')`** (string bodies; binary thumbnails go through Companion path in practice, or would need Buffer handling if extended).

### WebSocket upgrade

- **`server.on('upgrade')`**: only **`/api/ws`** or **`/ws`** — others **`socket.destroy()`**.
- **`WebSocket.Server({ noServer: true })`** — **`handleUpgrade`** on allowed paths.

### Client lifecycle + initial push

- **`clients`** — **`Set`** of connected **`ws`**.
- On **connection**: **`ws.send(JSON.stringify({ type: 'state', data: getState(self) }))`** — full snapshot immediately.

### Incoming WS messages (`message` handler)

| `msg.type` | Behavior |
|------------|----------|
| **`amcp`** | Requires **`msg.cmd`** → **`self.amcp.raw(msg.cmd)`** → reply **`{ type: 'amcp_result', data: r }`**. |
| **`multiview_sync`** | **`msg.data`** → **`self._multiviewLayout`** + **`persistence.set('multiviewLayout', …)`**. |
| **`selection_sync`** | **`msg.data`** → **`setUiSelection(self, msg.data)`** (`ui-selection.js`). |
| *(parse errors)* | **`{ type: 'error', data: message }`**. |

### `_wsBroadcast(event, data)`

- Assigned to **`self._wsBroadcast`** when the standalone server starts: **`JSON.stringify({ type: event, data })`** to every client with **`readyState === 1`** (OPEN).
- **`instance.js`** / **`_startApiServer`** wires **`state.on('change', …)`** and **`timelineEngine`** **`tick` / `playback`** to this when the WebSocket server exists — so live updates require **`api_port`** (or Companion would need a different push channel).

### Listen address

- **`server.listen(port, callback)`** — no explicit host; Node binds per default (all interfaces / dual-stack). HighAsCG may still want an **explicit `0.0.0.0`** (or configurable host) for predictable LAN behavior and documentation.

### Migration note

- Core pattern for HighAsCG standalone: **reuse** **`routeRequest`**, **`serveWebApp`**, **`getState`**, **`_wsBroadcast`**; add **TLS** optional, **host binding** option, and ensure **Buffer** responses for binary routes if served from this server.

---

## T1.6 Analysis: `state-manager.js`

**Source:** `companion-module-casparcg-server/src/state-manager.js` (~278 lines)

### Role

- **`StateManager`** extends **`EventEmitter`**. Holds **`this.self`** (module instance) and private **`this._state`**.
- **Dependencies:** Node **`events`**, **`xml2js`** (`parseString`), **`cinf-parse`** (`parseCinfMedia`).
- **No** `@companion-module/base` import.

### `_state` schema

| Key | Shape | Updated by |
|-----|--------|------------|
| **`channels`** | Array of `{ id, videoMode?, status, framerate?, layers[] }` — layers indexed by layer number with **`fgClip`**, **`fgState`**, **`bgClip`**, **`durationSec`**, **`timeSec`**, **`remainingSec`** | **`updateFromInfo`** |
| **`media`** | `{ id, label, type?, fileSize?, fps?, durationMs?, resolution?, cinf?, … }` from CLS + CINF | **`updateFromCLS`**, **`updateMediaDetails`** |
| **`templates`** | `{ id, label }[]` | **`updateFromTLS`** |
| **`serverInfo`** | `version`, `flashVersion`, `templateHostVersion`, `paths`, `system`, `config` (strings) | **`updateServerInfo`** |
| **`decklinkInputs`** | `[]` | *Declared only — not mutated in this file* |
| **`routes`** | `{}` | *Declared only — not mutated in this file* |

### Change tracking + delta

- **`_emit(path, value)`** — **`emit('change', path, value)`** (used by **`instance.js`** for WebSocket broadcast when wired); appends **`{ path, value, ts }`** to **`this._changes`** (cap **500**, FIFO trim).
- **`getDelta(since)`** — Filters **`_changes`** with **`ts > since`**; returns **`changedPaths`** (unique), **`updates`** (last value per path in filter order), **`lastTs`**.

### INFO XML (`updateFromInfo(channel, xml)`)

- **`parseString`** (xml2js) async callback; reads **`result.channel.framerate`**, **`result.channel.stage[0].layer[0].layer_N`** foreground/background producers and files (same layer math as **`instance.updateChannelVariablesFromXml`**), and alternate **`result.layer`** single-layer shape.
- Finds or creates channel entry; sets **`framerate`**, **`layers`**, **`status`** from **`self.gatheredInfo.channelStatusLines[channel]`**.
- **`_emit(`channels.${channel}`, ch)`**.

### CLS / TLS / CINF merge

- **`updateFromCLS(data)`** — Lines like **`"file" TYPE SIZE …`**; regex **`^"([^"]+)"`**; parses type, size, fps fraction **`N/M`**, duration, resolution; replaces **`this._state.media`**, **`_emit('media', media)`**.
- **`updateFromTLS(data)`** — Quoted or plain template paths; **`_emit('templates', templates)`**.
- **`updateMediaDetails(mediaDetails)`** — Merges **`parseCinfMedia(cinf)`** per media id; **`_emit('media', …)`**.

### `getState()`

- Deep-clone **`channels`**, **`media`**, **`templates`**; shallow copy **`serverInfo`**, **`decklinkInputs`**, **`routes`**; includes **`variables: { ...self.variables }`** for API consumers.

### Migration note

- **Fully reusable** in HighAsCG; only **`this.self`** ties it to the host instance (**`log`**, **`gatheredInfo`**, **`variables`**). **`decklinkInputs` / `routes`** are placeholders unless wired later.

---

## T1.7 Analysis: `routing.js`

**Source:** `companion-module-casparcg-server/src/routing.js` (~302 lines)

### Role

- Derives **program / preview / multiview / inputs / audio-only** channel numbers from module **config**, builds **`route://`** strings, and **applies** DeckLink inputs, optional preview “black” CG, and **persisted multiview** after connect.
- No `@companion-module/base` import; uses **`self.amcp`**, **`self.config`**, **`self.log`**, **`self._multiviewLayout`**.

### `getChannelMap(config)`

- **`screenCount`:** clamp **1–4** from **`config.screen_count`** (default 1).
- **Per screen `N`:** **program** = **`(N-1)*2+1`**, **preview** = **`(N-1)*2+2`** (exposed as **`programCh(n)`**, **`previewCh(n)`** plus **`programChannels` / `previewChannels` arrays).
- **After** the last preview channel: **`nextCh = screenCount * 2 + 1`**.
- **Multiview:** if **`multiview_enabled`** is not false → **`multiviewCh = nextCh++`**, else **`null`**.
- **Inputs channel:** if **`decklink_input_count` > 0** → **`inputsCh = nextCh++`**, **`decklinkCount`** clamped **0–8**; else **`inputsCh = null`**.
- **Audio-only channels:** **`extra_audio_channel_count`** (0–4) → consecutive **`nextCh`** values in **`audioOnlyChannels[]`**.
- Returns **`multiviewEnabled`**, **`inputsEnabled`**, **`screenCount`**, **`decklinkCount`**, functions + arrays as in file header JSDoc.

### Helpers (not called from `setupAllRouting` unless noted)

| Function | Purpose |
|----------|---------|
| **`getRouteString(ch, layer?)`** | **`route://ch`** or **`route://ch-layer`**. |
| **`routeToLayer(self, srcCh, srcLayer, dstCh, dstLayer)`** | **`PLAY` destination with route source. |
| **`setupInputsChannel(self)`** | **`PLAY inputsCh-layer DECKLINK device`** per input; skips duplicate device IDs; tolerates “already playing” on reconnect. |
| **`setupPreviewChannel(self, screenIdx)`** | Optional **`cgAdd` `black` template on layer 9** on PGM + PRV if **`preview_black_cg`**; does **not** wire PRV→PGM route here. |
| **`setupMultiview(self, layout?)`** | Default **2×2** grid (PGM, PRV, up to 2 inputs) or custom **`layout`**; **`PLAY` + `MIXER FILL` + `MIXER COMMIT`**. **Not** invoked from **`setupAllRouting`** (avoid noisy default on connect). |

### `setupAllRouting(self)` — connect-time orchestration

1. **Optional file deploy** when **`local_media_path`** set: copy **`multiview_overlay.html`** from **`src/templates/`** if missing; create minimal **`black.html`** if missing.
2. **`setupInputsChannel`** if inputs enabled.
3. **Loop** **`setupPreviewChannel(self, n)`** for **`n = 1..screenCount`** (errors logged per screen).
4. **Multiview:** does **not** call **`setupMultiview`** with defaults. Restores layout only if **`self._multiviewLayout`** has a non-empty **`layout`** array → **`handleMultiviewApply(mvPersist, self)`** from **`api-routes.js`** (same code path as HTTP Apply).

### Migration note

- **Fully reusable**; depends on **`amcp`** API and optional **`api-routes.handleMultiviewApply`** for restore (split that dependency in HighAsCG if routing is extracted first).

---

## T1.8 Analysis: `scene-transition.js`

**Source:** `companion-module-casparcg-server/src/scene-transition.js` (~518 lines)

### Role

- Computes **diff** between stored current look and **incoming** scene JSON, then drives **program channel** AMCP: **A/B layer banks** for crossfade, **BEGIN/COMMIT** batches, optional **timeline-only** path via **`TimelineEngine`**.
- **Imports:** **`routing.getChannelMap`**, **`amcp-batch.MAX_BATCH_COMMANDS`**, **`playback-tracker`**, **`scene-native-fill.getResolvedFillForSceneLayer`**, **`program-layer-bank.normalizeProgramLayerBank`**, **`persistence`** (bank persistence).

### A/B bank (`PGM_BANK_B_OFFSET = 100`)

- Logical scene layer **`N`** maps to Caspar **`N`** (bank **a**) or **`N + 100`** (bank **b**): **`physicalProgramLayer(sceneLayerNum, bank)`**.
- **`activeBank` / `inactiveBank`** per program channel from **`self.programLayerBankByChannel[ch]`** (normalized **`'a'`|`'b'`**); incoming look loads on **inactive** bank, then opacity crossfade vs **active**, then stops/clears old physical layers, then **`inactiveBank` becomes active** (swap) + **`persistProgramLayerBanks`**.

### `diffScenes(current, incoming)`

- Builds **`currentMap`** by **`layerNumber`**; walks **`incoming.layers`**.
- **`layerHasContent`** = layer has **`source.value`**.
- **`enter`** — incoming has content, current missing or empty.
- **`exit`** — incoming empty but current had content; or current layer **not** in incoming set with content.
- **`update`** — both have content but **`sourceEqual`** is false (type/value mismatch; treats **`media`** vs **`file`** as same).
- **`unchanged`** — both have content and **`sourceEqual`** (same source).
- *Note:* **`layerVisuallyEqual`** (fill/rotation/opacity/loop) is exported for potential optimization but **not** used inside **`runSceneTake`** in this file.

### `runSceneTake(amcp, opts)` — media-only looks

- Rejects mixing **timeline** and media in one look.
- **`resolveChannelFramerateForMixerTween`** — uses **`variables.channel_${ch}_framerate`** or client hint (mixer frames).
- Loads **incoming** layers (sorted) onto **inactive** bank: per layer **batch** (`STOP`, `CLEAR`, `PLAY`, `ANCHOR`, `FILL`, `ROTATION`, `OPACITY` start, `KEYER` if straight-alpha still) — **`batchSend(..., { force: true })`**, split if over **`MAX_BATCH_COMMANDS`**.
- **`mixerCommit`**; if not first take: **single crossfade batch** — all outgoing logical layers on **active** bank → opacity 0, all incoming on **inactive** → target opacity; **`mixerCommit`**; wait **fadeMs**; **stop/clear** outgoing physical layers; **swap bank** in **`programLayerBankByChannel`**.
- Returns **`diff` counts** (from **`diffScenes`**) — orchestration is **bank-based**, not per-diff branch.

### `runTimelineOnlyTake(self, opts)`

- **`isTimelineOnlyScene`** — all content layers are **`source.type === 'timeline'`** with same **timeline id** (checked at API).
- Stops timelines on **`diff.exit`** when playback matches; **`runExitLayers`** for non-timeline exits; handles **update** when media → timeline on same layer.
- **`eng.setSendTo({ preview, program, screenIdx })`**, **`setLoop`**, **`play(tlId, 0)`**, **`mixerCommit`**.

### Shared exit path

- **`fadeExitLayerOpacities`** → **`runExitLayersStopAndClear`** (timed stop/clear after fade duration) — used by **`runExitLayers`** / timeline-only.

### Migration note

- **Reusable**; **large file** — split candidates: **diff/helpers**, **runSceneTake** (bank + batch), **timeline take**, **exit fade** utilities. **No** Companion SDK.

---

## T1.9 Analysis: `timeline-engine.js`

**Source:** `companion-module-casparcg-server/src/timeline-engine.js` (~509 lines)

### Role

- **`TimelineEngine`** extends **`EventEmitter`**. Holds **`this.self`** (module instance), **`timelines`** (`Map` id → timeline doc), **`_pb`** playback state, **`setInterval`** ticker (**`TICK_MS = 40`** ~25 Hz eval), **`_prevKey`** (per **`ch-caspLayer`** active clip id), **`_lastKfValues`** (debounce repeated MIXER sends).
- **Dependencies:** Node **`events`** only; **`getChannelMap`** via dynamic **`require('./routing')`** in **`_channelsFor`**. Uses **`self.amcp`** for all AMCP.

### Data model (CRUD)

- **`create(opts)`** — optional id, default **3** layers with empty **`clips`**, **`duration`**, **`fps`**.
- **`get` / `getAll` / `update` / `delete`** — **`delete`** stops if that timeline is playing.
- Timeline doc: **`layers[]`** with **`clips[]`** (**`startTime`**, **`duration`**, **`source`**, **`keyframes`**, **`loop`**, **`loopAlways`**, **`inPoint`**, etc.).
- **`addKeyframeAtNow`**, **`adjustClipFillDelta`**, **`captureKeyframeAtNow`** — edit keyframes at playhead; may call **`_applyAt`** if playing.

### Playback state machine (`_pb`)

| Method | Behavior |
|--------|----------|
| **`play(id, fromMs?)`** | Clears/reuses ticker; sets **`_pb`** with **`_t0`/`_p0`** clock; **`playing: true`**; optional **`_resumeAll`** vs fresh **`_applyAt(..., true)`**; **`setInterval(_tick)`**. |
| **`pause(id)`** | Stops ticker; fixes **`position`** to **`_nowMs()`**; **`_pauseAll()`** (PAUSE per tracked layer). |
| **`stop(id)`** | Stops ticker; position 0; **`_stopAll(tl)`** (STOP all timeline layers on output channels). |
| **`seek(id, ms)`** | Clamps to **`tl.duration`**; updates **`_pb`** position; **`_applyAt(..., true)`**. |
| **`setLoop` / `setSendTo`** | Loop flag; **`sendTo`** `{ preview, program, screenIdx? }` — removing channels stops layers on those channels. |

**`_tick`:** If past **`tl.duration`**, **loop** → **`play(id,0)`** or **`stop`**. Else updates **`position`**, **`_applyAt(..., false)`**, **`emit('tick', …)`**.

**`_nowMs()`:** When playing, **`_p0 + (Date.now() - _t0)`**; else frozen **`position`**.

### `_applyAt(id, ms, force)` — AMCP per evaluation

- Resolves output **`channels`** from **`_channels()`** (**`sendTo`** + **`getChannelMap`**).
- Per timeline layer index **`li`**, Caspar layer **`10 + li`** (**`_caspLayer`**).
- **`_clipAt(layer, ms)`** finds active clip by **`startTime`/`duration`**.
- **If clip:** Compare **`_prevKey`** — on new clip: **`PLAY`** (route vs file; **`LOAD`** when paused non-loop; **`SEEK` frame** or **`CALL SEEK`** when same clip + force); **`loopAlways`** uses **`PLAY … LOOP`** on enter only. Then **`_applyKf`** for keyframes at **`localMs`**. Updates **`_prevKey`**.
- **If no clip** but had previous: **`STOP`** that layer.
- **`force`** clears cached keyframe values when clip changes.

### `_applyKf` + interpolation

- Groups keyframes by **`property`**; **`_lerp(sortedKfs, localMs)`** — linear segment interpolation; before first / after last returns endpoint values.
- **`_interpProp(clip, prop, localMs, def)`** — filter by property, then **`_lerp`** (used for UI capture).
- Sends **`mixerOpacity`**, **`mixerVolume`** when value changes beyond epsilon; batches **FILL** when any of **`fill_x`/`fill_y`/`scale_x`/`scale_y`** change (**raw `MIXER FILL`** with four numbers).

### Events

- **`change`** — timeline list changed (**`getAll()`**).
- **`playback`** — after play/pause/stop/seek/setSendTo (**`getPlayback()`** strips internal **`_t0`/`_p0`**).
- **`tick`** — each ticker step while playing.

### Migration note

- **Fully reusable** with **`self.amcp`** + **`self.config`**; split **`_applyAt` / `_applyKf`** vs playback CRUD if file size is a concern.

---

## T1.10 Analysis: Remaining server-side modules

Reference: one-line responsibility + migration class (**🟢** portable, **🟡** needs adapter, **🔴** Companion-only). *Already analyzed elsewhere:* **`amcp-batch.js`** (T1.3), **`timeline-routes.js`** / **`api-data.js`** (T1.4).

| Module | Responsibility | Class |
|--------|----------------|-------|
| **`config-fields.js`** | **`getConfigFields()`** — Bitfocus field definitions (screens, connection, DeckLink, multiview, `api_port`, AMCP batch, periodic sync, etc.); visibility expressions. | 🔴 |
| **`config-generator.js`** | **`STANDARD_VIDEO_MODES`**, **`buildConfigXml`**, **`getModeDimensions`**, audio layout helpers, consumer XML — full Caspar **`configuration`** from module config. | 🟢 |
| **`config-compare.js`** | **`refreshConfigComparison`**, parse INFO CONFIG vs **`buildModuleChannelExpectation`** — mismatch list for UI. | 🟢 |
| **`actions.js`** | **`compileActionDefinitions(self)`** — merges CG/mixer/data/selection + large inline PLAY/LOAD/STOP/etc.; uses **`Regex`** from base. | 🔴 |
| **`cg-actions.js`** | **`getCgActions(self)`** — Companion actions for CG ADD/PLAY/UPDATE/… | 🔴 |
| **`mixer-actions.js`** | **`getMixerActions(self)`** — Companion mixer actions. | 🔴 |
| **`data-actions.js`** | **`getDataActions(self)`** — DATA STORE/RETRIEVE/LIST/REMOVE. | 🔴 |
| **`selection-actions.js`** | **`getSelectionActions(self)`** — UI selection / nudge. | 🔴 |
| **`feedbacks.js`** | **`initFeedbacks`** — program/preview tally (`checkFeedbacks`). | 🔴 |
| **`presets.js`** | **`initPresets`**, **`updateDynamicPresets`** — dynamic presets from channel/media list. | 🔴 |
| **`variables.js`** | **`initVariables`**, **`updateDynamicVariables`**, **`summarizeConsumersFromConfig`**, **`parseInfoConfigForDecklinks`** — **`setVariableDefinitions`** + XML helpers. | 🔴 |
| **`polling.js`** | **`clearVariablePollTimers`** — clears poll + **`clearPeriodicSyncTimer`** (legacy name). | 🟡 |
| **`handlers.js`** | **`handleCLS`**, **`handleTLS`** — populate **`CHOICES_*`**; **`executeGOTO`** for GOTO responses. | 🟢 |
| **`persistence.js`** | **`get`/`set`/`remove`/`getAll`** — **`.module-state.json`** next to module (rename-on-write). | 🟢* |
| **`playback-tracker.js`** | **`recordPlay`/`recordStop`**, **`getMatrixForState`** — channel×layer clip + duration from CINF/probe; route clips skip duration. | 🟢 |
| **`live-scene-state.js`** | **`getChannel`/`setChannel`/`getAll`**, **`broadcastSceneLive`**, **`notifyProgramMutation…`** — persisted **`liveScenesByProgramChannel`**. | 🟢 |
| **`live-scene-reconcile.js`** | **`reconcileAfterInfoGather`**, **`reconcileLiveSceneFromGatheredXml`** — compare persisted **scene** to INFO XML (file/template paths); skips timeline-only. | 🟢 |
| **`periodic-sync.js`** | **`startPeriodicSync`**, **`runPeriodicSync`**, **`clearPeriodicSyncTimer`** — interval INFO on PGM/PRV, variables, reconcile, playback matrix (config **`periodic_sync_interval_sec`**). | 🟡 |
| **`local-media.js`** | **`handleLocalMedia`**, **`probeMedia`**, **`resolveSafe`**, **`tryLocalThumbnailPng`** — ffprobe + ffmpeg under **`local_media_path`**. | 🟢 |
| **`cinf-parse.js`** | **`parseCinfMedia`** — parse CINF text → duration/resolution/fps/type. | 🟢 |
| **`ui-selection.js`** | **`setUiSelection`**, variable defs, encoder nudge, **`queryLayerContentRes`** — dashboard selection sync (HTTP + WS); **mentions Companion** in header but logic is AMCP + persistence. | 🟡 |
| **`amcp-batch.js`** | **`sendBatchTransaction`**, **`validateBatchLine`** — BEGIN/COMMIT vs sequential (see T1.3). | 🟢 |
| **`scene-native-fill.js`** | **`getResolvedFillForSceneLayer`** — normalized MIXER FILL “contain” match to web **`fill-math`**. | 🟢 |
| **`program-layer-bank.js`** | **`normalizeProgramLayerBank`** — coerce **`'a'`/`'b'`**. | 🟢 |

\* **`persistence`** path is module-relative; HighAsCG should parameterize storage root.

### Phase 1 server-side summary

- **Companion-only cluster:** **config-fields**, **actions**, **cg-/mixer-/data-/selection-actions**, **feedbacks**, **presets**, **variables** (SDK surface).
- **Shared core for HighAsCG:** **config-generator**, **routing**, **state-manager**, **amcp**, **tcp** (socket swap), **api-routes**, **web-server**, **scene-transition**, **timeline-engine**, **handlers**, **playback-tracker**, **live-scene-state** / **live-scene-reconcile**, **local-media**, **cinf-parse**, **scene-native-fill**, **ui-selection** (adapter), **periodic-sync** (adapter), **persistence** (path).

---

## T2.1 Analysis: Web architecture (`index.html`, `app.js`, `styles.css`)

**Source root:** `companion-module-casparcg-server/src/web/`

### `index.html`

- Single-page shell: **`#app.app`** → **header** (title **“CasparCG”**, **`#ws-status`** with dot + text) → **`.layout`**.
- **Three-column layout:** **Sources** aside (`#panel-sources` / `#sources-panel-body`), **draggable** **`#resize-sources`**, **main workspace** (tabs: **Scenes / Looks**, **Timeline Editor**, **Multiview Editor** → **`#tab-scenes`**, **`#tab-timeline`**, **`#tab-multiview`**), **Inspector** aside (`#panel-inspector-body`).
- **`styles.css`** + **`app.js`** as **`type="module"`** (ESM imports from `./components/`, `./lib/`).

### `app.js` — bootstrap

- **Exports** **`stateStore`** (`StateStore`) for cross-panel use.
- **`initTabs()`** — toggles **`.tab` / `.tab-pane`**, dispatches **`scenes-tab-activated`**, **`mv-tab-activated`**, **`timeline-tab-activated`** for lazy layout work.
- **`initPanelResize()`** — sets CSS variable **`--sources-panel-w`** (220–520px) on drag.
- **Panel init order:** **`initHeaderBar`**, **`initAudioMixerPanel`**, **`initSourcesPanel`**, **`initScenesEditor`**, **`initTimelineEditor`**, **`initMultiviewEditor`**, **`initInspectorPanel`**.
- **State:** **`api.get('/api/state')`** first (works with **Companion-only HTTP** when **`api_port=0`**); hydrates **`stateStore`**, **`sceneState`** resolutions + live scenes.
- **WebSocket** (`WsClient`): optional; on **`state`** / **`change`** / **`timeline.*`** updates **`stateStore`**; **disconnect** falls back to “HTTP only” if initial GET succeeded.
- **`casparcg-playback-matrix`** window event merges playback matrix; **`project-loaded`** refetches **`/api/state`** for **`scene.live`**.

### `styles.css` (~2.4k+ lines, ~44 KB)

- **Design system (`:root`):** GitHub-inspired **dark** palette — **`--bg-dark`**, **`--bg-panel`**, **`--bg-elevated`**, **`--border`**, **`--text`**, **`--text-muted`**, **`--accent`**, **`--accent-hover`**, **`--success`**, **`--warn`**, **`--error`**, **`--radius`**, **`--header-h`**, **`--panel-w`**; **Sources** width uses **`--sources-panel-w`** (default ~300px in rule).
- **Typography:** system stack **Segoe UI / -apple-system / BlinkMacSystemFont**.
- **Layout:** full-viewport flex column; **BEM-like** classes (`header__*`, `panel__*`, `workspace__*`); large file adds component-specific rules (dashboard, scenes, timeline canvas, multiview, inspector, server config strip, etc.).

### Migration note

- Entire **`web/`** tree is **portable** with HighAsCG HTTP + WS; only **API base URL** / Companion path prefix behavior differs (already abstracted in **`api-client.js`** — see T2.3).

---

## T2.2 Analysis: Web components (`src/web/components/`)

| File | Responsibility |
|------|------------------|
| **`header-bar.js`** | **`initHeaderBar`** — injects project name input, **Save/Load** (server **`/api/project/*`** + local JSON file), **`configComparison`** strip from **`stateStore`**, title tweak. |
| **`sources-panel.js`** | **`initSourcesPanel`** — tabbed **Media / Templates / Live / Timelines**; search; draggable **`source-item`** payloads; optional **route** sources; refreshes from **`/api/state`** / lists; detailed media table (ext, res, duration). |
| **`dashboard.js`** | **`initDashboard`** — Millumin-style **columns × layers** grid, screen tabs, **activate column** → AMCP to PGM, cell preview on PRV layer 19, **`initPreviewPanel`** stack; uses **`dashboardState`**. **Not imported by `app.js` in this repo** (no **Dashboard** tab in `index.html`) — legacy / optional embed. |
| **`scenes-editor.js`** | **`initScenesEditor`** — looks deck, compose view per scene, **Take** via **`POST /api/scene/take`**, PRV preview stack (**`drawSceneComposeStack`**), transition controls, layer drag from sources, program bank awareness for audio mixer. |
| **`timeline-editor.js`** | **`initTimelineEditor`** — transport (play/pause/stop/seek/take), **`timeline-canvas`**, **`initPreviewPanel`** (**`drawTimelineStack`**), WS **`timeline.tick`** sync, keyboard I/O fades, send-to screen, follow playhead. |
| **`timeline-canvas.js`** | **`initTimelineCanvas`** — **Canvas 2D** ruler, tracks, clips, keyframes, zoom/pan, drag move/resize, thumbnails/waveforms, seek callbacks. Exports **`fmtSmpte`**, **`parseTcInput`**. |
| **`multiview-editor.js`** | **`initMultiviewEditor`** — canvas layout editor, drag/resize cells, **`POST /api/multiview/apply`**, default layout from **`channelMap`**, cell colors by type (pgm/prv/decklink). |
| **`inspector-panel.js`** | **`initInspectorPanel`** — context UI for **dashboard cell**, **dashboard layer**, **scene layer**, **timeline clip**, **multiview cell**, **audio**; drag numeric inputs, **math-input**, **`api`** for mixer/scene, **`selection-sync`**. |
| **`preview-canvas.js`** | **`initPreviewPanel`**, **`drawDashboardProgramStack`**, **`drawSceneComposeStack`**, **`drawTimelineStack`** — canvas **program stack** preview, thumbnails (**`getThumbnailEntry`**), **`lerpKeyframeProperty`** (matches server). |
| **`audio-mixer-panel.js`** | **`initAudioMixerPanel`** — floating **Audio** drawer: **`MIXER MASTERVOLUME`** per bus, layer→extra-channel **PLAY route://** routing, meters (visual), **`PGM_BANK_OFFSET`** matching server. |

### Integration notes

- **Mounted from `app.js`:** header, audio mixer, sources, **scenes**, **timeline**, **multiview**, inspector — **not** **`dashboard.js`** (see above).
- **Shared libs:** components depend heavily on **`lib/*-state.js`**, **`api-client`**, **`mixer-fill`**, **`fill-math`** (T2.3).

### Migration note

- All are **static ES modules** — copy with **`web/`** assets; re-bind **`dashboard.js`** if a **Dashboard** tab is productized.

---

## T2.3 Analysis: Web libraries (`src/web/lib/`)

| File | Responsibility |
|------|------------------|
| **`api-client.js`** | **`getApiBase()`** — strips **`/instance/<id>`** from **`location.pathname`** so **`fetch`** hits **`/api/...`** under Companion; **`apiGet`/`apiPost`/`apiPut`**, JSON/text; dispatches **`casparcg-playback-matrix`** when responses include **`playbackMatrix`**. |
| **`ws-client.js`** | **`WsClient`** — connects to **`/api/ws`** or **`/ws`** (derived from page origin), reconnect loop, **`on`/`emit`**, **`sendAmcp`** (request/response correlation), parses JSON messages. |
| **`state-store.js`** | **`StateStore`** — nested **`setState`**, **`applyChange(path, value)`** (dot paths), **`on`** for path or **`*`**, **`getState()`**. |
| **`dashboard-state.js`** | **`DashboardState`** singleton — columns×layers grid, **`dashboardCasparLayer`** (base **10**), transitions, stretch modes, **`localStorage`** persistence, export/import hooks; constants **`TRANSITION_*`**, **`STRETCH_MODES`**. |
| **`scene-state.js`** | **`SceneState`** — looks/scenes CRUD, active screen, **`compose`** preview mapping, **`applyServerLiveChannels`**, sync with server live; **`defaultTransition`**, **`previewChannelLayerForSceneLayer`**. |
| **`timeline-state.js`** | **`TimelineStateManager`** — timelines CRUD, active id, **`localStorage`** (`casparcg_timelines_v1`), server sync helpers; exports **`defaultClip`/`defaultLayer`/`defaultTimeline`**. |
| **`multiview-state.js`** | **`MultiviewState`** — cells layout, canvas size, **`buildDefault`**, persistence, **Apply** payload shape. |
| **`project-state.js`** | **`ProjectState`** — project name in **`localStorage`**, **`exportProject`/`importProject`** aggregating scene/timeline/multiview/dashboard blobs; **`SERVER_STORE_NAME`**. |
| **`selection-sync.js`** | **`buildSelectionPayload`**, **`scheduleSelectionSync`** — debounced **`POST /api/selection`** for Companion variables/encoders; context: dashboard layer/cell, scene layer, multiview, timeline clip. |
| **`mixer-fill.js`** | **`calcMixerFill`**, **`getContentResolution`**, **`resolveNativeFillForPreview`** — UI MIXER FILL math vs channel/content resolution (same ideas as server **`scene-native-fill`**). |
| **`fill-math.js`** | **`nativeFill`**, **`fullFill`**, **`fillToPixelRect`**, **`pixelRectToFill`** — normalized ↔ pixel rect for canvas. |
| **`math-input.js`** | **`evaluateMath`** (safe-ish expr), **`createMathInput`** — inspector numeric fields with expressions. |
| **`media-ext.js`** | **`isStillImageFilename`**, **`isVideoLikeFilename`**, **`sourceSupportsLoopPlayback`**, **`shouldApplyStraightAlphaKeyer`**, **`classifyMediaKind`** — align with server keyer rules. |
| **`audio-mixer-state.js`** | In-memory **mastervolume** + **layer→route** maps (`Map`), getters/setters for **audio-mixer-panel**. |
| **`scene-live-match.js`** | **`sceneMatchesLiveProgram`** — compare scene JSON to persisted live snapshot for UI badges. |
| **`playback-clock.js`** | **`cellElapsedMs`**, **`cellRemainingMs`** — dashboard cell timing from **`playback.matrix`**. |
| **`program-layer-bank.js`** | **`normalizeProgramLayerBank`** — same **`'a'`/`'b'`** rule as server (**duplicate** of server **`program-layer-bank.js`** in browser). |

### Migration note

- **All browser-only** — no Node **`require`** of Companion SDK. **`getApiBase`** is the main **adapter** when switching from Companion-served URL to bare HighAsCG origin. **`selection-sync`** targets **`/api/selection`** (still valid in standalone).

---

## Phase 3: Migration classification (T3.1–T3.3)

### T3.1 — File-by-file classification (🟢 / 🟡 / 🔴 / 🔵)

**Legend:** 🟢 copy as-is or minimal edits · 🟡 replace Companion hooks (`TCPHelper`, `setVariableDefinitions`, …) · 🔴 stay in Companion module only · 🔵 greenfield in HighAsCG repo

#### Server — `src/*.js` (36 files)

| File | |
|------|---|
| `amcp.js` | 🟢 |
| `amcp-batch.js` | 🟢 |
| `api-data.js` | 🟢 |
| `api-routes.js` | 🟢 |
| `cinf-parse.js` | 🟢 |
| `config-compare.js` | 🟢 |
| `config-fields.js` | 🔴 |
| `config-generator.js` | 🟢 |
| `config-upgrade.js` | 🔴 |
| `handlers.js` | 🟢 |
| `instance.js` | 🔴 *(replaced by new HighAsCG entry + thin Companion `instance`)* |
| `live-scene-reconcile.js` | 🟢 |
| `live-scene-state.js` | 🟢 |
| `local-media.js` | 🟢 |
| `persistence.js` | 🟡 *(parameterize path)* |
| `playback-tracker.js` | 🟢 |
| `polling.js` | 🟡 *(timer helpers; no SDK in file)* |
| `program-layer-bank.js` | 🟢 |
| `periodic-sync.js` | 🟡 *(uses `variables` + instance shape)* |
| `routing.js` | 🟢 |
| `scene-native-fill.js` | 🟢 |
| `scene-transition.js` | 🟢 |
| `state-manager.js` | 🟢 |
| `tcp.js` | 🟡 *(swap `TCPHelper` / `InstanceStatus`)* |
| `timeline-engine.js` | 🟢 |
| `timeline-routes.js` | 🟢 |
| `ui-selection.js` | 🟡 *(optional `setVariableValues` bridge)* |
| `web-server.js` | 🟡 *(explicit `listen` host/port)* |
| `actions.js` | 🔴 |
| `cg-actions.js` | 🔴 |
| `data-actions.js` | 🔴 |
| `feedbacks.js` | 🔴 |
| `mixer-actions.js` | 🔴 |
| `presets.js` | 🔴 |
| `selection-actions.js` | 🔴 |
| `variables.js` | 🔴 |

#### Web — `src/web/**` (27 `.js` + static)

| Area | |
|------|---|
| `app.js`, `components/*.js`, `lib/*.js` | 🟢 |
| `index.html`, `styles.css` | 🟢 |

#### 🔵 New code (not in current tree)

| Item | Purpose |
|------|---------|
| HighAsCG **`main` / `index.js`** | `http` + `ws` server, `net` AMCP, lifecycle, env (`PORT`, `HOST`, Caspar host) |
| Optional **CLI** | Config path, log level |
| **`companion-module-highpass-highascg`** | Thin `InstanceBase`, HTTP bridge to HighAsCG, AMCP passthrough, variables from **`GET /api/state`** |

**Splitting files >500 lines:** see **`00_PROJECT_GOAL.md`** (file table); same split targets apply to **`api-routes.js`**, **`inspector-panel.js`**, **`scenes-editor.js`**, etc.

---

### T3.2 — Inter-module dependency overview (require graph)

- **Hub:** **`instance.js`** requires: **`amcp`**, **`actions`**, **`config-fields`**, **`config-generator`**, **`variables`**, **`presets`**, **`feedbacks`**, **`polling`**, **`tcp`**, **`handlers`**, **`api-routes`**, **`web-server`**, **`state-manager`**, **`routing`**, **`timeline-engine`**, **`persistence`**, **`live-scene-reconcile`**, **`periodic-sync`**, **`program-layer-bank`**; dynamic **`config-compare`**.
- **`api-routes.js`** (largest consumer): **`config-generator`**, **`routing`**, **`timeline-routes`**, **`api-data`**, **`persistence`**, **`local-media`**, **`cinf-parse`**, **`live-scene-state`**, **`playback-tracker`**, **`scene-transition`**, **`ui-selection`** (lazy).
- **`routing.js`** → dynamic **`api-routes.handleMultiviewApply`** (restore path) — **circular** with **`api-routes`**, only for that function (acceptable if extracted to `multiview-apply.js` in migration).
- **`scene-transition.js`** → **`routing`**, **`amcp-batch`**, **`playback-tracker`**, **`scene-native-fill`**, **`program-layer-bank`**, **`persistence`**.
- **`amcp.js`** → **`amcp-batch`** (`batchSend`).
- **`tcp.js`** → **`@companion-module/base`**, **`periodic-sync`** (clear timer).
- **`periodic-sync.js`** → **`routing`**, **`variables`**, **`live-scene-reconcile`**, **`playback-tracker`**.
- **`timeline-engine.js`** → dynamic **`routing.getChannelMap`**.
- **`playback-tracker.js`** → **`cinf-parse`**, **`live-scene-reconcile`** (parse helpers).
- **Companion-only cluster:** **`actions`** → **`cg-actions`**, **`mixer-actions`**, **`data-actions`**, **`selection-actions`**; **`selection-actions`** → **`ui-selection`**; **`variables`** → **`ui-selection`**.
- **External npm (server):** **`@companion-module/base`** (Companion only), **`xml2js`**, **`ws`**, Node **`fs`/`http`/`net`/`child_process`**.

**Web:** ESM **import** graph is tree-shaped from **`app.js`** → components → **`lib/*`**; no cycles.

---

### T3.3 — Shared between HighAsCG client and new Companion module

| Shared concern | Suggested approach |
|----------------|--------------------|
| **AMCP wire protocol + queue semantics** | Extract **`amcp.js`** + **`tcp` framing** (or shared npm package used by both processes) |
| **`program-layer-bank`**, **routing channel math** | Same small modules in both repos or one **`@highascg/shared`** package |
| **Caspar XML / modes** | **`config-generator`** usable from HighAsCG; Companion module may only **push** XML via AMCP |
| **State for variables/feedbacks** | New module reads **`GET {highascg}/api/state`** (or subset WebSocket) — **not** duplicating full **`state-manager`** in Companion |
| **REST contract** | Document OpenAPI-style list from **`api-routes`** (already analyzed in T1.4) |

---

### Companion SDK usage → standalone replacement

| API | Role | Replacement in HighAsCG |
|-----|------|-------------------------|
| **`InstanceBase`** | Module lifecycle | Plain `EventEmitter` or app class + `http.Server` |
| **`TCPHelper`** | Caspar socket | `net.Socket` |
| **`InstanceStatus`**, **`updateStatus`** | UI status | Log / optional HTTP `/health` |
| **`Regex`** | Action field validation | Same regex in JSON schema or manual |
| **`combineRgb`** | Feedback colors | CSS hex in web or drop |
| **`setActionDefinitions`**, **`setVariableDefinitions`**, **`setPresetDefinitions`**, **`setFeedbackDefinitions`** | Companion UI | N/A (not in Node app) |
| **`checkFeedbacks`**, **`setVariableValues`** | Tally / text | HighAsCG internal state API; Companion polls HighAsCG |
| **`handleHttpRequest` / `getConfigFields`** | Config + HTTP | Express-style routes + env/YAML config in HighAsCG |

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **Phase 3**: **T3.1** classification table (36 server + web + 🔵 new code), **T3.2** dependency overview + circular note, **T3.3** shared-library strategy, **Companion SDK → replacement** list; marked **T3.1–T3.3** complete.
- Deliverables **2–3** satisfied; **4** referenced to **`00_PROJECT_GOAL.md`**; **5** as SDK table in Phase 3.

**Status:**
- **Work Order 01** task list: **T1.1–T3.3** complete. Optional: verify deliverable checklist against project needs.

**Instructions for Next Agent:**
- Proceed to **Work Order 02** (`02_WO_MIGRATE_TO_HIGHASCG.md`) or run final doc pass / dependency graph tooling if desired.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T2.3**: table for all 17 **`web/lib`** modules (HTTP/WS client, state singletons, math/sync helpers), migration note.
- Marked task **T2.3** complete; added **T2.3 Analysis: Web libraries** section.

**Status:**
- **Phase 2 (T2.1–T2.3)** complete. **T3.1**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T3.1** (🟢🟡🔴🔵 file classification); **T3.2** dependency graph; **T3.3** shared libs for new Companion module.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T2.2**: per-component summary table (10 files), integration note (**`dashboard.js`** not mounted in current **`app.js`**), migration pointer.
- Marked task **T2.2** complete; added **T2.2 Analysis: Web components** section.

**Status:**
- **T1.1–T1.10**, **T2.1–T2.2** complete. **T2.3**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T2.3** (17 **`web/lib/*.js`** files).

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T2.1**: documented **`index.html`** shell, **`app.js`** init order / HTTP vs WS / events, **`styles.css`** token set and scope.
- Marked task **T2.1** complete; added **T2.1 Analysis: Web architecture** section.

**Status:**
- **T1.1–T1.10**, **T2.1** complete. **T2.2**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T2.2** (web components: 10 `*.js` files in **`components/`**).

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.10** sweep: table for all listed server modules (purpose + 🟢/🟡/🔴), Phase 1 cluster summary, cross-refs to T1.3/T1.4 for **`amcp-batch`**, **`timeline-routes`**, **`api-data`**.
- Marked task **T1.10** complete.

**Status:**
- **Phase 1 (T1.1–T1.10)** complete. **T2.1**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T2.1** (web architecture: **`index.html`**, **`app.js`**, **`styles.css`** overview).

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.9** analysis of `timeline-engine.js`: CRUD, **`_pb`** + **`_tick`**, **`play`/`pause`/`stop`/`seek`**, **`_applyAt`** (PLAY/LOAD/CALL SEEK/STOP per channel layer), **`_applyKf`**, **`_lerp`** / **`_interpProp`**, **`_channelsFor`**, events (**`change`**, **`playback`**, **`tick`**).
- Marked task **T1.9** complete; added **T1.9 Analysis: timeline-engine.js** section.

**Status:**
- **T1.1–T1.9** complete. **T1.10**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.10** (remaining server-side modules — batch list in WO).

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.8** analysis of `scene-transition.js`: **`PGM_BANK_B_OFFSET`**, **`physicalProgramLayer`**, **`diffScenes`**, **`runSceneTake`** (inactive bank load, batch PLAY/MIXER, crossfade batch, bank swap), **`runTimelineOnlyTake`**, exit helpers, migration split note.
- Marked task **T1.8** complete; added **T1.8 Analysis: scene-transition.js** section.

**Status:**
- **T1.1–T1.8** complete. **T1.9**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.9** (`timeline-engine.js`): CRUD, playback, **`_applyAt`**, interpolation.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.7** analysis of `routing.js`: **`getChannelMap`** numbering, **`setupAllRouting`** (deploy, inputs, preview black CG, persisted multiview via **`handleMultiviewApply`**), helper functions and what is **not** auto-run (**`setupMultiview`** default grid).
- Marked task **T1.7** complete; added **T1.7 Analysis: routing.js** section.

**Status:**
- **T1.1–T1.7** complete. **T1.8**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.8** (`scene-transition.js`): A/B bank offset, **`diffScenes`**, **`runSceneTake`**, **`runTimelineOnlyTake`**.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.6** analysis of `state-manager.js`: **`_state`** schema, **`_emit`/`getDelta`**, CLS/TLS/CINF/INFO flows, **`getState`**, note that **`decklinkInputs`**/**`routes`** are unused in this module.
- Marked task **T1.6** complete; added **T1.6 Analysis: state-manager.js** section.

**Status:**
- **T1.1–T1.6** complete. **T1.7**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.7** (`routing.js`): **`getChannelMap()`**, **`setupAllRouting()`**.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.5** analysis of `web-server.js`: optional **`api_port`** server, HTTP + CORS + **`routeRequest`/`serveWebApp`**, WS upgrade paths, message types (**`amcp`**, **`multiview_sync`**, **`selection_sync`**), **`_wsBroadcast`**, listen binding note, migration hints.
- Marked task **T1.5** complete; added **T1.5 Analysis: web-server.js** section.

**Status:**
- **T1.1–T1.5** complete. **T1.6**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.6** (`state-manager.js`): state schema, change/delta events, INFO XML parsing.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.4** analysis of `api-routes.js` (+ `timeline-routes.js`, `api-data.js`, `local-media.js`): **`routeRequest`** dispatch order, full endpoint table, **`getState()`**, **`handleMultiviewApply()`**, **`handleSceneTake()`**, migration split strategy.
- Marked task **T1.4** complete; added **T1.4 Analysis: api-routes.js** section.

**Status:**
- **T1.1–T1.4** complete. **T1.5**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.5** (`web-server.js`): HTTP + WebSocket setup, WS message types, **`_wsBroadcast`**.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.3** analysis of `companion-module-casparcg-server/src/amcp.js` and `amcp-batch.js`: `_send()` / `_amcpSendQueue` serialization, callback unification, full method map by category, **`batchSend`** (`validateBatchLine`, BEGIN/COMMIT vs **`sequentialRaw`**), and migration note (no Companion import in `amcp.js`).
- Marked task **T1.3** complete; added **T1.3 Analysis: amcp.js** section.

**Status:**
- **T1.1–T1.3** complete. **T1.4**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.4** (`api-routes.js`): map HTTP routes, **`getState()`**, **`handleMultiviewApply()`**, **`handleSceneTake()`**, split migration note.

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.2** analysis of `companion-module-casparcg-server/src/tcp.js`: AMCP states (`NEXT` / `SINGLE_LINE` / `MULTI_LINE`), `RETCODE` table, `response_callback` + `_pendingResponseKey` dispatch, `_amcpBatchDrain`, `TCPHelper` / `InstanceStatus` usage, and standalone migration notes.
- Added section **T1.2 Analysis: tcp.js**; marked task **T1.2** complete in the checklist.

**Status:**
- **T1.1–T1.2** complete. **T1.3**–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.3** (`amcp.js`): document `_send()` Promise chain, map AMCP methods, and **`batchSend()`** (BEGIN/COMMIT).

### 2026-04-04 — Agent (Cursor)
**Work Done:**
- Completed **T1.1** analysis of `companion-module-casparcg-server/src/instance.js`: constructor, init/config flow, `runConnectionQueryCycle` / `runMediaLibraryQueryCycle`, `handleHttpRequest`, and Companion vs reusable classification.
- Added section **T1.1 Analysis: instance.js** to this document with findings.

**Status:**
- **T1.1** checked complete. T1.2–T3.3 remain.

**Instructions for Next Agent:**
- Proceed with **T1.2** (`tcp.js`): AMCP state machine, return codes, callback dispatch, and document `TCPHelper` / `InstanceStatus` dependencies for raw `net.Socket` migration.

### YYYY-MM-DD — Agent Name
**Work Done:**
- (describe what was completed)

**Status:**
- (which tasks were completed)

**Instructions for Next Agent:**
- (what needs to happen next, any blockers or decisions needed)

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
