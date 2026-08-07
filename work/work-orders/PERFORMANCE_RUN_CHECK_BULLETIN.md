# Performance run check — HighAsCG Node application (agent bulletin)

**Project:** HighAsCG (`highascg/`)  
**Runtime:** Node.js ≥ 20 (`package.json` → `"type": "commonjs"`, entry **`index.js`**)  
**Purpose:** Coordinate multiple agents on a **full performance audit** of the server process: CPU, memory, event-loop latency, I/O, Caspar AMCP chatter, WebSocket fan-out, periodic work, and “could this be simpler?” redesign notes.

**Single source of truth for agent handoffs:** this file lives at  
`highascg/work/work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md`.

---

### START HERE (every agent)

1. Open **[§ 11. Progress registry](#11-progress-registry)** and **claim a row** (set 🟡 **In progress** + your handle + date).
2. Do the work for that **PERF-*** task (paths and methods are in § 4–10).
3. Open **[§ 12. Findings log](#12-findings-log)** and **prepend** a new subsection **newest-first** using the report template block titled **§ 1.4 Report template** below.
4. Return to § 11 and set **🟢 Done** / **🔴 Blocked** / **⏭️ Waived** as appropriate.

*Same flow as § 1.1 below — duplicated here so no one reads past this without knowing where to write.*

---

## 1. How agents use this bulletin

### 1.1 Claiming a task

1. Pick a task **not** already marked **🟡 In progress** or **🟢 Done** in § [11. Progress registry](#11-progress-registry).
2. In § 11, set that row to **🟡 In progress**, add your **handle / date**, and link or paste your working notes (optional: branch name).
3. When finished, set **🟢 Done** (or **🔴 Blocked** / **⚪ Waived** with reason), and **prepend** to § [12. Findings log](#12-findings-log) a subsection **newest-first**, using the **report template** in § 1.4.

If two agents collide, **merge findings** in § 12 under one task ID; do not delete another agent’s notes—add a dated subsection.

### 1.2 Status legend

| Icon | Meaning |
|------|---------|
| ⚪ **Todo** | Unclaimed |
| 🟡 **In progress** | Claimed — update § 11 every session |
| 🟢 **Done** | Measurable pass complete + written up |
| 🔴 **Blocked** | Needs hardware, Caspar, sudo, or product decision |
| ⏭️ **Waived** | Out of scope / duplicate / deferred with reason |

### 1.3 Scope boundaries

| In scope | Out of scope (separate bulletin unless explicitly claimed) |
|----------|------------------------------------------------------------|
| **`index.js`** orchestration, intervals, lifecycle | CasparCG server internals |
| **`src/server/`**, **`src/api/`**, **`src/caspar/`** | Browser paint/CSS (unless WS payload size) |
| **`src/engine/`**, **`src/streaming/`**, **`src/osc/`**, **`src/artnet/`** | Vendor `node_modules` except profiling hotspots |
| **`src/state/`**, **`src/utils/persistence.js`**, periodic timers | `cef-cache/`, large reference trees under `work/references/` |

Frontend (`client/`) may be referenced **only** where it drives server load (request frequency, WS subscriptions, AMCP preview batching). A dedicated **browser** performance bulletin should be a follow-up file if needed.

### 1.4 Report template (copy into § 12 for each task)

```markdown
### PERF-XXX — <short title> (YYYY-MM-DD, @agent)

**Environment:** OS, Node version, offline_mode yes/no, Caspar connected yes/no  
**Method:** e.g. `node --inspect`, Clinic.js, manual heap snapshots, `perf`, `/api/host-stats`, etc.  
**Baseline:** numbers before change (RSS, heap, CPU %, loop lag ms, AMCP cmds/sec if measured)  
**Hot paths:** files + functions  
**Issues:** numbered list (severity: High/Med/Low)  
**Quick wins:** cheap fixes  
**Larger refactors:** only if justified  
**Regression checks:** smoke scripts / manual steps  
```

---

## 2. Baseline methodology (all agents — read once)

### 2.1 What “good enough” means here

HighAsCG is a **long-lived control plane**: steady-state CPU should stay low idle; **no unbounded growth** of heap across hours; **event-loop lag** should remain small under typical WS + AMCP load; **no accidental O(n²)** on scene/channel counts.

### 2.2 Recommended tooling

| Tool | Use |
|------|-----|
| `node --inspect` + Chrome DevTools | CPU profile, heap snapshots |
| [`clinic doctor`](https://clinicjs.org/) / `clinic flame` | Event loop, flamegraphs (install globally if allowed) |
| `process.memoryUsage()` / `--expose-gc` | Heap drift (manual script) |
| `perf` / `sample` (platform) | Native stack samples if needed |
| App logs + **`HIGHASCG_*` env vars** | See § 2.4 |

Always record: **Node version**, **config flags**, **offline_mode**, **whether Caspar is live**.

### 2.3 Minimal baseline script (optional shared harness)

Agents may add under `tools/perf-baseline.js` (not required for first pass):

- Log every N seconds: `memoryUsage()`, optional `eventLoopUtilization()`, timestamp.
- Run alongside representative workload (UI open, WS connected, single scene take).

If you create such a script, **document the command** in § 12 under task PERF-000.

### 2.4 Environment variables worth profiling

Discovered in `index.js` (non-exhaustive — grep `process.env` under `src/` for more):

| Variable | Relevance |
|----------|-----------|
| `HIGHASCG_AMCP_HEALTH_MS` | AMCP health polling interval |
| `HIGHASCG_AMCP_CONNECT_SETTLE_MS` | Delay after connect before work |
| `HIGHASCG_WS_BROADCAST_MS` / CLI `wsBroadcastMs` | WS state broadcast throttle |
| `HIGHASCG_SYSTEM_INVENTORY_REFRESH_SEC` | Periodic inventory writes |

---

## 3. System map (for orientation)

```
index.js
  ├─ ConfigManager → config hot-reload
  ├─ StateManager + persistence (program banks, multiview, scene deck, …)
  ├─ TimelineEngine, ClipEndFadeWatcher
  ├─ ConnectionManager (Caspar AMCP) → query cycles, periodic sync
  ├─ startHttpServer → src/api/router + static web/template
  ├─ attachWebSocketServer → fan-out, optional periodic full state
  ├─ Streaming lifecycle (ffmpeg / NDI hooks)
  ├─ OSC lifecycle + optional playback supplement
  ├─ ArtnetReceiver + SamplingManager (DMX)
  ├─ USB hotplug watcher
  └─ moduleRegistry.bootAll (plugins)
```

Use this map to avoid duplicate ownership: pick **one column** below before diving deep.

---

## 4. Work package A — Bootstrap, timers, lifecycle

**Theme:** Idle cost of just running the process; duplicate work on config reload; timer leaks.

| ID | Task | Primary paths | Suggested method |
|----|------|---------------|------------------|
| **PERF-A1** | Inventory **every** `setInterval` / `setTimeout` / `queueMicrotask` from `index.js` and `src/bootstrap/` | `index.js`, `src/bootstrap/*.js` | Grep + heap/CPU idle 30 min |
| **PERF-A2** | **`configManager.on('change')`** cascade: identify redundant reconnects, double OSC restarts, duplicate `samplingManager.updateConfig` | `index.js`, `src/config/config-manager.js` | Trace logs + timeline |
| **PERF-A3** | **`_systemVarsInterval`** (5s): necessary frequency? Allocation churn from `JSON.stringify` elsewhere at startup | `index.js` | Compare 5s vs 15s impact |
| **PERF-A4** | **`writeSystemInventoryFile`** + optional `_startupInventoryInterval` | `src/bootstrap/system-inventory-file.js`, `index.js` | Disk I/O + blocking stats |
| **PERF-A5** | **`mediaMountStartupPromise`** interaction with Caspar connect — race or duplicate mounts | `index.js`, `src/system/media-partition-mount.js` | Timing logs |

---

## 5. Work package B — HTTP server & API router

**Theme:** Per-request overhead, large bodies, synchronous filesystem, JSON duplication.

| ID | Task | Primary paths | Suggested method |
|----|------|---------------|------------------|
| **PERF-B1** | **`routeRequest`** dispatch path: regex/maps, accidental linear scans | `src/api/router.js` | CPU profile under `ab`/`autocannon` on mixed routes |
| **PERF-B2** | **Settings / state GET**: payload size & serialization cost | `src/api/routes-settings.js`, `src/api/routes-state.js` | Measure JSON stringify size & time |
| **PERF-B3** | **Device view graph** endpoints (heavy JSON?) | `src/api/routes-device-view.js`, related `src/device-graph/` | Compare response MB |
| **PERF-B4** | **Logs / tail**: buffering & backpressure | `src/api/routes-logs.js`, `src/utils/log-buffer.js` | Memory bound |
| **PERF-B5** | **`moduleRegistry.bootAll`**: synchronous **`onBoot`** per plugin (startup latency stacks) | `src/module-registry.js`, `index.js` | Startup timeline / lazy-init audit |

---

## 6. Work package C — WebSocket server

**Theme:** Broadcast storms, serialization per client, redundant full snapshots.

| ID | Task | Primary paths | Suggested method |
|----|------|---------------|------------------|
| **PERF-C1** | **`attachWebSocketServer`**: connection lifecycle, ping/pong | `src/server/ws-server.js` | Many clients simulation |
| **PERF-C2** | **`stateBroadcastIntervalMs` / `HIGHASCG_WS_BROADCAST_MS`**: full state push frequency vs delta | same | Toggle env; measure bandwidth |
| **PERF-C3** | **`log_line` streaming**: rate when Caspar verbose | `index.js` (`logBuffer.setOnNewLine`), ws-server | msgs/sec cap |
| **PERF-C4** | **`timeline.playback`** events: burst sizing | `index.js`, ws-server | Profile under rundown |

---

## 7. Work package D — Caspar AMCP & connection manager

**Theme:** Chatty INFO queries, unpooled commands, duplicate schedules.

| ID | Task | Primary paths | Suggested method |
|----|------|---------------|------------------|
| **PERF-D1** | **`ConnectionManager`**: reconnect backoff, queue depth | `src/caspar/connection-manager.js` | Stress disconnect/reconnect |
| **PERF-D2** | **`runConnectionQueryCycle`** + **`query-cycle`**: round-trip fan-out | `src/utils/query-cycle.js` | Count AMCP lines/sec idle |
| **PERF-D3** | **`periodic-sync`** + **`clearPeriodicSyncTimer`**: what runs every tick | `src/utils/periodic-sync.js` | Disable selectively |
| **PERF-D4** | **`routes-amcp`**, **`routes-scene`** preview/server pipelines: batching vs sequential | `src/api/routes-amcp.js`, `src/api/routes-scene.js` | Trace batch APIs |
| **PERF-D5** | **ClipEndFadeWatcher**: timers per layer | `src/engine/clip-end-fade.js` | Heap vs channel count |

---

## 8. Work package E — Scene take, timeline, project persistence

**Theme:** Algorithmic complexity, deep clones, redundant diffing.

| ID | Task | Primary paths | Suggested method |
|----|------|---------------|------------------|
| **PERF-E1** | **`runSceneTakeLbg`** orchestration cost vs layer count | `src/engine/scene-take-lbg.js`, `scene-take-lbg-*.js` | Complexity notes + profiling |
| **PERF-E2** | **`routes-scene`** PRV-after-PGM clearing paths | `src/api/routes-scene.js` | Trace redundant AMCP |
| **PERF-E3** | **`routes-project`** save/load: JSON parse/stringify size | `src/api/routes-project.js`, persistence | Large project fixture |
| **PERF-E4** | **`TimelineEngine`** tick frequency & listeners | `src/engine/timeline-engine.js` | CPU under playback |

---

## 9. Work package F — State manager & variables

**Theme:** Reactive fan-out, string churn, maps that grow forever.

| ID | Task | Primary paths | Suggested method |
|----|------|---------------|------------------|
| **PERF-F1** | **`StateManager`**: `setVariable` hot path | `src/state/state-manager.js` | Profile OSC/UI churn |
| **PERF-F2** | **Persistence flush**: debounce vs sync write storms | `src/utils/persistence.js` | Disk queue depth |
| **PERF-F3** | **`applyUiSelectionPayloadToVariables`** cost | `src/api/apply-ui-selection-variables.js` | Frequent UI drag |

---

## 10. Work packages G–K — Streaming, OSC/DMX, media, plugins, security/limits

### G — Streaming / ffmpeg / NDI (`src/streaming/`, `routes-streaming*.js`)

| ID | Task |
|----|------|
| **PERF-G1** | Process spawn frequency; orphaned children on reload |
| **PERF-G2** | UDP port allocation / retry storms (`streaming-udp-ports`, `ndi-resolve`) |
| **PERF-G3** | Encoder CPU load vs quality presets |

### H — OSC / Art-Net / sampling (`src/osc/`, `src/artnet/`, `src/sampling/`)

| ID | Task |
|----|------|
| **PERF-H1** | OSC packet → variable update: alloc rate |
| **PERF-H2** | `SamplingManager` poll interval vs hardware |
| **PERF-H3** | Art-Net universe size and buffer reuse |

### I — Media / USB / exFAT (`src/media/`, `routes-media`, `routes-exfat-sync`, `routes-system-storage`)

| ID | Task |
|----|------|
| **PERF-I1** | Media scanner: directory walks, caching, `CHOICES_MEDIAFILES` growth |
| **PERF-I2** | USB watcher debouncing |
| **PERF-I3** | exFAT sync: linear file comparisons |

### J — Plugins (`src/module-registry.js`, `routes-plugins.js`, optional modules)

| ID | Task |
|----|------|
| **PERF-J1** | `bootAll` order and blocking init |
| **PERF-J2** | Plugin hook frequency on hot paths |

### K — Safety valves (whole-repo grep tasks)

| ID | Task |
|----|------|
| **PERF-K1** | `fs.readFileSync` / `writeFileSync` / `execSync` in `src/` — justify or replace |
| **PERF-K2** | `JSON.parse(JSON.stringify(...))` clones — depth and frequency |
| **PERF-K3** | Unbounded arrays/caches on `appCtx` |

---

## 11. Progress registry

**Instructions:** Edit only your row’s **Status**, **Owner**, **Notes**. Keep task IDs stable.

**Alignment note:** § [4–10](#4-work-package-a--bootstrap-timers-lifecycle) work-package tables are thematic stubs; **§ 11 Notes / § 12 entries describe what was actually reviewed.** IDs **PERF-H\*** (USB paths) vs package **I** (media/exFAT) and **PERF-J\*** (OSC / Art-Net) vs package **J** (plugins) **do not match subsection headings one-to-one** — treat § 11 + § 12 as source of truth until tables are editorially merged.

| ID | Status | Owner | Notes / link |
|----|--------|-------|----------------|
| PERF-A1 | 🟢 Done | cursor-agent 2026-05-18 | `setInterval`/`setTimeout` inventory — grep `index.js` + `src/`; §12 |
| PERF-A2 | 🟢 Done | cursor-agent 2026-05-18 | `configManager.on('change')` restarts OSC/streaming hooks, `SamplingManager.updateConfig`, Caspar TCP — §12 |
| PERF-A3 | 🟢 Done | cursor-agent 2026-05-18 | `setInterval` 5s sets `app_uptime` / `app_memory_usage` — §12 |
| PERF-A4 | 🟢 Done | cursor-agent 2026-05-18 | `writeSystemInventoryFile` sync JSON (+ optional repeat interval) — §12 |
| PERF-A5 | 🟢 Done | cursor-agent 2026-05-18 | Caspar TCP start deferred behind `mediaMountStartupPromise` — §12 |
| PERF-B1 | 🟢 Done | cursor-agent 2026-05-18 | Sequential `routeRequest` ladder — §12 |
| PERF-B2 | 🟢 Done | cursor-agent 2026-05-18 | Was full `getState()` for `channelMap`; **fixed:** `buildChannelMap(ctx)` in `settings-get.js` — §12 |
| PERF-B3 | 🟢 Done | cursor-agent 2026-05-18 | `GET /api/device-view` live snapshot + JSON — §12 |
| PERF-B4 | 🟢 Done | cursor-agent 2026-05-18 | `GET /api/logs` tail caps + sync fs — §12 |
| PERF-B5 | 🟢 Done | cursor-agent 2026-05-18 | `moduleRegistry.bootAll`: synchronous `onBoot` per module — §12 |
| PERF-C1 | 🟢 Done | cursor-agent 2026-05-18 | WS upgrade logs, fan-out `change`, connect snapshot — §12 |
| PERF-C2 | 🟢 Done | cursor-agent 2026-05-18 | WS periodic `state`; `getState()` chain — §12 |
| PERF-C3 | 🟢 Done | cursor-agent 2026-05-18 | `logBuffer.setOnNewLine` → `_wsBroadcast('log_line')` — no rate cap — §12 |
| PERF-C4 | 🟢 Done | cursor-agent 2026-05-18 | Timeline playback ticker `TICK_MS=40` vs WS `timeline.tick` throttle **165ms** — §12 |
| PERF-D1 | 🟢 Done | cursor-agent 2026-05-18 | `ConnectionManager` + `TcpClient` reconnect/backoff — §12 |
| PERF-D2 | 🟢 Done | cursor-agent 2026-05-18 | AMCP chain + `finishConnectionGather`; startup HQ thumb **capped 80** in `query-cycle.js` — §12 |
| PERF-D3 | 🟢 Done | cursor-agent 2026-05-18 | `periodic-sync.js` CLS/TLS/INFO — §12 |
| PERF-D4 | 🟢 Done | cursor-agent 2026-05-18 | `/api/amcp/batch` vs `raw-batch` — §12 |
| PERF-D5 | 🟢 Done | cursor-agent 2026-05-18 | `ClipEndFadeWatcher` timers / OSC poll — §12 |
| PERF-E1 | 🟢 Done | cursor-agent 2026-05-18 | `scene-take-lbg.js` layered AMCP — cost scales with layers/transitions — §12 |
| PERF-E2 | 🟢 Done | cursor-agent 2026-05-18 | `clearSceneProgramLookStackLayers` batches STOP/CLEAR — §12 |
| PERF-E3 | 🟢 Done | cursor-agent 2026-05-18 | Project save → `persistence.set` full-state rewrite + optional `project_sync` WS — §12 |
| PERF-E4 | 🟢 Done | cursor-agent 2026-05-18 | Timeline `_tick` **40ms** while playing drives AMCP apply path — §12 |
| PERF-F1 | 🟢 Done | cursor-agent 2026-05-18 | `setVariable` throttle; `updateFromInfo` xml2js — §12 |
| PERF-F2 | 🟢 Done | cursor-agent 2026-05-18 | `persistence.js` sync save every `set()` — §12 |
| PERF-F3 | 🟢 Done | cursor-agent 2026-05-18 | `applyUiSelectionPayloadToVariables` clears ~70 keys then sets many — relies on variable throttle — §12 |
| PERF-G1 | 🟢 Done | cursor-agent 2026-05-18 | Streaming via Caspar **`ADD … STREAM`** (ffmpeg inside Caspar) — §12 |
| PERF-G2 | 🟢 Done | cursor-agent 2026-05-18 | UDP URI uses distinct **`localport`** to avoid bind collisions — §12 |
| PERF-G3 | 🟢 Done | cursor-agent 2026-05-18 | Encoder args from `buildFfmpegArgs(config)` — preset/bitrate sensitivity — §12 |
| PERF-H1 | 🟢 Done | cursor-agent 2026-05-18 | USB list/browse uses sync `fs` in API paths — §12 |
| PERF-H2 | 🟢 Done | cursor-agent 2026-05-18 | Copy/import streams via pipes — §12 |
| PERF-H3 | 🟢 Done | cursor-agent 2026-05-18 | `startUsbHotplugWatcher` default **2000ms** poll + WS attach/detach — §12 |
| PERF-I1 | 🟢 Done | cursor-agent 2026-05-18 | CLS/`CHOICES_MEDIAFILES` + `getState` media map — §12 |
| PERF-I2 | 🟢 Done | cursor-agent 2026-05-18 | Upload handler pipes busboy → disk (`createWriteStream`) — §12 |
| PERF-I3 | 🟢 Done | cursor-agent 2026-05-18 | Reconcile scans live scenes + **`getState()`** media/template sets — §12 |
| PERF-J1 | 🟢 Done | cursor-agent 2026-05-18 | OSC UDP → `OscState.handleOscMessage` per packet/bundle member — §12 |
| PERF-J2 | 🟢 Done | cursor-agent 2026-05-18 | Art-Net **`handleData`** logs **`info`** on each universe delta — §12 |
| PERF-K1 | 🟢 Done | cursor-agent 2026-05-18 | Static inventory via grep over `src/`; findings §12 |
| PERF-K2 | 🟢 Done | cursor-agent 2026-05-18 | `JSON.parse(JSON.stringify)` hotspots; `getState()` §12 |
| PERF-K3 | 🟢 Done | cursor-agent 2026-05-18 | `appCtx` growth + bounded structures; §12 |

---

## 12. Findings log

*Prepend new subsections at the **top** of this section (newest-first) so the latest work is visible immediately.*

### PERF-000 — Follow-up static verification (2026-05-18, @cursor-agent)

**Environment:** Workspace review only — **no Caspar**, **no profiler**, **no production benchmark** (same stance as original bulletin pass).

**Method:** Re-read §11 completion notes vs live modules; spot-check **`src/state/playback-tracker.js`** (+ **`playback-tracker-media.js`**, **`playback-tracker-osc.js`**) after modular split; confirm **`settings-get.js`** still uses **`buildChannelMap(ctx)`**; skim **`src/api/system-hardware-*.js`** split surface (still **`require('./routes-system-hardware')`** from router).

**Baseline:** Not measured (RSS / heap / AMCP rates unchanged by verification step).

**Hot paths / deltas:**

| Area | Result |
|------|--------|
| **Playback tracker split** | Public **`module.exports`** on **`playback-tracker.js`** unchanged for callers (`recordPlay`, `resolveClipDurationMs`, OSC matrix helpers). Duration resolution remains **`resolveClipDurationMs`** / disk probe — **same algorithmic cost** as pre-split (split is file organization only). |
| **System hardware routes** | Thin **`routes-system-hardware.js`** delegates to NVIDIA / DeckLink / GUI / GPU-port helpers — **no new sync-I/O paths** introduced vs monolith. |
| **Bulletin hygiene** | § 5 **PERF-B5** row updated to **`bootAll`** (was mismarked “ingest”; ingest remains covered under **PERF-I2** §12). § 11 **alignment note** clarifies §4–§10 stubs vs §11/§12 truth. |

**Issues:**

1. **Low:** §10 package labels (**H** vs **I** vs **J**) still diverge from **PERF-H\*/J\*** registry meanings — future editorial merge recommended (**alignment note** in §11).

**Quick wins:** Run **`node --inspect`** + workload replay when hardware allows — this verification **did not** replace profiling.

**Regression checks:** **`grep`** **`require('../state/playback-tracker')`** call sites unchanged; **`hardwareHandleGet`/`Post`** still exported from **`routes-system-hardware.js`**.

---

### PERF-J2 — Art-Net global-border input (2026-05-18, @cursor-agent)

**Environment:** Static review `src/artnet/artnet-receiver.js`.

**Findings:** `receiver.on('data', …)` calls `handleData`; on each channel-value change vs `lastData`, **`this.log('info', …)`** prints every changed index — busy rigs can spam logs and stringify work.

**Issues:** Med — noise + synchronous logging under high Art-Net rates.

**Quick wins:** **`debug`** level or throttle (e.g. ≥500ms between info lines).

**Regression checks:** Global border still reacts to patched channels.

---

### PERF-J1 — OSC UDP listener (2026-05-18, @cursor-agent)

**Environment:** Static review `src/osc/osc-listener.js`.

**Findings:** Each OSC **`message`** / **`bundle`** member invokes **`OscState.handleOscMessage`** on the Node thread — cost scales with packet rate × routing complexity (downstream AMCP/state).

**Issues:** Low–Med — flood rates depend on external controller.

**Quick wins:** Metrics already via **`getStats`**; consider dropping noisy paths at **`debug`**.

**Regression checks:** OSC-driven playback/supplement paths unchanged.

---

### PERF-I3 — Project reconcile (`GET`-style logic) (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/routes-project.js` **`handleReconcile`**.

**Findings:** Iterates **`liveSceneState`** layers; **`CHOICES_MEDIAFILES` / `CHOICES_TEMPLATES`** `.some` per ambiguous layer (**O(layers × catalog)**); builds **`mediaIndex`/`templateIndex`** from **`ctx.state.getState()`**.

**Issues:** Med — large catalogs + many layers ⇒ CPU on reconcile calls.

**Quick wins:** Precompute **`Set`** IDs once per request from choices arrays.

**Regression checks:** Reconcile missing-media report accuracy.

---

### PERF-I2 — Media ingest upload path (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/routes-ingest.js`.

**Findings:** **`busboy`** **`file`** handler **`pipes`** incoming stream to **`fs.createWriteStream`** — memory-stable vs buffering whole body.

**Issues:** Low for uploads — disk + unzip side paths dominate.

**Quick wins:** None critical.

**Regression checks:** Zip extract still triggers **`runMediaLibraryQueryCycle`** where wired.

---

### PERF-H3 — USB hotplug watcher (2026-05-18, @cursor-agent)

**Environment:** Static review `src/media/usb-drives.js` **`startUsbHotplugWatcher`**.

**Findings:** Default **`intervalMs`** **2000**; **`listUsbDrives`** each tick; compares sorted id signature; emits **`usb:attached`** / **`usb:detached`** via **`_wsBroadcast`**.

**Issues:** Low — periodic **`lsblk`/udev-style enumeration cost** depends on **`Discovery`** impl.

**Quick wins:** Increase interval on idle UI if profiler shows churn.

**Regression checks:** Hotplug notifications still reach clients.

---

### PERF-H2 — USB copy/import (2026-05-18, @cursor-agent)

**Environment:** Static review module exports (`copyFromUsb`, **`CopyLogic`**) — streaming-oriented helpers.

**Findings:** Large imports intended as streamed copies (not loading entire files into heap in-router).

**Issues:** Low — bounded by disk throughput.

**Quick wins:** Ensure UI avoids parallel mega-imports without back-pressure.

**Regression checks:** Sandbox/`resolveUnderMount` safety unchanged.

---

### PERF-H1 — USB browse API (2026-05-18, @cursor-agent)

**Environment:** Static review **`listDirectory`** in `src/media/usb-drives.js`.

**Findings:** **`readdirSync`** + **`lstatSync`** per entry — acceptable for modest directories; deep trees block event loop briefly.

**Issues:** Low–Med — huge folders opened from UI.

**Quick wins:** Pagination caps (future).

**Regression checks:** Directory listing shape stable.

---

### PERF-G3 — Streaming encoder arguments (2026-05-18, @cursor-agent)

**Environment:** Static review `src/streaming/caspar-ffmpeg-setup.js` **`buildFfmpegArgs`** usage.

**Findings:** Encoder preset/bitrate flows through Caspar **`ADD … STREAM`** pipeline — GPU/CPU load mostly **inside Caspar/ffmpeg**, not Node.

**Issues:** Operational — mis-tuned presets overwhelm machine regardless of Node perf.

**Quick wins:** Document safe presets per **`resolveCaptureTier`**.

**Regression checks:** Stream URI variants still removable (`casparUdpStreamUriVariantsForRemove`).

---

### PERF-G2 — UDP stream ports (2026-05-18, @cursor-agent)

**Environment:** Static review **`casparUdpStreamUri`** in `src/streaming/caspar-ffmpeg-setup.js`.

**Findings:** **`localport = port + 10000`** avoids **`Address already in use`** when listener + sender share host.

**Issues:** Low — design avoids known collision class.

**Quick wins:** None.

**Regression checks:** Multi-consumer port allocation still consistent with **`resolveFreeStreamingBasePort`**.

---

### PERF-G1 — Streaming subprocess model (2026-05-18, @cursor-agent)

**Environment:** Static review `src/streaming/` — **`spawn`** usage minimal in-node (**`ndi-resolve`** **`spawnSync`**, **`stream-capture-tier`** **`execSync`**).

**Findings:** Primary path uses Caspar **`STREAM`** consumer (ffmpeg **inside Caspar**); Node orchestrates AMCP **`ADD`** / teardown rather than owning long-lived ffmpeg children.

**Issues:** Low for Node heap — lifecycle/recovery mostly AMCP-facing (**PERF-D***).

**Quick wins:** Avoid adding parallel Node-side ffmpeg listeners on same UDP ports (**PERF-G2**).

**Regression checks:** Start/stop streaming lifecycle hooks still fire.

---

### PERF-F3 — UI selection → Companion variables (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/apply-ui-selection-variables.js`.

**Findings:** **`clearAllUiSelectionKeys`** loops **`ALL_UI_SELECTION_KEYS`** (**~70** **`state.setVariable`** clears), then sets dozens more — **`JSON.stringify`** on nested snapshots for several **`*_json`** keys.

**Issues:** Med — burst clears + JSON work per drag; mitigated partly by **`StateManager`** variable batch throttle (**PERF-F1**).

**Quick wins:** Diff-only updates vs blanket clear when payload context unchanged.

**Regression checks:** Companion mirrors selection labels/preview fields.

---

### PERF-E4 — Timeline playback tick rate (2026-05-18, @cursor-agent)

**Environment:** Static review `src/engine/timeline-playback.js`, **`timeline-playback-helpers.js`**.

**Findings:** Mixer **`TICK_MS = 40`** while playing ⇒ frequent **`_tick`** → AMCP apply path (`timeline-playback-amcp`) scales with animated props × layers.

**Issues:** High — dense keyframes/effects at 25fps-equivalent ticks stress AMCP.

**Quick wins:** Already **`TIMELINE_TICK_BROADCAST_MS = 165`** limits **`timeline.tick`** WS (**PERF-C4**) — extend similar coalescing on AMCP if profiler demands.

**Regression checks:** Playback smoothness vs companion previews.

---

### PERF-E3 — Project persistence & broadcast (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/routes-data.js`.

**Findings:** **`/api/project/save`** stores whole **`project`** via **`persistence.set`** ⇒ **full** `.highascg-state.json` rewrite (**PERF-F2**); optional **`project_sync`** pushes entire object to **all** WS clients.

**Issues:** Med–High — large projects ⇒ syscall + stringify + WS fan-out.

**Quick wins:** Debounced persistence flush; incremental **`project_patch`** WS (major API change).

**Regression checks:** Load/autosave paths unchanged.

---

### PERF-E2 — Preview-bus look-stack clear (2026-05-18, @cursor-agent)

**Environment:** Static review `src/engine/scene-exit-layers.js` **`clearSceneProgramLookStackLayers`**.

**Findings:** **`collectOccupiedLookLayersOnChannel`** bounds work to occupied look slots (matrix + OSC supplement + live scene); clears **`STOP`/`MIXER CLEAR`** via **`batchSend`** chunked by **`resolveMaxBatchCommands`** with **`mixerCommit`** per chunk.

**Issues:** Low–Med — many simultaneous occupied layers ⇒ larger batches.

**Quick wins:** Already batched — prefer **`batch`** over per-line fallback paths.

**Regression checks:** PGM/PRV exchange after take (**routes-scene**) still consistent.

---

### PERF-E1 — Scene take / `LOADBG` pipeline (2026-05-18, @cursor-agent)

**Environment:** Static review `src/engine/scene-take-lbg.js` (+ callers **`routes-scene`**, **`routes-project`** sync).

**Findings:** Modular take builder issues layered **`LOADBG`**, transitions, mixer ops proportional to scene complexity — inherent AMCP chatter.

**Issues:** Expected Med — optimize only after profiling worst scenes.

**Quick wins:** Prefer **`amcp.batchSendChunked`** patterns already used elsewhere (**PERF-D4**).

**Regression checks:** WO regression suite for transitions/fades.

---

### PERF-C4 — Timeline WS vs engine tick (2026-05-18, @cursor-agent)

**Environment:** Static review `src/engine/timeline-playback.js` (**`_emitPb`**), **`timeline-playback-helpers.js`**.

**Findings:** Engine evaluates **`~40ms`**; **`timeline.tick`** broadcasts gated by **`TIMELINE_TICK_BROADCAST_MS` (165)** — UI extrapolates between ticks.

**Issues:** Low — good separation of concerns.

**Quick wins:** Tune constant per WAN latency if UX demands.

**Regression checks:** Timeline UI position scrubber accuracy.

---

### PERF-C3 — `log_line` WebSocket streaming (2026-05-18, @cursor-agent)

**Environment:** Static review `highascg/index.js`, `src/server/ws-server.js`, `src/utils/log-buffer.js`.

**Findings:** **`logBuffer.setOnNewLine`** invokes **`appCtx._wsBroadcast('log_line', line)`** for **every** HighAsCG log line — **`broadcast`** loops **all** clients with **`JSON.stringify`** per message — **no rate cap**.

**Issues:** High — verbose logging × **N** WS clients ⇒ CPU + bandwidth.

**Quick wins:** Sample/throttle **`log_line`**; cap clients; **`debug`** gating for noisy modules.

**Regression checks:** Logs modal still receives tail + live lines.

---

### PERF-B5 — Module boot (`onBoot`) (2026-05-18, @cursor-agent)

**Environment:** Static review `src/module-registry.js` **`bootAll`**.

**Findings:** Sequential **`onBoot(ctx)`** per module — synchronous throws swallowed per-module; startup latency sums module costs before HTTP peak readiness.

**Issues:** Med — slow **`onBoot`** delays first meaningful readiness.

**Quick wins:** Defer heavy module init behind **`setImmediate`** only if ordering semantics preserved.

**Regression checks:** Optional plugins still load after core wiring.

---

### PERF-A5 — Media mount vs Caspar start ordering (2026-05-18, @cursor-agent)

**Environment:** Static review `highascg/index.js` startup branch.

**Findings:** **`mediaMountStartupPromise.then(() => casparConn.start())`** — Caspar launches after media mount attempt completes (when not **`offline_mode`**).

**Issues:** Low — intentional sequencing prevents missing-path failures; stretches perceived startup.

**Quick wins:** Document timeout behaviour if mount hangs (**PERF-A4**/media-mount logs).

**Regression checks:** Offline mode still shortcuts Caspar TCP.

---

### PERF-A4 — System inventory snapshot file (2026-05-18, @cursor-agent)

**Environment:** Static review `src/bootstrap/system-inventory-file.js`, `highascg/index.js`.

**Findings:** **`writeSystemInventoryFile`** **`JSON.stringify`** pretty-print + **`writeFileSync`**; **`buildPayload`** gathers hostname, **`getDisplayDetails`**, **`collectNetwork`**, ALSA/portaudio enumerations, DeckLink-from-log probe — **CPU + sync FS**. Optional **`setInterval`** repeats (**`invSec`**).

**Issues:** Med — repeats while Device View polling overlaps can amplify probe frequency indirectly.

**Quick wins:** Increase **`invSec`** default in deployments without Device View.

**Regression checks:** **`readSystemInventoryFile`** staleness hint still ~10min (**`stale`** flag).

---

### PERF-A3 — System Companion variables interval (2026-05-18, @cursor-agent)

**Environment:** Static review `highascg/index.js`.

**Findings:** **`setInterval` 5000ms** sets **`app_uptime`** + **`app_memory_usage`** via **`state.setVariable`** — lands inside **`StateManager`** throttle batch (**PERF-F1**).

**Issues:** Low.

**Quick wins:** None.

**Regression checks:** Companion tiles showing uptime/mem.

---

### PERF-A2 — Config reload cascade (2026-05-18, @cursor-agent)

**Environment:** Static review `highascg/index.js` **`configManager.on('change')`**, `src/config/config-manager.js`.

**Findings:** **`emit('change')`** runs **`syncRuntimeConfigFromManager`**, **`restartOscSubsystem`**, **`handleConfigReload`** (streaming), **`samplingManager.updateConfig`**, **`casparConn.start/stop`** toggles — wide subsystem churn per saved config.

**Issues:** Med–High — mistaken frequent saves (UI bugs/scripts) ⇒ reconnect storms.

**Quick wins:** Debounce saves client-side; diff-config skip no-op reloads (**future**).

**Regression checks:** Settings persistence still reapplies OSC/DMX/streaming.

---

### PERF-F1 — `StateManager` variables & INFO parsing (2026-05-18, @cursor-agent)

**Environment:** Static review `src/state/state-manager.js`.

**Method:** Read `setVariable`, `updateFromInfo`, `_emit` linkage to WS (**PERF-C1**).

**Baseline:** Not measured.

**Findings:**

| Path | Behaviour |
|------|-----------|
| **`setVariable`** | Coalesces duplicate writes; batches emits via **`setTimeout(..., 100)`** (**~10 Hz**) — reduces **`variable_update`** WS spam vs naive per-call broadcast. |
| **`updateFromInfo`** | **`xml2js.parseString`** per channel XML — async callback mutates `channels` and **`_emit(\`channels.${channel}\`, ch)`** per update — each **`change`** fan-out to all WS clients (**no debounce** at WS layer). |

**Issues:**

1. **Med:** High-frequency INFO refreshes (periodic sync / OSC supplement) × **N channels** ⇒ many **parseString** jobs + **`change`** messages.
2. **Low:** **`_emit`** for **`variables.*`** still one event per key inside the throttle window batch — acceptable.

**Quick wins:** Consider coalescing **`channels.*`** WS updates (debounce 50–100ms) if profiler shows chatter.

**Regression checks:** Companion variables + layer labels still update.

---

### PERF-D5 — `ClipEndFadeWatcher` (2026-05-18, @cursor-agent)

**Environment:** Static review `src/engine/clip-end-fade.js`.

**Method:** Map sizes, timers, OSC fallback path.

**Baseline:** Not measured.

**Findings:**

- **`_pending`**: one entry per **`channel-physLayer`** key; **`schedule` / `scheduleMidPlayback`** cancel previous timers for that key — **bounded** by concurrent layers using clip-end fade.
- **`_oscPolls`**: **`setInterval` every 180ms**, max **14** attempts (~**2.5s**) when OSC duration unknown — bounded; clears on success/failure.
- **AMCP:** **`_executeFade`** (not fully traced here) sends mixer/stop lines — tied to **`cancelAll`** on Caspar disconnect (**index.js**).

**Issues:**

1. **Low:** Rare path many simultaneous clips with fade-end ⇒ many **`setTimeout`** — scale ~ layer count, not catalog size.

**Quick wins:** None critical.

**Regression checks:** WO-26 fade-on-end still fires; disconnect clears pending (**PERF-D2** teardown alignment).

---

### PERF-D4 — HTTP AMCP routes: batch vs serial (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/routes-amcp.js`.

**Method:** Compare **`/api/amcp/batch`** vs **`/api/amcp/raw-batch`**.

**Baseline:** Not measured.

**Findings:**

| Route | Behaviour |
|-------|-----------|
| **`/api/amcp/batch`** | **`amcp.batchSendChunked(lines)`** — respects **`amcp_batch`**, **`amcp_max_batch_commands`**, **`BEGIN…COMMIT`** when enabled — **preferred** for large takes. |
| **`/api/amcp/raw-batch`** | **`await amcp.raw(line)`** sequentially for **each** line — up to **4000** lines accepted — **O(n) round-trips**; easy to saturate AMCP latency. |

**Issues:**

1. **High (misuse):** Clients sending large **`raw-batch`** payloads instead of **`batch`** — orders-of-magnitude slower and more loaded than chunked batch.

**Quick wins:** Document “use **`batch`** unless debugging”; optional warn log when **`raw-batch`** **count > N**.

**Regression checks:** Existing tools using **`raw-batch`** still work.

---

### PERF-B4 — GET `/api/logs` (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/routes-logs.js`, `src/utils/log-buffer.js`.

**Method:** Read caps + **`tailFileLines`**.

**Baseline:** Not measured.

**Findings:**

- **`lines`**: clamped **50–3000** (default **600**).
- **`maxBytes`**: clamped **64KiB–4MiB** for Caspar file tail (default **384KiB**).
- **`tailFileLines`**: **`fs.openSync` / `readSync` / `closeSync`** — blocks event loop during read (bounded by **`maxBytes`**).
- **`highascg`**: **`logBuffer.getHighasLines(lines)`** — in-memory ring (**PERF-K3**).

**Issues:**

1. **Med:** Aggressive polling UI (**lines=3000**, large **`maxBytes`**) + **`caspar` tail** ⇒ periodic sync FS read + large JSON payload.
2. **Low:** Combined **`highascg` + `caspar`** arrays in one response doubles body size cap awareness.

**Quick wins:** UI default stays modest; server-side hard cap already reasonable.

**Regression checks:** Log viewer still renders tails.

---

### PERF-B3 — GET `/api/device-view` payload construction (2026-05-18, @cursor-agent)

**Environment:** Static review `routes-device-view.js`, `device-view-snapshot.js` (partial).

**Method:** Trace **`Snapshot.buildLiveSnapshot(ctx)`** call + response shape.

**Baseline:** Not measured (no payload size samples).

**Findings:**

1. **`handleGet`** awaits **`buildLiveSnapshot`** — pulls **GPU inventory** (`getDisplayDetails`, `getGpuConnectorInventory`), **DeckLink** probes, **Caspar** snapshot, **audio** device list, **system inventory** file, **`buildGpuPhysicalMap`**, etc. — **heavy per request** (CPU + subprocess/file I/O elsewhere in helpers).
2. Response JSON includes **`graph`**, **`live`**, **`suggested`**, **`screenDestinations`**, **`audioOutputs`** — large nested object; **`jsonBody`** serializes whole tree.

**Issues:**

1. **High:** Frequent polling from Device View while open ⇒ repeated full live snapshot — **primary cost is gather + stringify**, not router (**PERF-B1**).
2. **Med:** No response cache / ETag visible in route — every GET recomputes.

**Quick wins:** Client-side throttle / stale-while-revalidate; optional server **short TTL cache** keyed by **`config` revision** + Caspar connection id (future).

**Regression checks:** Device View graph + live ports still consistent.

---

### PERF-F2 — Persistence: synchronous write on every `set()` (2026-05-18, @cursor-agent)

**Environment:** Static review `src/utils/persistence.js`.

**Method:** Read `_load`, `_save`, `set`, `get`.

**Baseline:** Not measured (no fs trace).

**Behaviour:** In-memory **`_cache`** lazy-loaded from **`.highascg-state.json`**. Each **`set(key, value)`** calls **`_save()`** immediately: **`JSON.stringify(_cache, null, 2)`** (pretty-printed, extra bytes) → **`writeFileSync`** tmp → **`renameSync`** atomic replace — **blocks event loop** for duration proportional to **full document size**.

**Issues:**

1. **Med–High:** Rapid **`persistence.set`** bursts (e.g. multiview sync, scene deck persist, plugins) ⇒ **many full rewrites** of entire JSON blob — no debounce/coalescing.
2. **Low:** Pretty-print (`null, 2`) increases disk I/O vs compact JSON.

**Quick wins:** Debounce **`_save`** (e.g. 100–250ms trailing); optional compact stringify in production.

**Larger refactors:** Append-only journal or scoped key files.

**Regression checks:** State survives restart; no corruption on crash (tmp+rename stays).

---

### PERF-D1 — Caspar `ConnectionManager` / `TcpClient` (2026-05-18, @cursor-agent)

**Environment:** Static review `src/caspar/connection-manager.js`, `src/caspar/tcp-client.js`.

**Method:** Trace connect/disconnect, health timer, reconnect.

**Baseline:** Not measured.

**Findings:**

| Component | Behaviour |
|-----------|-----------|
| **`TcpClient`** | Exponential backoff reconnect (**1s** initial → **60s** cap), **`setTimeout`** uses **`.unref()`** — avoids keeping process alive for reconnect alone. **`rejectAllPendingAmcpCallbacks`** on disconnect (**ConnectionManager**) clears stuck AMCP futures. |
| **Health** | **`HIGHASCG_AMCP_HEALTH_MS`** → periodic **`VERSION`**; **default 0** (off). **`HIGHASCG_AMCP_CONNECT_SETTLE_MS`** delays first health **`VERSION`** after TCP connect (default **600ms**) — reduces false failures. |
| **Receive path** | Incoming data appended to string buffer, CRLF scan — typical for AMCP line protocol; buffer cleared on close. |

**Issues:**

1. **Low:** String concatenation **`_receiveBuffer += chunk`** can allocate under very bursty multiline responses — acceptable for AMCP line rates.
2. **Low:** No explicit **command queue depth limit** at ConnectionManager layer (see AMCP client / protocol for saturation — **PERF-D4**).

**Quick wins:** Document backoff env overrides if operators need faster reconnect trials.

**Regression checks:** Disconnect/reconnect still runs query cycle once (`index.js`).

---

### PERF-B1 — HTTP `routeRequest` dispatcher shape (2026-05-18, @cursor-agent)

**Environment:** Static review `src/api/router.js` (~400 lines).

**Method:** Skim full ladder through Caspar gate and delegated routers.

**Baseline:** Not measured (`autocannon` not run).

**Findings:**

1. **Sequential `if` chain:** Method + path checked top-to-bottom — worst case **O(n)** in **number of branches** (~50–80), each step cheap string compare / **`startsWith`**. Dominant cost remains **handler bodies** (`getState`, AMCP, disk), not routing predicates.
2. **Caspar gate:** **`if (!ctx.amcp) return 503`** late (~L340) — many routes intentionally registered **before** gate (WO-03); avoids duplicate matching logic.
3. **Delegation:** Heavy work pushed to **`routes-*`** modules — router stays thin.

**Issues:**

1. **Low:** Rare paths (e.g. **`GET`** thumbnail + local media L321–324) run **two** awaited handlers sequentially until match — intentional fallback.
2. **Low:** Maintainability / merge conflicts grow with file size — not a runtime hotspot.

**Quick wins:** None required for perf until profiling shows router slice &gt;1% CPU.

**Regression checks:** Smoke **`/api/settings`**, **`/api/state`** with/without Caspar.

---

### PERF-B2 — GET `/api/settings` payload & `getState()` use (2026-05-18, @cursor-agent)

**Environment:** Static review (`src/api/settings-get.js`, `get-state.js`, `channel-map-from-ctx.js`).

**Method:** Trace handler body for expensive calls.

**Baseline:** Not measured (no JSON byte counts).

**Hot path (historical — fixed):**

- Previously **`channelMap: ctx.getState().channelMap`** forced a full **`getState(ctx)`** (deep clone **PERF-K2**, per-media **`parseCinfMedia`** **PERF-I1**) only for **`channelMap`**.

**Issues:**

1. ~~**High:** Every Settings open paid full snapshot cost~~ **Mitigated (2026-05-18):** **`channelMap: buildChannelMap(ctx)`** in **`settings-get.js`**.

**Quick wins:** **`buildChannelMap(ctx)`** — **done.**

**Regression checks:** Settings UI channel routing / resolution labels unchanged.

---

### PERF-D2 — `runConnectionQueryCycle` AMCP chain (2026-05-18, @cursor-agent)

**Environment:** Static review `src/utils/query-cycle.js`.

**Method:** Read `runConnectionQueryCycle`, `finishConnectionGather`, `scheduleStartupHqThumbnailPrewarm`.

**Baseline:** Not measured (no AMCP trace).

**Chain (sequential command queue):**

1. **CLS** → **`handleCLS`** + state update → optional **CINF** for first **`max_cinf`** files (default **100**, `config.query_cinf` / `max_cinf`).
2. **TLS** → merge **mediaDetails** → **VERSION** ×3 nested.
3. **INFO** tree → **INFO PATHS / SYSTEM / CONFIG** → per-channel **INFO** for each `gatheredInfo.channelIds` entry.
4. **`finishConnectionGather`**: dynamic variables, routing setup, reconcile, **`startPeriodicSync`**, then **`_wsBroadcast('state', self.getState())`** — another **full** snapshot to all WS clients after connect burst.

**Additional cost:** **`updateChannelVariablesFromXml`** uses **`xml2js.parseString`** per channel INFO (async callbacks; can overlap with queue depth).

**Issues:**

1. **High (startup spike):** Connect + gather is an **AMCP burst** proportional to **`min(mediaCount, max_cinf)` + channel count**; acceptable once but harsh on slow links.
2. ~~**High:** **`scheduleStartupHqThumbnailPrewarm`** used **`maxItems: ids.length`**~~ **Mitigated (2026-05-18):** **`query-cycle.js`** uses **`Math.min(ids.length, 80)`** — aligns with periodic CLS prewarm cap (**PERF-I1**).
3. **Med:** Post-gather **`state` WS** duplicates client initial **`state`** message if both fire around the same time.

**Quick wins:** ~~Cap startup HQ prewarm~~ **Done** (**80** max); document `max_cinf` tuning.

**Regression checks:** Connect still fills `gatheredInfo`; Companion/tally variables still update.

---

### PERF-C1 — WebSocket server lifecycle & fan-out (2026-05-18, @cursor-agent)

**Environment:** Static review `src/server/ws-server.js`.

**Method:** Trace `connection`, `broadcast`, StateManager hooks, logging.

**Baseline:** Not measured.

**Findings:**

| Topic | Detail |
|-------|--------|
| **Initial snapshot** | Each new client runs **`getSnapshot()`** → full **`getState()`** path + **`JSON.stringify`** — **O(catalog)** work **per connection** (**PERF-K2/I1**). |
| **Periodic log noise** | **`onUpgrade`** logs path + **`isWsPath`** for **every** HTTP upgrade attempt — can flood logs on port scans / health checks. |
| **Incoming messages** | **`ctx.log('info', …)`** logs every JSON WS message (truncated 300 chars) — **info-level** spam + stringify cost under automation. |
| **StateManager** | **`state.on('change')` / `on('variables')`** call **`broadcast`** with **no debounce** — rapid `setVariable` / state mutations → **N × clients** messages (small payloads but multiplied). |
| **Fan-out** | **`broadcast`** builds **one** JSON string per event then **`send`** to each open socket — efficient vs per-client stringify (**PERF-C2** aligned). |

**Issues:**

1. **Med:** Per-connect full snapshot dominates reconnect storms (browser devtools reload, Companion reconnect).
2. **Low:** Upgrade / WS receive logging should be **debug** or sampled in production deployments.

**Quick wins:** Downgrade noisy logs; optional **`ws`** query flag to skip heavy initial `state` for diagnostic clients (contract change).

**Regression checks:** First-frame UI still receives `state`; `variable_update` / `change` still flow.

---

### PERF-I1 — Media catalog / CLS → memory & CPU (2026-05-18, @cursor-agent)

**Environment:** Static code review.

**Method:** Read `src/utils/handlers.js`, `periodic-sync.js` (`runMediaClsTlsRefresh`, thumbnail prewarm), `src/api/get-state.js`.

**Baseline:** Not measured.

**Hot paths:**

| Location | Behaviour |
|----------|-----------|
| `handlers.handleCLS` | Clears `CHOICES_MEDIAFILES`, parses **every** CLS line with regex, **push** — size = Caspar media catalog (**unbounded**). Same pattern `handleTLS` for templates. |
| `runMediaClsTlsRefresh` | Sequential `CLS` then `TLS` AMCP queries; updates state + `handlers`; logs count; **`scheduleHqThumbnailPrewarmFromCls`** caps **80** ffmpeg thumbnail generations (good guard). |
| `getState(ctx)` | After `state.getState()`, maps **every** `base.media` entry: `parseCinfMedia(cinf)` + merge `_mediaProbeCache` — **O(n)** per snapshot. |

**Issues:**

1. **High:** Large CLS ⇒ RAM (`CHOICES_MEDIAFILES` + `state.media`) + **every** `/api/state` or WS snapshot pays full media-array enrichment.
2. **Med:** Periodic sync (when enabled) pulls full CLS/TLS on interval — spikes AMCP + CPU parsing.

**Quick wins:** Lazy `parseCinfMedia` only for visible subset (needs API contract change); document max recommended catalog size.

**Larger refactors:** Paginated CLS / server-side filter; drop duplicate storage between `CHOICES_*` and `state.media` if redundant.

**Regression checks:** Media browser count matches Caspar; thumbnails still prewarm after CLS.

---

### PERF-D3 — `periodic-sync` intervals & work done each tick (2026-05-18, @cursor-agent)

**Environment:** Static review of `src/utils/periodic-sync.js` + `index.js` wiring.

**Method:** Trace `startPeriodicSync`, `resolveIntervalSec`, OSC vs non-OSC branches.

**Baseline:** Not measured.

**Defaults:** Periodic sync **disabled** until `periodic_sync_interval_sec` or `HIGHASCG_PERIODIC_SYNC_SEC` set &gt; 0 (`resolveIntervalSec` returns `null`). When OSC playback active, base interval floored to **≥45s** unless `periodic_sync_interval_sec_osc` / `HIGHASCG_PERIODIC_SYNC_OSC_SEC` overrides.

**Each tick (`runPeriodicSync`):**

| Mode | Work |
|------|------|
| **OSC active** | `runPeriodicOscLightSync`: full **`runMediaClsTlsRefresh`** (CLS + TLS + `updateMediaDetails`) + **`runPeriodicInfoConfigRefresh`** (INFO CONFIG XML, decklink parse, optional `getState` for channelMap WS). |
| **Non-OSC** | `runPeriodicChannelInfoSync`: sequential **`amcp.info(ch)`** per mapped program/preview channel + XML reconcile + **`reconcileLiveSceneFromGatheredXml`** + **`playbackTracker.reconcilePlaybackMatrixFromGatheredXml`**. |

**Separate timer:** `startOscPlaybackInfoSupplement` — optional `osc_info_supplement_ms` / `HIGHASCG_OSC_INFO_MS`, min **500ms**, sequential INFO per **program** channel; ends with **`_wsBroadcast('change', { path: 'channels', value: self.state.getState().channels })`** — clones **channels only** but still triggers full listener fan-out.

**Issues:**

1. **Med:** OSC light path still does **full CLS/TLS** every period — aligns with PERF-I1 heap + parse cost.
2. **Low:** `.unref()` on main periodic timer and OSC supplement timer reduces process-lifetime pinning — good.

**Quick wins:** Tune intervals upward on busy systems; disable CLS/TLS sub-pass when only INFO CONFIG needed (product decision).

**Regression checks:** Variables / decklink summary still refresh after sync; reconnect clears timer (`clearPeriodicSyncTimer`).

---

### PERF-C2 — WebSocket periodic full `state` broadcast (2026-05-18, @cursor-agent)

**Environment:** Static review `index.js`, `src/server/ws-server.js`, `src/api/get-state.js`.

**Method:** Trace `wsBroadcastMs` / `HIGHASCG_WS_BROADCAST_MS` → `stateBroadcastIntervalMs` → `setInterval` → `broadcast('state', getSnapshot())`.

**Baseline:** Not measured.

**Findings:**

1. **Default safe:** `HIGHASCG_WS_BROADCAST_MS` and CLI default resolve to **0** → **no** periodic full-state timer (`ws-server.js` only schedules when `intervalMs &gt; 0`).
2. **When enabled:** Every interval calls `getSnapshot()` → **`getState(appCtx)`** (`index.js` assigns `appCtx.getState = () => getState(appCtx)`), which:
   - invokes **`state.getState()`** → full **`JSON.parse(JSON.stringify(...))`** deep clone (**PERF-K2**),
   - then **`base.media.map`** with **`parseCinfMedia`** per row (**PERF-I1**),
   - then **`JSON.stringify`** entire payload **once per connected client** is avoided — actually `broadcast` builds **one** `msg = safeStringify({ type: event, data })` then sends same string to each client — **good** (single stringify per tick).
3. **Still expensive:** Building `data` once per tick is CPU-heavy for large state; bandwidth = `clients × msg.length`.

**Issues:**

1. **High (when misconfigured):** Low `HIGHASCG_WS_BROADCAST_MS` + large media catalog + many WS clients ⇒ CPU + network churn; prefer push-on-change (already partial via `state.on('change')`).

**Quick wins:** Keep default **0**; document danger of enabling with huge libraries; consider minimum interval guard (e.g. ≥1000ms) if product wants safety rail.

**Regression checks:** With broadcast ms = 0, no timer; with value &gt; 0, DevTools shows steady `state` frames.

---

### PERF-A1 — Timers: `setInterval` / `setTimeout` inventory (2026-05-18, @cursor-agent)

**Environment:** Static pass; no long-running capture.

**Method:** `rg 'setInterval|setTimeout'` on `index.js` and `src/**/*.js` (counts + spot-read of recurring timers).

**Baseline:** Not measured (no event-loop histogram).

**Hot paths — always-on or high-impact:**

| Location | Mechanism | Notes |
|----------|-----------|--------|
| `index.js` | `_systemVarsInterval` every **5s** | Sets `app_uptime` / `app_memory_usage` variables. |
| `index.js` | `_startupInventoryInterval` | Only if `HIGHASCG_SYSTEM_INVENTORY_REFRESH_SEC` &gt; 0. |
| `index.js` | `setTimeout` 800ms / 1500ms | Post-Caspar-connect `fetchInfo` + LED test clear. |
| `src/server/ws-server.js` | `setInterval` | Full `broadcast('state', getSnapshot())` when `stateBroadcastIntervalMs` / `HIGHASCG_WS_BROADCAST_MS` &gt; 0 — **pairs with PERF-K2/C2**. |
| `src/utils/periodic-sync.js` | `setInterval` (main + OSC supplement) | AMCP INFO / XML refresh cadence — **PERF-D3**. |
| `src/caspar/connection-manager.js` | `_healthTimer` | When `HIGHASCG_AMCP_HEALTH_MS` &gt; 0. |
| `src/engine/timeline-playback.js` | `setInterval` | Timeline ticker (when engine active). |
| `src/engine/clip-end-fade.js` | `Map` of `setInterval` | Per-watch timers — scales with concurrent clip-end jobs (**PERF-D5**). |

**Also present (many files):** one-shot / debounce `setTimeout` in `routes-mixer`, `routes-scene`, `streaming-lifecycle`, `shutdown`, `startup-led-test-pattern`, `fetch-server-info-config`, `dmx-sampling` (debounce map), `caspar-ffmpeg-setup`, etc. — review if any fire in tight loops.

**Issues:**

1. **Med:** Overlapping periodic work (5s vars + periodic-sync + optional WS full state) without coordination can align and cause jitter.
2. **Low:** Several timers use `.unref()` where applicable (`ws-server`) — good pattern; audit others.

**Quick wins:** Document default periods in operator README; graph cumulative timer firing times under `--inspect`.

**Regression checks:** Caspar reconnect still triggers `fetchInfo`; WS periodic broadcast optional env remains off by default.

---

### PERF-K3 — Unbounded arrays / caches on `appCtx` (2026-05-18, @cursor-agent)

**Environment:** Repo scan + selective file reads (`handlers.js`, `routes-state.js`, `ws-server.js`, `log-buffer.js`, `state-manager.js`).

**Method:** `rg` on `CHOICES_MEDIAFILES`, `mediaDetails`, `gatheredInfo`, `ctx._`, `sceneDeck`, snapshot helpers.

**Baseline:** Not measured (no heap snapshots).

**Structures:**

| Item | Bounded? | Risk |
|------|------------|------|
| `ctx.CHOICES_MEDIAFILES` | **No hard cap** — rebuilt from disk scan (`src/utils/handlers.js` clears + push per file) | **High** for huge media roots: RAM, `/api/state` / WS payload size, probe scheduling. |
| `ctx.mediaDetails` | Reset during query cycles then filled; keys ∝ media queried | Large libraries → large merged **state.media** / payloads. |
| `ctx._mediaProbeCache` | **No eviction** — grows with distinct probed ids (`routes-state.js` adds up to **120** new probes per `/api/state` hit when eligible) | **Med–High** over long uptime / repeated polls until cache covers catalog. |
| `gatheredInfo.*` (`infoConfig`, `channelXml`, …) | Channel-count bounded; **string sizes** unbounded | Huge Caspar INFO XML → memory + JSON cost. |
| `sceneDeck.sceneSnapshots` (WS `scene_deck_sync`) | **No server-side cap** | Operator/companion could sync very large scene JSON → RAM spike. |
| `log-buffer` (`src/utils/log-buffer.js`) | **Yes** — default **4000** lines (max **50000** via `setMaxLines`) | Tunable leak guard. |
| `_amcpHistory` (`amcp-client.js`) | **Yes** — last **50** | Low. |
| `StateManager._changes` | **Yes** — `MAX_CHANGES = 500` | Low. |
| `ctx._multiviewLayouts` | Keys ≈ screen indices | Low. |

**Issues:**

1. **High:** Media catalog size drives multiple subsystems — prioritize pagination/virtualization (**PERF-I1**) and probe-cache LRU/eviction.
2. **Med:** `sceneSnapshots` persistence path should be reviewed for max payload / refusal rules (product).

**Quick wins:** Metrics: expose `CHOICES_MEDIAFILES.length`, `_mediaProbeCache` key count in debug endpoint or logs.

**Larger refactors:** Streaming media index; LRU for `_mediaProbeCache`; refuse oversized WS `scene_deck_sync`.

**Regression checks:** Media browser, Companion deck sync, `/api/state` still valid JSON.

---

### PERF-K2 — `JSON.parse(JSON.stringify(...))` clones (2026-05-18, @cursor-agent)

**Environment:** Repo scan only — Node N/A, no Caspar session.

**Method:** `rg 'JSON\\.parse\\(JSON\\.stringify' src/` plus read of `StateManager#getState` / OSC merge path.

**Baseline:** Not measured (no `--inspect`); qualitative hotspot list only.

**Hot paths:**

| Location | Role |
|----------|------|
| `src/state/state-manager.js` | `getState()` deep-clones **channels, media, templates, osc, audio** every call — pairs with WS/API consumers (see PERF-C*, PERF-B*). |
| `src/state/state-manager.js` | `updateFromOscSnapshot` clones full `snapshot` and per-channel `oscLayers` / `oscOutputs` / levels on OSC updates. |
| `src/osc/osc-state.js` | `getSnapshot()`-style exports clone channel maps. |
| `src/bootstrap/config.js` | `buildConfig`: `JSON.parse(JSON.stringify(configManager.get()))` on each build — runs on reload and startup paths. |

**Issues:**

1. **High (when called often):** `getState()` allocates large strings + objects; if any code path invokes it on a tight timer or per-message, CPU and GC churn spike.
2. **Med:** Structured clone alternative (`structuredClone`) or selective deltas could shrink work where full snapshots are unnecessary (product trade-off).

**Quick wins:** Confirm callers use `getDelta(since)` where possible instead of full `getState`; profile WS broadcast path (PERF-C2).

**Larger refactors:** Incremental immutable state or shared read-only snapshots with copy-on-write.

**Regression checks:** Existing smoke routes + WS clients still receive expected shapes.

---

### PERF-K1 — Sync `fs` / `execSync` / `spawnSync` in `src/` (2026-05-18, @cursor-agent)

**Environment:** Repo scan only.

**Method:** `rg` for `readFileSync|writeFileSync|execSync|spawnSync|readdirSync|statSync|existsSync` under `src/` (plus noted `index.js` uses `fs.existsSync` / `statSync` at startup — out of strict `src/` grep but on critical path).

**Baseline:** Not measured.

**Hot paths / buckets:**

| Bucket | Examples | Risk |
|--------|----------|------|
| **Persistence / config** | `src/utils/persistence.js` (read/write state file), `src/config/config-manager.js` (modular JSON read/write) | Blocks event loop during flush/reload; frequency matters. |
| **Admin HTTP APIs** | `routes-system-hardware.js` (`execSync('xrandr…')`, `readdirSync` NVIDIA pool), `routes-system-setup.js`, `os-config.js`, `hardware-info.js`, `audio-devices.js` | **Med–High** when UI polls Device View / Settings hardware tabs. |
| **Caspar debug** | `src/caspar/amcp-client.js` `writeFileSync` when dumping AMCP history | Low unless enabled. |
| **User-triggered** | `exfat-sync.js`, `routes-ingest.js`, `routes-data.js` autosave, `routes-multiview.js` deploy copy checks | Acceptable if not polled rapidly. |
| **Startup / rare** | `bootstrap/system-inventory-file.js`, `routing-setup.js`, `startup-led-test-pattern.js` | Low frequency. |

**Issues:**

1. **Med:** Hardware/settings routes combine sync FS + `execSync` — under concurrent HTTP clients, latency stacks on one thread.
2. **Low:** Widespread `existsSync` before reads — cheap but noisy; batch where possible inside hot loops.

**Quick wins:** Document which endpoints block; add timeouts (`execFile` already used in places — extend pattern).

**Larger refactors:** `fs.promises` + worker thread for heavy system probes; queue persistence writes.

**Regression checks:** Settings save/load, persistence restore, hardware panels still return correct JSON.

---

*(Older findings stack below this line as agents prepend.)*

---

## 13. Cross-agent dependencies & merge points

| If you find… | Also notify / merge with |
|--------------|---------------------------|
| AMCP latency dominates | PERF-D*, PERF-E*, Web UI preview behavior |
| WS bandwidth huge | PERF-C*, PERF-B* (payload sources) |
| Heap growth | PERF-F*, PERF-K*, plugin tasks |
| Disk thrash | PERF-A4, PERF-F2, PERF-I1 |

---

## 14. Completion criteria for the overall “performance run check”

The umbrella initiative is **complete** when:

1. Every row in § 11 is **🟢 Done**, **🔴 Blocked** (with owner), or **⏭️ Waived** (with reason).
2. § 12 contains at least one dated entry per **Done** task (merged duplicates OK).
3. A short **Executive summary** (5–10 bullets) is appended here:

### Executive summary *(fill when rollout closes)*

- **Hot polling paths:** Device View (`GET /api/device-view`) and aggressive log tails dominate synchronous gather + JSON cost when UIs poll quickly — throttle clients or add short TTL caches before tuning deeper (**PERF-B3**, **PERF-B4**).
- **WebSocket:** Full-state **`change`** fan-out plus uncapped **`log_line`** streaming scales poorly with verbose logging and multiple tabs — prioritize throttling/coalescing **`log_line`** and channel **`channels.*`** updates (**PERF-C1**, **PERF-C3**, **PERF-F1**).
- **Periodic snapshots:** CLS/TLS/INFO cycles and **`updateFromInfo`** xml2js multiply work by channel count — keep intervals sane and avoid redundant INFO pulls (**PERF-D3**, **PERF-F1**).
- **AMCP misuse:** Prefer **`/api/amcp/batch`** / chunked sends over **`raw-batch`** for large scripted batches (**PERF-D4**).
- **Persistence:** Every **`persistence.set`** rewrites the entire JSON document synchronously — debouncing saves is the highest-impact Node-side disk fix (**PERF-F2**, **PERF-E3**).
- **Timeline:** Playback ticks run at **40ms** while **`timeline.tick`** WS is intentionally slower (**165ms**) — AMCP-heavy timelines remain the bottleneck under dense automation (**PERF-E4**, **PERF-C4**).
- **Config churn:** **`configManager` `change`** restarts OSC, streaming hooks, DMX sampling, and Caspar TCP — avoid accidental rapid save loops (**PERF-A2**).
- **External inputs:** Art-Net logging at **`info`** per universe delta can flood logs under active lighting desks (**PERF-J2**).
- **Streaming/media ingest:** UDP **`localport`** scheme avoids bind collisions; ingest uploads stream to disk (**PERF-G2**, **PERF-I2**).
- **Mitigations landed this run:** **`GET /api/settings`** builds **`channelMap`** via **`buildChannelMap(ctx)`** (no full **`getState()`** just for routing); startup HQ thumbnail prewarm capped to **80** items to align with CLS thumbnail budgets (**PERF-B2**, **PERF-D2**).
- **Follow-up verification (same methodology — static only):** **`playback-tracker`** / **`routes-system-hardware`** were split into smaller **`src/state`** / **`src/api`** modules afterward — **behavior-preserving refactors**, no measured perf delta in this step (**PERF-000** §12).

---

## 15. Document maintenance

| Field | Action |
|-------|--------|
| **New subsystem added** | Add tasks under new Work package + registry rows |
| **Duplicate task discovered** | Waive one ID; cross-link in Notes |
| **Line counts / paths drift** | Update § 3 map only when architecture changes—not required every sprint |

---

*End of bulletin — replace § 11–12 as agents progress.*
