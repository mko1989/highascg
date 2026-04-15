# HighAsCG — Project Breakdown

> Standalone CasparCG graphics controller with timeline editor, scene management, live preview, DMX pixel mapping, and multi-protocol integration.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      Browser SPA (web/)                          │
│  Components: Inspector, Timeline, Scenes, Multiview, Dashboard   │
│  Lib: StateStore, WebRTC, WS client, Scene/Timeline state        │
├──────────────────────────────────────────────────────────────────┤
│                         WebSocket + HTTP API                     │
├──────────────────────────────────────────────────────────────────┤
│                      Node.js Server (src/)                       │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │
│  │ AMCP TCP │ │ Engine │ │ Streaming│ │   OSC   │ │   DMX    │ │
│  │ client   │ │ scene/ │ │ go2rtc/  │ │ listener│ │ sampling │ │
│  │ protocol │ │ tline/ │ │ UDP/NDI  │ │ state   │ │ Art-Net/ │ │
│  │ batch    │ │ PIP/FTB│ │ WebRTC   │ │ vars    │ │ sACN     │ │
│  └────┬─────┘ └───┬────┘ └────┬─────┘ └────┬────┘ └────┬─────┘ │
│       │           │           │             │           │       │
├───────┴───────────┴───────────┴─────────────┴───────────┴───────┤
│       TCP            AMCP              UDP/NDI           UDP    │
│        ▼              ▼                  ▼                ▼     │
│   CasparCG         CasparCG           go2rtc         Art-Net/  │
│   Server           AMCP 5250          WebRTC         sACN DMX  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Feature Catalog

### 1. CasparCG AMCP Protocol Client

Full AMCP 2.x protocol implementation with ~79 commands across 7 categories.

| Module | Description |
|--------|-------------|
| `src/caspar/amcp-client.js` | Facade composing all sub-modules, `_send()` with serialized queue + per-command timeout |
| `src/caspar/amcp-protocol.js` | AMCP response state machine (NEXT/SINGLE_LINE/MULTI_LINE), callback dispatch |
| `src/caspar/connection-manager.js` | TCP lifecycle, auto-reconnect, health checks, disconnect cleanup |
| `src/caspar/tcp-client.js` | Raw TCP with CRLF line splitting, exponential backoff reconnect |
| `src/caspar/amcp-basic.js` | PLAY, LOADBG, LOAD, PAUSE, RESUME, STOP, CLEAR, CALL, SWAP, ADD, REMOVE, PRINT, LOG, SET, LOCK, PING |
| `src/caspar/amcp-mixer.js` | All MIXER commands with DEFER + query mode |
| `src/caspar/amcp-cg.js` | CG ADD/PLAY/STOP/NEXT/REMOVE/CLEAR/UPDATE/INVOKE/INFO |
| `src/caspar/amcp-data.js` | DATA STORE/RETRIEVE/LIST/REMOVE |
| `src/caspar/amcp-query.js` | INFO, VERSION, CLS, TLS, FLS, CINF, DIAG, GL, HELP, RESTART, KILL |
| `src/caspar/amcp-thumbnail.js` | THUMBNAIL LIST/RETRIEVE/GENERATE/GENERATE_ALL |
| `src/caspar/amcp-batch.js` | BEGIN…COMMIT batching with timeout + sequential fallback |
| `src/caspar/amcp-constants.js` | Transitions, tweens, blend modes, video modes, return codes |
| `src/caspar/amcp-parsers.js` | Response parsers (CLS/TLS/INFO → structured objects) |
| `src/caspar/amcp-types.js` | JSDoc type definitions |
| `src/caspar/amcp-simulated.js` | Offline/simulated responses for `--no-caspar` mode |

### 2. Scene Management & Live Production

| Module | Description |
|--------|-------------|
| `src/engine/scene-take.js` | Scene take execution — transitions a look (set of layers) onto program |
| `src/engine/scene-take-lbg.js` | LOADBG-style stacking variant of scene take |
| `src/engine/scene-transition.js` | Transition logic (MIX, CUT, PUSH, WIPE, STING) |
| `src/engine/scene-exit-layers.js` | Clearing exiting layers after transition |
| `src/engine/scene-native-fill.js` | Native fill/layout helpers for scene geometry |
| `src/engine/ftb-pgm-prv.js` | Fade-to-black across PGM+PRV channels |
| `src/engine/clip-end-fade.js` | Auto-fade at clip end point |
| `src/engine/program-layer-bank.js` | A/B program stack management |
| `src/state/live-scene-state.js` | Persisted per-channel "what scene is live" |
| `src/state/live-scene-reconcile.js` | Scene reconciliation after reconnect |

### 3. Timeline Editor & Playback

| Module | Description |
|--------|-------------|
| `src/engine/timeline-engine.js` | Timeline data model — layers, clips, keyframes, CRUD |
| `src/engine/timeline-playback.js` | Playback transport — play/pause/stop/seek, loop, ticker |
| `src/engine/timeline-playback-amcp.js` | AMCP scheduling — PLAY/LOAD/MIXER per tick |
| `src/engine/timeline-playback-helpers.js` | Effect→AMCP builders, audio filter suffix, constants |
| `src/engine/audio-route.js` | Logical audio routes → Caspar audioFilter strings |

### 4. PIP Overlay System

| Module | Description |
|--------|-------------|
| `src/engine/pip-overlay.js` | AMCP line builders for HTML PIP templates |
| `src/api/routes-pip-overlay.js` | REST: apply/update/remove PIP overlays |
| `templates/pip-*.html` | HTML/CSS PIP overlay templates (border, shadow, glow, edge strip) |

### 5. Multiview

| Module | Description |
|--------|-------------|
| `src/api/routes-multiview.js` | Multiview grid layout, route sources, HTML overlay, DeckLink |
| `web/components/multiview-editor.js` | Drag-and-drop multiview layout editor |
| `templates/multiview-overlay.html` | Multiview HTML overlay template |

### 6. Streaming & Live Preview (WebRTC)

| Module | Description |
|--------|-------------|
| `src/streaming/go2rtc-manager.js` | go2rtc process lifecycle, YAML generation, UDP bridges |
| `src/streaming/go2rtc-config.js` | Capture tier detection (local/NDI/UDP), config builders |
| `src/streaming/caspar-ffmpeg-setup.js` | Caspar ADD/REMOVE STREAM consumers |
| `src/streaming/stream-config.js` | Streaming config resolution (quality, hardware accel) |
| `src/streaming/streaming-udp-ports.js` | Free base port scan with auto-relocation |
| `src/streaming/ndi-resolve.js` | NDI source naming and validation |
| `src/bootstrap/streaming-lifecycle.js` | Start/stop/restart streaming subsystem |
| `src/api/routes-streaming.js` | Toggle/restart streaming, WebRTC proxy, NDI sources |

### 7. OSC Integration

| Module | Description |
|--------|-------------|
| `src/osc/osc-listener.js` | UDP OSC receiver with stats |
| `src/osc/osc-state.js` | Aggregates Caspar OSC → channels (layers, audio meters, profiler) |
| `src/osc/osc-variables.js` | OSC snapshot → Companion-style variables |
| `src/osc/osc-config.js` | Normalize OSC listen address/port |
| `src/bootstrap/osc-lifecycle.js` | Start/stop/restart OSC subsystem |

### 8. DMX Pixel Mapping

| Module | Description |
|--------|-------------|
| `src/sampling/dmx-sampling.js` | Frame sampling from Caspar → pixel→fixture mapping via worker |
| `src/sampling/dmx-sampling-ingress.js` | UDP/FILE ingress, ffmpeg readers, FIFO, Caspar consumers |
| `src/sampling/sampling-worker.js` | Worker thread: per-pixel RGB extraction, gamma, LED formats |
| `src/sampling/dmx-output.js` | Art-Net + sACN output senders |

### 9. CasparCG Config Generator

| Module | Description |
|--------|-------------|
| `src/config/config-generator.js` | Main `buildConfigXml()` — screens, multiview, DeckLink, streaming |
| `src/config/config-generator-builders.js` | XML fragment builders, audio routing, consumer helpers |
| `src/config/config-modes.js` | Video mode presets and dimensions |
| `src/config/config-manager.js` | Load/save `highascg.config.json` |
| `src/config/config-compare.js` | Compare generated vs running server config |
| `src/config/routing.js` | Channel map (PGM/PRV/MV/input) per screen count |

### 10. Media Management

| Module | Description |
|--------|-------------|
| `src/media/local-media.js` | Safe path resolution, HTTP file serving, DELETE, recursive scan |
| `src/media/local-media-ffmpeg.js` | ffprobe, waveform bars, thumbnail PNG, disk cache |
| `src/media/cinf-parse.js` | Parse CINF lines for duration/resolution |
| `src/api/routes-media.js` | Thumbnails, local media, cinf, media refresh |
| `src/api/routes-ingest.js` | Upload, URL download, WeTransfer ingest |

### 11. PGM Recording

| Module | Description |
|--------|-------------|
| `src/api/routes-pgm-record.js` | FFmpeg FILE consumer on PGM channel, env-tunable encoding |

### 12. State Management

| Module | Description |
|--------|-------------|
| `src/state/state-manager.js` | Channels, media, templates, variables, OSC mirror, change log |
| `src/state/playback-tracker.js` | Playback matrix (what's playing where) |
| `src/utils/persistence.js` | Key-value persistence (live scenes, project on disk) |

### 13. HTTP Server & WebSocket

| Module | Description |
|--------|-------------|
| `src/server/http-server.js` | Static files, `/api/*` routing, CORS, Companion instance prefix |
| `src/server/ws-server.js` | WebSocket on same port, state broadcast, variable updates |
| `src/server/cors.js` | CORS header merge |

### 14. REST API (60+ endpoints)

| Route Module | Coverage |
|-------------|----------|
| `routes-amcp.js` | All basic AMCP commands via REST |
| `routes-mixer.js` | All MIXER commands + query mode |
| `routes-cg.js` | CG template commands |
| `routes-data.js` | DATA store/retrieve |
| `routes-state.js` | State snapshot, variables, channels, server info |
| `routes-scene.js` | Scene take (program look transition) |
| `routes-timeline.js` | Timeline CRUD, playback control |
| `routes-ftb.js` | Fade-to-black |
| `routes-settings.js` | Get/set settings, hardware displays |
| `routes-audio.js` | Audio devices, routing, ALSA config |
| `routes-caspar-config.js` | Generate/apply CasparCG config XML |
| `routes-host-stats.js` | CPU/RAM/disk stats |
| `routes-logs.js` | Log ring buffer |
| `routes-project.js` | Production bundle sync/diff/apply |
| `routes-system-setup.js` | LAN IPs, Tailscale, Syncthing hints |

### 15. Project Sync & Bundles

| Module | Description |
|--------|-------------|
| `src/api/routes-project.js` | Production bundle export/import, manifest diff, media sync |

### 16. Companion Integration

- Instance URL prefix (`/instance/:id/...`) for static + API
- Selection endpoint for button state
- Variable mirror to `StateManager`

### 17. Utilities

| Module | Description |
|--------|-------------|
| `src/utils/logger.js` | Logging with min-level filter |
| `src/utils/log-buffer.js` | Ring buffer for `/api/logs` UI |
| `src/utils/periodic-sync.js` | CLS/TLS refresh, OSC playback supplement |
| `src/utils/hardware-info.js` | Host/OS facts for settings |
| `src/utils/program-resolution.js` | Program canvas size per screen |
| `src/utils/query-cycle.js` | AMCP query helpers |

---

## Web UI Components

### Shell & Workspace
`header-bar.js`, `dashboard.js`, `dashboard-cell.js`, `connection-eye.js`, `output-status.js`, `profiler-display.js`, `now-playing.js`, `playback-timer.js`, `vu-meter.js`, `variables-panel.js`, `live-view.js`, `sync-modal.js`, `publish-modal.js`, `logs-modal.js`, `settings-modal.js`, `system-settings.js`, `led-test-modal.js`, `live-input-modal.js`

### Scenes
`scenes-editor.js`, `scenes-shared.js`, `scenes-compose.js`, `scenes-preview-runtime.js`, `scene-list.js`, `scene-layer-row.js`, `preview-canvas.js`, `preview-canvas-panel.js`, `preview-canvas-draw.js`

### Inspector
`inspector-panel.js`, `inspector-panel-views.js`, `inspector-panel-timeline.js`, `inspector-common.js`, `inspector-mixer.js`, `inspector-effects.js`, `inspector-fill.js`, `inspector-transition.js`, `inspector-pip-overlay.js`

### Timeline
`timeline-editor.js`, `timeline-canvas.js`, `timeline-canvas-clip.js`, `timeline-canvas-utils.js`, `timeline-transport.js`

### Multiview & Pixel Map
`multiview-editor.js`, `pixel-map-editor.js`, `fixture-inspector.js`

### Audio
`audio-mixer-panel.js`

### Sources & Ingest
`sources-panel.js`

---

## Web Lib Modules

| Module | Role |
|--------|------|
| `api-client.js` | HTTP API base URL, Companion prefix |
| `ws-client.js` | WebSocket connection, message routing |
| `state-store.js` | Client state merge / subscriptions |
| `webrtc-client.js` | Browser WebRTC to go2rtc |
| `workspace-layout.js` | Layout/docking of UI regions |
| `selection-sync.js` | Selection coherence across panels |
| `scene-state.js` | Scene reactive state |
| `timeline-state.js` | Timeline reactive state |
| `multiview-state.js` | Multiview reactive state |
| `stream-state.js` | Streaming reactive state |
| `dashboard-state.js` | Dashboard reactive state |
| `dmx-state.js` | DMX reactive state |
| `audio-mixer-state.js` | Audio mixer reactive state |
| `settings-state.js` | Settings reactive state |
| `variable-state.js` | Variable reactive state |
| `project-state.js` | Project sync state |
| `effect-registry.js` | Mixer/scene effects metadata |
| `pip-overlay-registry.js` | PIP template definitions |
| `mixer-fill.js` | Fill math for inspector |
| `fill-math.js` | Fill geometry calculations |
| `timeline-clip-interp.js` | Keyframe interpolation |
| `timeline-clip-layout.js` | Clip geometry layout |
| `waveform-fetch-queue.js` | Waveform loading queue |
| `osc-client.js` | OSC-related client behavior |
| `offline-storage.js` | Offline/local persistence |
| `playback-clock.js` | Timing helpers |

---

## File Size Compliance (500-line limit)

### Backend — All Compliant ✓

All `src/` and root JS files are under 500 lines after the April 2026 modularization:

| Split | Result |
|-------|--------|
| `config-generator.js` (712→334) | + `config-generator-builders.js` (419) |
| `timeline-playback.js` (674→365) | + `timeline-playback-helpers.js` (75) + `timeline-playback-amcp.js` (262) |
| `local-media.js` (644→342) | + `local-media-ffmpeg.js` (336) |
| `dmx-sampling.js` (618→373) | + `dmx-sampling-ingress.js` (257) |
| `go2rtc-manager.js` (568→493) | + `go2rtc-config.js` (91) |
| `index.js` (738→489) | + `streaming-lifecycle.js` (254) + `osc-lifecycle.js` (78) + `fetch-server-info-config.js` (40) |
| `inspector-panel.js` (1047→365) | + `inspector-panel-timeline.js` (487) + `inspector-panel-views.js` (336) |

### Frontend — All Compliant ✓

All `web/` JS files are under 500 lines after the April 2026 modularization:

| Split | Result |
|-------|--------|
| `timeline-canvas.js` (739→477) | + `timeline-canvas-render.js` (355) |
| `timeline-editor.js` (729→358) | + `timeline-editor-handlers.js` (494) |
| `settings-modal.js` (717→416) | + `settings-modal-caspar-ui.js` (318) |
| `multiview-editor.js` (706→487) | + `multiview-editor-canvas.js` (247) |
| `sources-panel.js` (675→405) | + `sources-panel-helpers.js` (281) |
| `preview-canvas-draw.js` (620→15) | + `preview-canvas-draw-base.js` (210) + `preview-canvas-draw-stacks.js` (421) |
| `header-bar.js` (556→426) | + `header-bar-audio.js` (146) |
| `inspector-fill.js` (530→294) | + `inspector-fill-timeline.js` (239) |
| `scenes-editor.js` (526→404) | + `scenes-editor-support.js` (184) |
| `scene-state.js` (523→446) | + `scene-state-helpers.js` (92) |

---

## Work Orders (features delivered)

| WO | Title | Status |
|----|-------|--------|
| 00 | Project Goal & Architecture | ✓ |
| 01 | Analyze Companion Module | ✓ |
| 02 | Migrate to HighAsCG | ✓ |
| 05 | Live Preview (WebRTC) | ✓ |
| 06 | Audio Playout & Routing | ✓ |
| 07 | Complete AMCP Protocol API | ✓ |
| 08 | AMCP Client Facade | ✓ |
| 09 | OSC Integration | ✓ |
| 10 | Variables & Status | ✓ |
| 11 | Boot & Systemd | ✓ |
| 12 | Installer Scripts | ✓ |
| 13 | UI Polish | ✓ |
| 14 | Offline Mode | ✓ |
| 15 | Client/Server Sync | ✓ |
| 16 | Yamaha DM3 Integration | ✓ |
| 21 | Timeline Inspector Waveform | ✓ |
| 22 | Mixer Effects | ✓ |
| 23 | HTML Webpage Source | ✓ |
| 24 | Companion Button Press | ✓ |
| 25 | PIP Overlay Effects | ✓ |
| 26 | Fade on Clip End | ✓ |

### Roadmap

| WO | Title | Status |
|----|-------|--------|
| 17 | 3D Pre-visualization | Planned |
| 18 | Output Slicer | Planned |
| 19 | Person Tracking | Planned |

---

*Last updated: 2026-04-13*
