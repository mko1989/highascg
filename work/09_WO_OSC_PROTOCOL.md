# Work Order 09: Complete OSC Protocol Implementation

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Implement the **complete CasparCG OSC protocol** as a real-time data layer in HighAsCG. CasparCG Server broadcasts its internal state via OSC (Open Sound Control) over UDP. This provides **push-based, real-time** data that should **replace polling-based methods** (AMCP `INFO` queries) for:

- **Audio levels** (dBFS per channel) → VU meters
- **Playback time / remaining** (file/time, file/frame) → countdown timers, progress bars
- **Layer state** (type, paused, active) → layer status display
- **File metadata** (name, path, codec, resolution) → now-playing display
- **Channel profiler** (frame time) → performance monitoring
- **Output state** (consumer type, frame count) → output status

The reference docs have been cloned:
- `.reference/casparcg-wiki/Protocols/OSC-Protocol.md` — Server OSC output spec
- `.reference/casparcg-wiki/FFmpeg-Producer.md` — FFmpeg producer OSC data (time, frame, codec)
- `.reference/casparcg-client-wiki/OSC.md` — Client OSC control input (for reference only)

---

## Complete OSC Message Catalog

### Channel-Level Messages

Prefix: `/channel/[N]/`

| Address | Args | Type | Description |
|---------|------|------|-------------|
| `format` | `PAL` | string | Video format of the channel (e.g., `1080p5000`, `720p2500`) |
| `profiler/time` | `0.041` `0.04` | float float | Actual render time / expected frame time (seconds). If actual > expected → dropped frames |
| `output/port/[P]/type` | `screen` | string | Consumer type on output port P: `screen`, `system-audio`, `decklink`, `bluefish`, `file`, `ndi`, `stream` |
| `output/port/[P]/frame` | `200` `922222222888836854` | int int | Frames written / max frames (for file/stream consumers) |

### Audio Mixer Messages

Prefix: `/channel/[N]/mixer/audio/`

| Address | Args | Type | Description |
|---------|------|------|-------------|
| `nb_channels` | `2` | int | Number of audio channels on this CasparCG channel |
| `[M]/dBFS` | `-18.5` | float | Audio level in dBFS for audio channel M (0-indexed). Updated at frame rate (~25-60/sec) |

### Stage/Layer Messages

Prefix: `/channel/[N]/stage/layer/[L]/`

| Address | Args | Type | Description |
|---------|------|------|-------------|
| `time` | `101.24` | float | Seconds the layer has been active |
| `frame` | `2531` | int | Frame count since layer became active |
| `type` | `transition` | string | Producer type: `ffmpeg`, `color`, `image-scroll`, `html`, `route`, `transition`, `empty` |
| `background/type` | `empty` | string | Background producer type (loaded via LOADBG) |
| `profiler/time` | `0.39` `0.4` | float float | Layer render time: actual / expected |
| `paused` | `true` | bool | Whether the layer is paused |

### FFmpeg Producer Messages (v2.2+)

Prefix: `/channel/[N]/stage/layer/[L]/`

| Address | Args | Type | Description |
|---------|------|------|-------------|
| `file/name` | `TEST/GO1080P25` | string | Media file name (relative to media folder) |
| `file/path` | `/media/TEST/GO1080P25.mp4` | string | Absolute path of media file on server |
| **`file/time`** | **`12` `400`** | **float float** | **Seconds elapsed / Total seconds** — replaces AMCP polling for playback progress |
| `file/{stream-id}/fps` | `25` | float | Framerate of the stream |

### FFmpeg Producer Messages (v2.1 and earlier, some may still work in 2.3+)

Prefix: `/channel/[N]/stage/layer/[L]/`

| Address | Args | Type | Description |
|---------|------|------|-------------|
| **`file/frame`** | **`300` `10000`** | **int int** | **Frames elapsed / Total frames** — frame-accurate progress |
| `file/fps` | `25` | float | Framerate of file |
| `file/path` | `AMB.mp4` | string | Filename (relative) |
| `file/video/width` | `1920` | int | Frame width |
| `file/video/height` | `1080` | int | Frame height |
| `file/video/field` | `progressive` | string | Scan type: `progressive` or `interlaced` |
| `file/video/codec` | `H.264 /AVC` | string | Video codec |
| `file/audio/sample-rate` | `48000` | int | Audio sample rate |
| `file/audio/channels` | `2` | int | Audio channel count in file |
| `file/audio/format` | `s16` | string | Audio format (e.g., `s16`, `s32`, `fltp`) |
| `file/audio/codec` | `AAC` | string | Audio codec |
| `loop` | `1` | int | Loop state: `0` = no, `1` = yes |

### Flash/HTML Template Producer Messages

Prefix: `/channel/[N]/stage/layer/[L]/host/`

| Address | Args | Type | Description |
|---------|------|------|-------------|
| `path` | `template_file.ft` | string | Template file path |
| `width` | `1920` | int | Template render width |
| `height` | `1080` | int | Template render height |
| `fps` | `50` | float | Template render FPS |
| `buffer` | *(varies)* | — | Buffer state |

---

## Methods Replaced by OSC

The following methods/queries in the current codebase **poll** CasparCG via AMCP commands at intervals. OSC provides the same data **in real-time, pushed from the server**, eliminating the need for polling.

| Current Method (AMCP Polling) | OSC Replacement | Impact |
|-------------------------------|----------------|--------|
| **`periodic-sync.js`** → `INFO channel-layer` every N seconds for layer status | `/channel/N/stage/layer/L/type`, `/paused`, `/time`, `/frame` | **Eliminate periodic layer status polling** — OSC pushes state changes instantly |
| **`playback-tracker.js`** → manual tracking via PLAY/STOP intercepts | `/channel/N/stage/layer/L/file/time` (elapsed/total), `/file/frame` (elapsed/total) | **Replace on-play tracking** with server-authoritative time. Handles external plays/3rd-party apps |
| **`INFO ch-layer`** for clip progress / time remaining | `/channel/N/stage/layer/L/file/time` → `remaining = total - elapsed` | **Real-time countdown** without any AMCP commands |
| **`variables.js`** → playback variables updated via poll | OSC `file/time`, `file/frame`, `file/name` → Companion variables from WS | **Frame-accurate variable updates** at native frame rate |
| **`state-manager`** → channel format from INFO CONFIG | `/channel/N/format` | **Auto-detect format changes** without re-querying config |
| **`periodic-sync`** → audio level not tracked at all currently | `/channel/N/mixer/audio/M/dBFS` | **NEW capability** — VU meters, was impossible with AMCP polling |
| **AMCP `INFO`** for consumer/output status | `/channel/N/output/port/P/type` + `/frame` | **Real-time output monitoring** — detect dropped frames, consumer health |
| **File metadata** via `CINF` command per file | `/channel/N/stage/layer/L/file/video/width`, `/video/height`, `/video/codec`, `/audio/...` | **Auto-populated** when file plays — no separate query needed |

### Performance Benefit

- **AMCP polling**: `INFO ch-layer` per layer × N layers × M channels = many TCP roundtrips every sync interval
- **OSC push**: CasparCG sends data at frame rate (25-60 msgs/sec per active address) over UDP — zero TCP overhead, zero latency

---

## Tasks

### Phase 1: OSC UDP Receiver (Node.js server)

- [x] **T1.1** Add `osc` dependency to HighAsCG
  - `npm install osc` (Colin Clark's osc.js — handles UDP + parsing)
  - Already identified in WO-08; this WO provides the full protocol mapping

- [x] **T1.2** Create `src/osc/osc-listener.js` (≤250 lines)
  - UDP port listener (configurable, default `6250`)
  - Parse all incoming OSC messages via `osc.UDPPort`
  - Route messages by address pattern:
    - `/channel/*/mixer/audio/*` → audio handler
    - `/channel/*/stage/layer/*` → layer handler
    - `/channel/*/profiler/*` → profiler handler
    - `/channel/*/output/*` → output handler
    - `/channel/*/format` → channel format handler
  - Extract channel/layer numbers from address path
  - Emit structured events per domain

- [x] **T1.3** Create `src/osc/osc-state.js` (≤400 lines)
  - Aggregate all OSC data into structured state object:
    ```javascript
    {
      channels: {
        [channelId]: {
          format: 'PAL',
          profiler: { actual: 0.039, expected: 0.04, healthy: true },
          audio: {
            nbChannels: 2,
            levels: [
              { dBFS: -18.5, peak: -12.0, peakAge: 0 },
              { dBFS: -20.1, peak: -14.2, peakAge: 0 }
            ]
          },
          outputs: {
            [portId]: { type: 'decklink', frames: 24500, maxFrames: Infinity }
          },
          layers: {
            [layerId]: {
              type: 'ffmpeg',         // from stage/layer/L/type
              backgroundType: 'empty',
              time: 101.24,           // from stage/layer/L/time
              frame: 2531,            // from stage/layer/L/frame
              paused: false,          // from stage/layer/L/paused
              profiler: { actual: 0.39, expected: 0.40 },
              file: {                 // FFmpeg producer data
                name: 'NEWS/OPENER',
                path: '/media/NEWS/OPENER.mp4',
                elapsed: 12.0,        // from file/time arg[0]
                duration: 400.0,      // from file/time arg[1]
                remaining: 388.0,     // computed: duration - elapsed
                progress: 0.03,       // computed: elapsed / duration
                frameElapsed: 300,    // from file/frame arg[0]
                frameTotal: 10000,    // from file/frame arg[1]
                fps: 25.0,
                loop: false,
                video: {
                  width: 1920, height: 1080,
                  field: 'progressive', codec: 'H.264'
                },
                audio: {
                  sampleRate: 48000, channels: 2,
                  format: 's16', codec: 'AAC'
                }
              },
              template: {             // HTML/Flash producer data
                path: null, width: 0, height: 0, fps: 0
              }
            }
          }
        }
      }
    }
    ```
  - **Peak hold** for audio: track max dBFS, decay after configurable hold time
  - **Computed fields**: `remaining`, `progress`, `healthy`
  - **Layer lifecycle**: clear layer data when `type` goes to `empty`
  - Emit granular change events: `audio:1`, `layer:1:10`, `profiler:1`, etc.
  - Throttle state change emissions (configurable, default 50ms/20Hz)

- [x] **T1.4** Create `src/osc/osc-config.js` (≤100 lines)
  - Configuration:
    ```javascript
    {
      osc: {
        enabled: true,
        listenPort: 6250,
        listenAddress: '0.0.0.0',
        peakHoldMs: 2000,         // Peak level hold before decay
        emitIntervalMs: 50,       // WS broadcast throttle (20Hz)
        staleTimeoutMs: 5000,     // Mark layer stale if no OSC data received
      }
    }
    ```
  - Validation and defaults
  - *Deferred:* Wire into settings modal (WO-05) Audio tab

- [ ] **T1.5** Wire OSC into main app lifecycle *(partial — see bullets)*
  - Start OSC listener on app init (if enabled) — **done** in [`index.js`](index.js); `--no-osc` / `HIGHASCG_OSC_ENABLED=0`
  - On CasparCG connect: ensure OSC client is configured (AMCP connection auto-triggers OSC output to AMCP client IP) — *document / operator setup*
  - For persistent OSC: expose `GET /api/osc/config-hint` — **done** (T2.2)
  - Graceful shutdown: close UDP port — **done**

### Phase 2: WebSocket Broadcast & API

- [x] **T2.1** Broadcast OSC state via WebSocket
  - New WS message type: `{ type: 'osc', data: <oscState> }` — **done** (`index.js` subscribes to `oscState` `change`; throttling is `emitIntervalMs` in `OscState`)
  - Throttled at `emitIntervalMs` (default 50ms = 20 updates/sec)
  - Delta updates option: only send changed **channels** (full object per touched channel) — **opt-in** (`config.osc.wsDeltaBroadcast` or `HIGHASCG_OSC_WS_DELTA=1`); merge `data.channels` into prior state when `data.delta === true`; REST `getSnapshot()` stays full
  - Full state on initial connect — **done** via `getState()` → `osc` key on first `state` WS message

- [x] **T2.2** REST API endpoints for OSC data
  | Method | Path | Returns |
  |--------|------|---------|
  | GET | `/api/osc/state` | Full OSC state snapshot |
  | GET | `/api/osc/audio/:channel` | Audio levels for channel |
  | GET | `/api/osc/layer/:channel/:layer` | Layer state (file info, time, etc.) |
  | GET | `/api/osc/profiler` | All channel profiler data |
  | GET | `/api/osc/outputs` | All output port status |
  | GET | `/api/osc/config-hint` | CasparCG config XML for OSC setup |

- [x] **T2.3** Integrate with state manager *(partial — periodic INFO skip is T3.2)*
  - Expose OSC snapshot on main HTTP state — **done** (`get-state.js` prefers `StateManager.getState().osc`, fallback `oscState.getSnapshot()`)
  - Feed OSC data into `state-manager.js` — **done** [`updateFromOscSnapshot`](src/state/state-manager.js): mirrors full snapshot in `_state.osc`, `audio` map (mixer levels by channel id), per-channel `oscFormat`, `oscLayers`, `oscProfiler`, `oscOutputs`; [`index.js`](index.js) syncs on start + each OSC `change`; [`clearOscMirror`](src/state/state-manager.js) on shutdown
  - **Replace** periodic INFO polling where OSC provides the same data — **deferred** to **T3.2** (`periodic-sync.js`; reconcile still expects gathered XML today)
  - Keep AMCP polling as fallback when OSC is disabled/unavailable — unchanged

### Phase 3: Replace Polling with OSC

- [x] **T3.1** Refactor `playback-tracker.js`
  - **Current**: Manually tracks what was played via intercepting PLAY/STOP commands
  - **With OSC**: `file/time` and `file/frame` provide authoritative playback progress
  - Changes:
    - When OSC enabled (`ctx.oscState`): **`getMatrixForState`** uses **`buildMatrixFromOsc`** (layer `type` ≠ `empty`, clip from `file` / `template.path`) — **done**
    - `file/time` → `elapsedSec`, `remainingSec`, `progress`, `durationMs` (and `startedAt` estimate) — **done** (via `OscState` `file` aggregate)
    - `file/frame` → `progress` when time progress missing; optional duration estimate — **done**
    - `file/name` / `file/path` → clip id — **done** (`pickClipFromOscLayer`)
    - When layer `type` → `empty`: row omitted from matrix — **done**
    - Keep AMCP-based **`_playbackMatrix`** when OSC disabled — **done**
    - **`reconcilePlaybackMatrixFromGatheredXml`**: no-op when OSC active — **done**

- [x] **T3.2** Refactor `periodic-sync.js`
  - **Current**: Polls `INFO ch-layer` at intervals for layer status
  - **With OSC**: Layer data pushed in real-time
  - Changes:
    - When OSC enabled (`playback-tracker.isOscPlaybackActive`): **`runPeriodicSync`** skips per-channel **`INFO`**, live-scene / playback XML reconcile — **done**
    - **`runPeriodicOscLightSync`**: **`CLS`** + **`TLS`** (media/template lists), then **`INFO CONFIG`** (decklink / config-compare) — **done**
    - Interval: `periodic_sync_interval_sec` or **`HIGHASCG_PERIODIC_SYNC_SEC`**; when OSC active, floor **45s** unless **`periodic_sync_interval_sec_osc`** / **`HIGHASCG_PERIODIC_SYNC_OSC_SEC`** — **done**
    - **`startPeriodicSync`** enabled (was commented): runs on Caspar TCP connect; **`clearPeriodicSyncTimer`** on disconnect/shutdown — **done** ([`index.js`](index.js))
    - **`AmcpQuery.info(channel)`** overload — **done** (fixes `amcp.info(ch)` for periodic INFO path)

- [x] **T3.3** Enhance Companion bridge variables (WO-04 integration)
  - Companion variables fed from OSC data via HighAsCG API (`ctx.variables` / `GET /api/variables`) — **done** [`osc-variables.js`](src/osc/osc-variables.js)
    - `playback_ch{N}_lay{L}_time` → elapsed seconds (string)
    - `playback_ch{N}_lay{L}_remaining` → remaining seconds
    - `playback_ch{N}_lay{L}_progress` → 0–100 (string, one decimal)
    - `playback_ch{N}_lay{L}_clip` → file or template path
    - `audio_ch{N}_L_dBFS` / `audio_ch{N}_R_dBFS` → mixer (R falls back to L if mono)
    - `profiler_ch{N}_healthy` → `true` / `false` / ``
  - Updates on each OSC throttle emit (same cadence as WS `osc`) — **done** ([`index.js`](index.js) `pushOscToState`); **`clearOscVariables`** on OSC shutdown

### Phase 4: Web GUI Components (ties into WO-08)

- [x] **T4.1** Create `web/lib/osc-client.js` (≤150 lines)
  - Subscribe to OSC WebSocket messages — **done** (`osc` + optional `state` seed); full/delta merge
  - Parse and distribute data by channel/layer — **done** (`_run` fan-out)
  - Callbacks: `onAudioLevels(ch, callback)`, `onLayerState(ch, layer, callback)`, `onProfiler(ch, callback)` — **done**
  - Auto-reconnect on WS disconnect — **done** when no shared `wsClient` (standalone socket)
  - [`ws-client.js`](web/lib/ws-client.js) exports **`getWsUrl`**; [`app.js`](web/app.js) **`getOscClient()`** after bootstrap

- [x] **T4.2** Create `web/components/playback-timer.js` (≤200 lines)
  - Inline countdown/elapsed timer from OSC `file/time` data — **done** (`layer.file` elapsed/duration/remaining/progress/fps)
  - Displays: elapsed / total / remaining — **done**
  - Format: `HH:MM:SS:FF` or `MM:SS` — **done** (`format` + `formatHmsf` / `formatMmSs` exports)
  - Progress bar (thin horizontal bar) — **done**
  - Color changes as remaining time decreases — **done** (green >30s, yellow 10–30s, red under 10s + optional flash)
  - Used in: rundown item, layer status, header bar, dashboard cells — **export** [`mountPlaybackTimer`](web/components/playback-timer.js) (wire in WO-08 / UI as needed)

- [x] **T4.3** Create `web/components/now-playing.js` (≤150 lines)
  - "Now Playing" display from OSC file metadata — **done** [`mountNowPlaying`](web/components/now-playing.js)
  - Shows: file name, elapsed/remaining, codec, resolution — **done** (`file` + `video` / `audio`)
  - Thumbnail from THUMBNAIL RETRIEVE — **done** (`GET /api/thumbnail/…` via `getApiBase()`)
  - Loop indicator — **done** (`file.loop` → `⟲ loop`)
  - Per-channel or per-layer — **done** (`channel` + `layer` + `oscClient`)

- [x] **T4.4** Create `web/components/profiler-display.js` (≤100 lines)
  - Channel performance monitor from OSC profiler data — **done** [`mountProfilerDisplay`](web/components/profiler-display.js)
  - Shows: frame time actual vs expected — **done** (`${actual} / ${expected} ms` when not compact)
  - Health indicator: green dot (OK), yellow (marginal), red (dropping frames) — **done** (`profilerTier`: ratio ≤1.02 green, ≤1.05 yellow, else red)
  - Compact mode for header bar — **done** (`compact: true` → dot only, values in `title`)
  - Used in: channel status, settings, debug panel — **export** for wiring

- [x] **T4.5** Create `web/components/output-status.js` (≤100 lines)
  - Output consumer status from OSC output data — **done** [`mountOutputStatus`](web/components/output-status.js)
  - Shows: consumer type, frame count — **done** (`formatOutputLine`)
  - For file consumers: frames written — **done** (`frames` / `maxFrames` when file/ffmpeg-like)
  - For stream consumers: connection status — **done** (`… · live` or frame count when present)
  - Used in: channel status — **export**; polls merged `oscClient.channels` (default **200ms**, `pollMs` override)

### Phase 5: CasparCG Configuration

- [x] **T5.1** Update config generator for OSC
  - Add `<osc>` block to generated CasparCG config:
    ```xml
    <osc>
      <default-port>6250</default-port>
      <disable-send-to-amcp-clients>false</disable-send-to-amcp-clients>
      <predefined-clients>
        <predefined-client>
          <address>HIGHASCG_IP</address>
          <port>6250</port>
        </predefined-client>
      </predefined-clients>
    </osc>
    ```
  - `disable-send-to-amcp-clients: false` ensures OSC is sent to AMCP clients by default
  - Predefined client: for persistent OSC even without AMCP connection
  - Auto-resolve HighAsCG IP for cross-machine setups

- [x] **T5.2** Settings modal integration
  - OSC settings in **Audio** or **Advanced** tab (WO-05):
    - Enable/disable OSC
    - OSC listen port
    - Peak hold duration
    - Display: show VU meters in footer bar (toggle)
    - Display: show playback timer in rundown (toggle)

### Phase 6: Documentation

- [x] **T6.1** Create `docs/osc-integration.md`
  - Complete OSC message reference (from this document)
  - CasparCG config setup instructions
  - Troubleshooting: common issues (firewall, port conflicts)
  - Architecture: OSC ↔ state manager ↔ WebSocket ↔ browser

- [x] **T6.2** Create `docs/polling-vs-osc.md`
  - Document which data sources were replaced by OSC
  - Performance comparison: polling frequency vs OSC push rate
  - Fallback behavior when OSC is unavailable

---

## Architecture

```
CasparCG Server
│
├── AMCP (TCP :5250)                    ← Commands (WO-07)
│   └── Responses (sync, request/reply)
│
└── OSC (UDP → HighAsCG :6250)          ← Real-time state (THIS WO)
    ├── /channel/N/mixer/audio/M/dBFS   ← 25-60 msg/sec per ch
    ├── /channel/N/stage/layer/L/...    ← Per active layer
    ├── /channel/N/profiler/time        ← Per frame
    └── /channel/N/output/port/P/...    ← Per consumer

         │
         ▼
    HighAsCG Node.js
    ┌──────────────────────────────────┐
    │  src/osc/osc-listener.js         │ ← UDP receive + parse
    │       │                          │
    │       ▼                          │
    │  src/osc/osc-state.js            │ ← Aggregate, peak hold, compute
    │       │                          │
    │       ├──► state-manager.js      │ ← Feed into app state
    │       │    (replace polling)     │
    │       │                          │
    │       ├──► WebSocket broadcast   │ ← { type: 'osc', data: ... }
    │       │    @ 20Hz (50ms)         │    @ 20Hz
    │       │                          │
    │       └──► REST API              │ ← GET /api/osc/*
    └──────────────────────────────────┘
         │ WebSocket
         ▼
    Browser
    ┌──────────────────────────────────┐
    │  osc-client.js                   │ ← Subscribe to WS
    │       │                          │
    │       ├──► vu-meter.js           │ ← Audio levels (WO-08)
    │       ├──► playback-timer.js     │ ← Elapsed / remaining
    │       ├──► now-playing.js        │ ← File metadata
    │       ├──► profiler-display.js   │ ← Channel health
    │       ├──► layer-status.js       │ ← Active layer info
    │       └──► output-status.js      │ ← Consumer health
    └──────────────────────────────────┘
```

### Data Flow: Playback Timer Example

```
1. Operator plays clip: PLAY 1-10 NEWS_OPENER MIX 25
                                │
2. CasparCG starts playing      │
   └── OSC push every frame:    ▼
       /channel/1/stage/layer/10/file/time  12.0  400.0
       /channel/1/stage/layer/10/file/name  NEWS/OPENER
       /channel/1/stage/layer/10/type       ffmpeg

3. osc-listener.js receives UDP datagram
   └── osc-state.js updates:
       channels[1].layers[10].file.elapsed  = 12.0
       channels[1].layers[10].file.duration = 400.0
       channels[1].layers[10].file.remaining = 388.0  (computed)
       channels[1].layers[10].file.progress  = 0.03   (computed)
       channels[1].layers[10].file.name     = 'NEWS/OPENER'

4. WebSocket broadcast @ 20Hz:
   { type: 'osc', data: { channels: { 1: { layers: { 10: { ... } } } } } }

5. Browser playback-timer.js renders:
   ┌─────────────────────────────┐
   │  NEWS/OPENER                │
   │  00:12 / 06:40  ▓▓░░░░░░░  │
   │  Remaining: 06:28           │
   └─────────────────────────────┘
```

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-04 — Agent (T6.1 / T6.2 documentation)
**Work Done:**
- [`docs/osc-integration.md`](docs/osc-integration.md): architecture, OSC message tables, Caspar config + firewall + `config-hint`, HighAsCG env/settings, REST `/api/osc/*`, WebSocket notes, troubleshooting, source pointers.
- [`docs/polling-vs-osc.md`](docs/polling-vs-osc.md): replacement table, performance comparison, periodic-sync vs OSC, fallback paths, when to use AMCP.

**Status:**
- **T6.1** and **T6.2** complete.

**Instructions for Next Agent:**
- WO-09 Phase 6 complete; continue from [`00_PROJECT_GOAL.md`](00_PROJECT_GOAL.md) (other WOs / Companion / WO-08 UI).

### 2026-04-04 — Agent (T4.5 output-status.js)
**Work Done:**
- [`web/components/output-status.js`](web/components/output-status.js): `formatOutputLine`, `mountOutputStatus(container, { channel, oscClient, portId, compact, pollMs })`.

**Instructions for Next Agent:**
- **Phase 5** config generator OSC block, or wire T4.x into header/dashboard (WO-08).

### 2026-04-04 — Agent (T4.4 profiler-display.js)
**Work Done:**
- [`web/components/profiler-display.js`](web/components/profiler-display.js): `profilerTier`, `mountProfilerDisplay(container, { channel, oscClient, compact })`, `onProfiler` + `refresh`.

**Instructions for Next Agent:**
- **T4.5** `output-status.js`.

### 2026-04-04 — Agent (T4.3 now-playing.js)
**Work Done:**
- [`web/components/now-playing.js`](web/components/now-playing.js): `mountNowPlaying(container, { channel, layer, oscClient, showThumbnail })`; title from `file` / `template.path`; times via `formatMmSs`; tech line codec + `video` resolution; thumbnail `img` with `onerror` clear.

**Instructions for Next Agent:**
- **T4.4** `profiler-display.js`.

### 2026-04-04 — Agent (T4.2 playback-timer.js)
**Work Done:**
- [`web/components/playback-timer.js`](web/components/playback-timer.js): `mountPlaybackTimer(container, { channel, layer, oscClient, format, fpsFallback, flashWhenCritical })`, `formatMmSs`, `formatHmsf`; tier colors + progress bar; `destroy` / `refresh`.

**Instructions for Next Agent:**
- **T4.3** `now-playing.js` or mount timer in dashboard/header when product owner picks placement.

### 2026-04-04 — Agent (T4.1 osc-client.js)
**Work Done:**
- [`web/lib/osc-client.js`](web/lib/osc-client.js): `OscClient`, merge full/delta, callbacks, standalone WS reconnect.
- [`web/lib/ws-client.js`](web/lib/ws-client.js): export `getWsUrl`.
- [`web/app.js`](web/app.js): `new OscClient({ wsClient })`, `getOscClient()`.

**Instructions for Next Agent:**
- **T4.2** `playback-timer.js` — use `getOscClient().onLayerState(ch, layer, …)`.

### 2026-04-04 — Agent (T3.3 OSC variables)
**Work Done:**
- [`osc-variables.js`](src/osc/osc-variables.js): `applyOscSnapshotToVariables`, `clearOscVariables`; keys `playback_ch*_lay*_`, `audio_ch*_L_dBFS` / `_R_dBFS`, `profiler_ch*_healthy`.
- [`index.js`](index.js): run after `updateFromOscSnapshot` on each OSC `change`; clear on shutdown.

**Instructions for Next Agent:**
- **Phase 4** web OSC client / UI components, or Companion module consumption of `/api/variables`.

### 2026-04-04 — Agent (T3.2 periodic-sync OSC)
**Work Done:**
- [`periodic-sync.js`](src/utils/periodic-sync.js): OSC vs full INFO paths; `runMediaClsTlsRefresh` (CLS+TLS), `runPeriodicInfoConfigRefresh`; `resolveIntervalSec`; `startPeriodicSync` live.
- [`index.js`](index.js): `startPeriodicSync` / `clearPeriodicSyncTimer`, env `HIGHASCG_PERIODIC_SYNC_SEC`, `HIGHASCG_PERIODIC_SYNC_OSC_SEC`, `config.periodic_sync_*`.
- [`amcp-query.js`](src/caspar/amcp-query.js): `info(channel, layer)` → `infoChannel` when channel set.

**Instructions for Next Agent:**
- **T3.3** Companion variables from OSC / API.

### 2026-04-04 — Agent (T3.1 playback-tracker OSC)
**Work Done:**
- [`playback-tracker.js`](src/state/playback-tracker.js): `isOscPlaybackActive`, `buildMatrixFromOsc`, `pickClipFromOscLayer`; `getMatrixForState` returns OSC-derived matrix when `ctx.oscState` is set; `reconcilePlaybackMatrixFromGatheredXml` skips when OSC drives matrix.

**Instructions for Next Agent:**
- **T3.2** `periodic-sync.js`: optional INFO skip + longer CLS interval when OSC on.

### 2026-04-04 — Agent (T2.3 state manager)
**Work Done:**
- [`StateManager`](src/state/state-manager.js): `_state.osc`, `_state.audio`, `updateFromOscSnapshot`, `clearOscMirror`, `getState()` includes `osc` + `audio`; merges `oscFormat` / `oscLayers` / `oscProfiler` / `oscOutputs` onto channel entries.
- [`index.js`](index.js): initial + each `oscState` `change` → `updateFromOscSnapshot(getSnapshot())`; shutdown `clearOscMirror` before `oscState.destroy()`.
- [`get-state.js`](src/api/get-state.js): `osc` from state manager when present (`base.osc !== undefined`).

**Instructions for Next Agent:**
- **T3.2**: optional `INFO` skip when OSC + live-scene / playback reconcile from OSC paths.

### 2026-04-04 — Agent (T2.1 delta)
**Work Done:**
- **`OscState`:** `wsDeltaBroadcast` from [`osc-config.js`](src/osc/osc-config.js) (`HIGHASCG_OSC_WS_DELTA` / `config.osc.wsDeltaBroadcast`). Dirty channel set; throttled `change` emits `{ delta: true, updatedAt, channels }` (string keys) or skips if empty; default remains full `getSnapshot()`-shaped payload. `clear()` still emits full snapshot.
- **README:** `HIGHASCG_OSC_WS_DELTA` row.

**Instructions for Next Agent:**
- UI clients handling WS `osc`: when `data.delta`, deep-merge `data.channels` into cached OSC state by channel id.

### 2026-04-04 — Agent (Phase 2)
**Work Done:**
- **T2.1 / T2.2 / T2.3 (partial):** [`src/api/routes-osc.js`](src/api/routes-osc.js) — `GET /api/osc/state`, `audio/:ch`, `layer/:ch/:layer`, `profiler`, `outputs`, `config-hint` (XML). [`src/api/router.js`](src/api/router.js) dispatches `/api/osc/*` **before** the `!ctx.amcp` 503 gate. [`index.js`](index.js): `oscState.on('change', …)` → `_wsBroadcast('osc', snapshot)`. [`src/api/get-state.js`](src/api/get-state.js): `osc` snapshot on main state. **T2.3** deep `state-manager` merge not done (still Phase 3+).

**Status:**
- **T2.1** and **T2.2** complete. **T2.3** partial (snapshot only). **T1.5** `config-hint` done.

**Instructions for Next Agent:**
- **T2.3** remainder: feed OSC into `state-manager` / replace INFO polling where appropriate. **Phase 3** playback-tracker OSC. Optional: synthetic UDP test script.

### 2026-04-04 — Agent
**Work Done:**
- **Phase 1 (T1.1–T1.4, T1.5 partial):** `npm install osc`. Added [`src/osc/osc-config.js`](src/osc/osc-config.js) (`normalizeOscConfig`, env `HIGHASCG_OSC_ENABLED`, `OSC_LISTEN_PORT`, `OSC_BIND_ADDRESS`), [`src/osc/osc-state.js`](src/osc/osc-state.js) (aggregate channel / mixer / layer / output / file metadata, throttled `change` events), [`src/osc/osc-listener.js`](src/osc/osc-listener.js) (`osc.UDPPort`, `message` + `bundle`). [`config/default.js`](config/default.js) `osc` block. [`index.js`](index.js): `--no-osc`, `appCtx.oscState`, `appCtx.log('info')` → `logger.info`, shutdown closes UDP + `oscState.destroy()`. [`scripts/verify-w02-structure.js`](scripts/verify-w02-structure.js) includes `src/osc/*`. [`README.md`](README.md) OSC env section.

**Status:**
- **T1.1**–**T1.4** complete. **T1.5** complete except settings UI (WO-05); `config-hint` added in Phase 2 entry above.

**Instructions for Next Agent:**
- See Phase 2 entry above.

### 2026-04-04 — Agent (T5.2 settings modal + OSC UI)
**Work Done:**
- [`config/default.js`](config/default.js): `ui.oscFooterVu`, `ui.rundownPlaybackTimer`; merged in `buildConfig`.
- [`src/api/routes-settings.js`](src/api/routes-settings.js): GET returns full `osc` (`listenPort`, `peakHoldMs`, …) + `ui`; POST merges `osc` (re-`normalizeOscConfig`), `ui`, persists `osc`/`ui`; `restartOscSubsystem()` when `settings.osc` present.
- [`index.js`](index.js): `stopOscSubsystem` / `startOscSubsystem`, `appCtx.restartOscSubsystem`.
- [`src/api/get-state.js`](src/api/get-state.js): `ui` on snapshot.
- Web: [`settings-modal.js`](web/components/settings-modal.js) — **Audio / OSC** tab; [`settings-state.js`](web/lib/settings-state.js); [`osc-footer-strip.js`](web/components/osc-footer-strip.js); [`app.js`](web/app.js) — WS before scenes + footer init; [`scenes-editor.js`](web/components/scenes-editor.js) — rundown `mountPlaybackTimer`; [`index.html`](web/index.html) + [`styles.css`](web/styles.css). Save fires `highascg-settings-applied` (no full page reload).

**Status:**
- **T5.2** complete.

**Instructions for Next Agent:**
- **Phase 6** docs (`osc-integration.md`, `polling-vs-osc.md`) or wire footer/timer placement tweaks.

### 2026-04-04 — Agent (T5.1 config generator OSC)
**Work Done:**
- [`src/config/config-generator.js`](src/config/config-generator.js): `buildOscConfigurationXml(config)` — full `<osc>` with `<default-port>`, `<disable-send-to-amcp-clients>` (default `false`), `<predefined-clients>` / `<predefined-client>` (address + port). Emitted when `osc_port > 0` (same gate as legacy `<osc><port>`). Optional overrides: `caspar_osc_default_port`, `osc_target_host` / `highascg_host`, `osc_target_port`, `osc_disable_send_to_amcp`. Exported for reuse.

**Status:**
- **T5.1** complete.

**Instructions for Next Agent:**
- Superseded by T5.2 entry above; next is **Phase 6** (`T6.1` / `T6.2`).

### YYYY-MM-DD — Agent Name
**Work Done:**
- (describe what was completed)

**Status:**
- (which tasks were completed)

**Instructions for Next Agent:**
- (what needs to happen next, any blockers or decisions needed)

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
*Reference: .reference/casparcg-wiki/Protocols/OSC-Protocol.md*
*Reference: .reference/casparcg-wiki/FFmpeg-Producer.md (OSC Data section)*
*Reference: .reference/casparcg-client-wiki/OSC.md (client control OSC — for ref only)*
