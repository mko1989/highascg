# Work Order 08: CasparCG Client Features — OSC status, VU meters, layer/channel status

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Bring over the **operator-facing monitoring** pieces that matter from the official CasparCG Client: **real-time OSC state** (audio levels, layer/stage info, profiler, outputs), **VU meters**, and **layer/channel status** in the web UI. Deeper library/rundown workflows stay in **Looks / Timelines / Sources** (not a Qt-client clone).

**Reference:** official client under `.reference/casparcg-client/`; OSC spec under `.reference/casparcg-wiki/Protocols/OSC-Protocol.md`.

## Reference Material

```
/Users/marcin/companion-module-dev/HighAsCG/.reference/casparcg-client/
├── src/
│   ├── Core/
│   │   ├── Commands/        ← 43 command types (Movie, Still, Template, Mixer, etc.)
│   │   ├── Events/          ← Action, Inspector, Library, Rundown events
│   │   ├── Models/          ← Data models (Library, Rundown, Device, Tween, etc.)
│   │   ├── OscSubscription  ← OSC path subscription system
│   │   ├── OscDeviceManager ← UDP OSC listener management
│   │   └── LibraryManager   ← Media/template library
│   ├── Osc/                 ← OSC UDP listener + WebSocket bridge
│   ├── Widgets/
│   │   ├── Library/         ← Media browser (Video, Audio, Image, Template, Data trees)
│   │   ├── Rundown/         ← 40+ rundown item widgets (one per command type)
│   │   ├── Inspector/       ← Property inspector for selected rundown items
│   │   ├── LiveWidget       ← Live preview (VLC-based stream player)
│   │   ├── PreviewWidget    ← Thumbnail preview
│   │   └── MainWindow       ← 3-panel layout: Library | Rundown | Inspector
│   └── Web/                 ← Embedded web interface
└── ...
```

### CasparCG OSC Audio Data

From `.reference/casparcg-wiki/Protocols/OSC-Protocol.md`:

| OSC Address | Args | Description |
|-------------|------|-------------|
| `/channel/[N]/mixer/audio/nb_channels` | `int` | Number of audio channels on this CasparCG channel |
| `/channel/[N]/mixer/audio/[M]/dBFS` | `float` | Audio level in dBFS for audio channel M |
| `/channel/[N]/stage/layer/[L]/time` | `float` | Seconds the layer has been active |
| `/channel/[N]/stage/layer/[L]/frame` | `int` | Frame count on layer |
| `/channel/[N]/stage/layer/[L]/type` | `string` | Producer type (e.g., "transition") |
| `/channel/[N]/stage/layer/[L]/paused` | `bool` | Layer pause state |
| `/channel/[N]/profiler/time` | `float float` | Actual vs expected frame render time |
| `/channel/[N]/output/port/[P]/type` | `string` | Consumer type (screen, decklink, etc.) |
| `/channel/[N]/output/port/[P]/frame` | `int int` | Written / max frames |

---

## Tasks

### Phase 1: OSC Listener (Node.js server)

- [x] **T1.1** Create `src/osc/osc-listener.js` (≤250 lines)
  - `npm install osc` (Colin Clark's osc.js library for Node.js UDP)
  - Listen on configurable UDP port (default `6250`, matches CasparCG default OSC port)
  - Parse all incoming OSC messages
  - Emit typed events: `audio-level`, `layer-state`, `profiler`, `output-state`
  - Handle multiple CasparCG channels/layers
  - Graceful startup/shutdown

- [x] **T1.2** Create `src/osc/osc-state.js` (≤200 lines)
  - Aggregate OSC data into in-memory state:
    ```javascript
    {
      channels: {
        1: {
          format: 'PAL',
          profiler: { actual: 0.039, expected: 0.04 },
          audio: {
            nbChannels: 2,
            levels: [
              { channel: 0, dBFS: -18.5, peak: -12.0, peakHoldTime: 0 },
              { channel: 1, dBFS: -20.1, peak: -14.2, peakHoldTime: 0 }
            ]
          },
          layers: {
            1: { type: 'ffmpeg', time: 45.2, frame: 1130, paused: false },
            10: { type: 'transition', time: 2.1, frame: 52, paused: false },
            // ...
          },
          outputs: {
            0: { type: 'decklink', frames: 24500 },
            1: { type: 'screen', frames: 24500 }
          }
        },
        // channel 2, 3, ...
      }
    }
    ```
  - Peak hold calculation: track peak level per audio channel, decay over time
  - Configurable peak hold duration (default 2 seconds)
  - Emit changes via EventEmitter for WebSocket broadcast

- [x] **T1.3** Create `src/osc/osc-config.js` (≤80 lines)
  - Settings:
    - `osc.enabled` (boolean, default: `true`)
    - `osc.listenPort` (number, default: `6250`)
    - `osc.listenAddress` (string, default: `0.0.0.0`)
    - `osc.peakHoldMs` (number, default: `2000`)
    - `osc.meterUpdateRateMs` (number, default: `50` — 20 updates/sec)
  - CasparCG config requirement: add predefined OSC client pointing to HighAsCG

- [x] **T1.4** Wire OSC into main app
  - Start OSC listener after app init
  - Broadcast OSC state via WebSocket at throttled rate (50ms interval)
  - WS message type: `{ type: 'osc', data: { channels: {...} } }`
  - Add `GET /api/osc/state` endpoint for polling fallback
  - Add toggle in Settings (WO-05) under Audio tab

### Phase 2: VU Meters (Web GUI)

- [x] **T2.1** Create `web/components/vu-meter.js` (≤300 lines)
  - Canvas-based vertical VU meter bars
  - Per audio channel (L, R, or multi-channel: 1-16)
  - Visual elements:
    - **Bar**: Gradient fill (green → yellow → red) based on dBFS level
    - **Peak hold**: Horizontal line at peak value, decays after hold time
    - **Scale**: dBFS markings (-60, -48, -36, -24, -18, -12, -6, -3, 0, +3, +6)
    - **Clip indicator**: Red dot/square at top when dBFS >= 0
    - **Channel label**: L, R, or channel number below bar
  - dBFS to pixel mapping:
    ```javascript
    // Non-linear: more resolution at the top (louder levels)
    function dBFSToPixel(dBFS, height) {
      const min = -60  // bottom of meter
      const max = 6    // top of meter
      const normalized = Math.max(0, Math.min(1, (dBFS - min) / (max - min)))
      return height * (1 - normalized)
    }
    ```
  - Smooth animation: CSS transitions or requestAnimationFrame interpolation
  - Configurable: height, width, orientation (vertical default)
  - Export: `createVuMeter(container, opts)` → `{ update(levels), destroy() }`

- [x] **T2.2** Create `web/components/vu-meter-strip.js` (≤200 lines)
  - Group of VU meters for one CasparCG channel
  - Layout: horizontal row of vertical bars (stereo = 2 bars, 8ch = 8 bars)
  - Channel header: "Ch 1: 1080p5000"
  - Collapse/expand per channel
  - Resize support
  - Used in: footer bar, live panel, or dedicated audio panel

- [x] **T2.3** Integrate VU meters into UI
  - **Footer bar**: Compact VU meters for PGM channel (always visible)
  - **Audio panel** (optional tab): Full multi-channel meters for all channels
  - **Header bar**: Mini meter indicator next to audio source selector (WO-05)
  - All meters update in real-time via WebSocket OSC data

- [x] **T2.4** Create `web/lib/osc-client.js` (≤100 lines)
  - Subscribe to OSC WebSocket messages
  - Parse and distribute audio levels to VU meter components
  - Buffer/throttle updates to match display refresh rate
  - Expose: `onAudioLevels(channelId, callback)`, `onLayerState(channelId, layerId, callback)`

### Phase 3–4: Media library & rundown — **removed from scope**

Not planned under WO-08. Media/templates/fonts/data are covered by **Sources**, periodic sync, and AMCP queries (WO-07). Playout authoring is **Looks / Timelines**, not a Qt-style rundown.

### Phase 5: Layer Status Display

- [x] **T5.1** Create `web/components/layer-status.js` (≤200 lines)
  - Real-time layer status from OSC data
  - Per channel: show active layers with:
    - Layer number
    - Producer type (ffmpeg, template, route, etc.)
    - Clip/source name (from state manager)
    - Playback time / duration
    - Frame counter
    - Pause state indicator
  - Update at 20fps from OSC WebSocket data
  - Place in: header bar (compact), or dedicated status panel

- [x] **T5.2** Create `web/components/channel-status.js` (≤150 lines)
  - Per channel overview:
    - Video format
    - Frame render time (from OSC profiler)
    - Active outputs (from OSC output/port data)
    - Performance health indicator (green if actual ≤ expected frame time)
  - Used in: settings, server info panel

### Phase 6: CasparCG Config for OSC

- [x] **T6.1** Update config generator (from WO-02) for OSC
  - Add `<osc>` block to generated CasparCG config:
    ```xml
    <osc>
      <default-port>6250</default-port>
      <predefined-clients>
        <predefined-client>
          <address>HIGHASCG_IP</address>
          <port>6250</port>
        </predefined-client>
      </predefined-clients>
    </osc>
    ```
  - Auto-detect HighAsCG server IP for predefined client address
  - Add AMCP command to ensure CasparCG sends OSC to HighAsCG on connect

- [x] **T6.2** OSC setup guide
  - Document how to enable OSC output from CasparCG
  - Explain: AMCP connection triggers automatic OSC client → HighAsCG IP
  - Predefined clients for headless/persistent OSC
  - Firewall: UDP port must be open

---

## CasparCG Client Feature Mapping

| Official Client Feature | HighAsCG Implementation | Work Order |
|------------------------|------------------------|------------|
| **Library browser** | Sources panel + CLS/TLS sync (not a separate media-browser WO) | WO-02 / WO-07 |
| **Rundown** | Looks / Timelines (not implemented) | — |
| **Inspector** | Layer / mixer inspectors in web UI | WO-22, WO-08 T5 |
| **Live preview (VLC)** | go2rtc WebRTC stream (WO-05) | WO-05 |
| **Thumbnail preview** | Existing `preview-canvas.js` + live video | WO-05 |
| **Audio VU meters** | `vu-meter.js` — Canvas VU bars from OSC dBFS | **WO-08 T2** |
| **OSC monitoring** | `osc-listener.js` — UDP listener + WS broadcast | WO-08 T1 / WO-09 |
| **Template data editor** | Template / CG flows in scenes & AMCP | WO-07 |
| **Multi-server control** | HighAsCG connects to one CasparCG; Companion bridges others | WO-04 |
| **Groups** | Look/scene grouping in project model | WO-02 |
| **GPI** | Not planned (hardware-specific) | — |
| **File recorder** | Via AMCP `ADD FILE` consumer | WO-07 |
| **Scene editor** | Existing scenes editor (companion module migration) | WO-02 |
| **Timeline** | Existing timeline editor (companion module migration) | WO-02 |
| **Multiview** | Existing multiview editor (companion module migration) | WO-02 |
| **Dashboard** | Existing dashboard (companion module migration) | WO-02 |
| **Settings** | Settings modal (WO-05) | WO-05 |

---

## VU Meter Visual Specification

```
        Ch 1 (PGM)           Ch 2 (PRV)
    ┌──────────────┐     ┌──────────────┐
 +6 │  ██  ██      │  +6 │              │
 +3 │  ██  ██      │  +3 │              │
  0 │──██──██──────│   0 │──────────────│
 -3 │  ██  ██      │  -3 │              │
 -6 │  ██  ██      │  -6 │  ██  ██      │
-12 │  ██  ██      │ -12 │  ██  ██      │
-18 │  ██  ██      │ -18 │  ██  ██      │
-24 │  ██  ██      │ -24 │  ██  ██      │
-36 │  ██  ██      │ -36 │  ██  ██      │
-48 │  ██  █       │ -48 │  ██  ██      │
-60 │  █           │ -60 │  ██  █       │
    └──────────────┘     └──────────────┘
       L    R               L    R

    ┌─Red zone──── +3 to +6 dB (clip!)
    │─Yellow zone── -6 to +3 dB
    │─Green zone── -60 to -6 dB
    └─Peak hold── thin line at peak, decays after 2s

    Colors:
    - Green:  hsl(120, 80%, 45%)  →  dBFS < -6
    - Yellow: hsl(50, 90%, 50%)   →  -6 ≤ dBFS < +3
    - Red:    hsl(0, 85%, 50%)    →  dBFS ≥ +3
```

### Footer Bar Integration

```
┌──────────────────────────────────────────────────────────────────────────┐
│  HighAsCG  │  Project  │  Save  │  Load  │  Server  │  ⚙  │ 🔊PGM ▾ │
│            │           │        │        │          │     │          │
│         ── status ──   │ ── VU ─────── │  ── WS ── │     │          │
│                        │  █ █  █ █     │  ● conn   │     │          │
│                        │  L R  L R     │           │     │          │
│                        │  Ch1  Ch2     │           │     │          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Notes

### OSC → WebSocket Pipeline

```
CasparCG Server          HighAsCG Node.js               Browser
     │                         │                           │
     ├── OSC UDP ──────────────►│                           │
     │  /ch/1/mixer/audio/0/dBFS  osc-listener.js         │
     │  /ch/1/mixer/audio/1/dBFS  │                        │
     │  (50+ msgs/sec per ch)     │                        │
     │                         ├── osc-state.js            │
     │                         │   aggregate + peak hold   │
     │                         │                           │
     │                         ├── WS broadcast ───────────►│
     │                         │   { type: 'osc',          │  osc-client.js
     │                         │     data: { channels } }  │  ├── vu-meter.js
     │                         │   @ 20Hz (50ms)           │  ├── layer-status.js
     │                         │                           │  └── channel-status.js
```

### npm Dependencies

```json
{
  "osc": "^2.4.4"   // Colin Clark's osc.js — UDP/WebSocket OSC protocol
}
```

No additional npm packages needed — `osc` handles both UDP receive and message parsing. The Web Audio API or canvas is used for VU rendering (no extra lib).

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-22 — Agent
**Work Done:**
- **Scope:** WO-08 closed to the features actually wanted from the CasparCG Client: **OSC-driven status**, **VU meters**, **layer/channel status**, and **Caspar OSC config** (Phases 1, 2, 5, 6). **Phase 3 (media browser)** and **Phase 4 (rundown)** task lists **removed** — Looks / Timelines / Sources replace those workflows.
- Updated **goal**, **feature mapping** table, and task section accordingly.

**Instructions for Next Agent:**
- WO-08 is complete for its revised scope; follow **WO-07 / WO-09** for AMCP and OSC protocol depth.

### 2026-04-04 — Agent (VU Meter Modularization & Rundown Cleanup)
**Work Done:**
- **WO-08 T2.1/T2.2/T2.3**: Modularized VU meter logic. Extracted from footer into `vu-meter.js`. 
- Integrated live VU monitoring into the **Mixer Inspector**. Users can now see real-time audio levels while adjusting layer volume, supporting the **Looks** workflow.
- Refactored `osc-footer-strip.js` to use the new component.
- Cleaned up all accidental "Rundown" logic from `index.js`, `router.js`, and the filesystem.

**Status:**
- **Phase 1, 2, 5, 6** complete.
- **Phase 3–4** removed from WO-08 scope (2026-04-22).

**Instructions for Next Agent:**
- Superseded by 2026-04-22 log entry.

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
*Reference: .reference/casparcg-client/ (official CasparCG Client Qt/C++ source)*
*Reference: .reference/casparcg-wiki/Protocols/OSC-Protocol.md (OSC data spec)*
