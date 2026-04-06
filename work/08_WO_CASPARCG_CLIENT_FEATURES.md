# Work Order 08: CasparCG Client Features — VU Meters, Rundown, Media Browser

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Implement the core features of the **official CasparCG Client** application in the HighAsCG web GUI. The official client (Qt/C++, cloned to `.reference/casparcg-client/`) provides a proven production-ready workflow that HighAsCG should replicate and extend in the browser.

**Priority feature: Real-time VU meters** using CasparCG's built-in OSC protocol for live audio level visualization.

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

### Phase 3: Media Library Browser

- [ ] **T3.1** Create `web/components/media-browser.js` (≤400 lines)
  - Sidebar/panel component showing CasparCG server media
  - Tabs or filter for asset types:
    - **📹 Video** — `.mov`, `.mp4`, `.avi`, `.mkv`, etc. (from `CLS`)
    - **🖼 Images** — `.png`, `.jpg`, `.tga`, `.tiff`, etc. (from `CLS`, type STILL)
    - **🔊 Audio** — `.wav`, `.mp3`, `.ogg`, etc. (from `CLS`, type AUDIO)
    - **📄 Templates** — `.html`, `.ft` (from `TLS`)
    - **💾 Data** — Stored datasets (from `DATA LIST`)
    - **🔤 Fonts** — Server fonts (from `FLS`, WO-07 T1.5)
  - File list with:
    - Name (relative path)
    - Type icon
    - File size
    - Thumbnail (from `THUMBNAIL RETRIEVE`, shown on hover or in list)
    - Duration (for video — from frame count / frame rate)
  - Tree view for directories (folder structure)
  - Search/filter input
  - Drag-and-drop support: drag media item to rundown or play directly
  - Right-click context menu: Play, Load, LoadBG, Info, Generate Thumbnail
  - Refresh button (triggers `CLS` / `TLS` / `DATA LIST` re-query)

- [ ] **T3.2** Create `web/components/media-thumbnail.js` (≤150 lines)
  - Fetch and display CasparCG thumbnails
  - Source: `GET /api/thumbnails/:filename` → base64 PNG → `<img>`
  - Lazy loading: only fetch visible thumbnails
  - Cache in memory (WeakMap/Map with size limit)
  - Placeholder for missing thumbnails
  - Grid view option: thumbnails as cards with file name

- [ ] **T3.3** Wire media browser to existing state
  - Use `stateStore.media` for CLS data (already queried by periodic sync)
  - Use `stateStore.templates` for TLS data
  - Add `stateStore.data` for DATA LIST results
  - Add `stateStore.fonts` for FLS results (WO-07)
  - Real-time updates when media changes (periodic refresh or manual)

### Phase 4: Rundown System (DELETED/SKIPPED)

> [!CAUTION]
> The Rundown system was explicitly rejected by the user in favor of the **Looks and Timelines** workflow. These tasks are preserved for reference but will not be implemented.

The original CasparCG client's core feature is the **rundown** — a sequential list of playout items that operators can play, load, and step through.

- [ ] **T4.1** Create `src/rundown/rundown-model.js` (≤300 lines)
  - Server-side rundown data model:
    ```javascript
    {
      id: 'uuid',
      name: 'Show Rundown',
      items: [
        {
          id: 'uuid',
          type: 'movie',       // movie | still | template | audio | route | custom | ...
          name: 'Opening VT',
          channel: 1,
          layer: 10,
          clip: 'OPENING_VT',
          transition: { type: 'MIX', duration: 25, tween: 'linear' },
          loop: false,
          autoPlay: false,     // auto-advance to next
          freezeOnLoad: true,  // LOAD (pause on first frame) vs LOADBG
          duration: null,      // null = play to end, number = frame count
          notes: 'Roll after host intro',
          color: '#e63946',    // color label
          group: null,         // group parent ID
          children: [],        // for group items
          // Type-specific props:
          templateData: null,  // for template type
          mixerProps: null,    // for mixer commands (fill, opacity, etc.)
          active: false,       // currently playing
          loaded: false,       // currently loaded (BG)
        },
        // ...
      ]
    }
    ```
  - CRUD operations: add, remove, reorder, duplicate, group/ungroup
  - Persistence: save/load to file (JSON)
  - Import/export: compatible format with project system (WO-02)

- [ ] **T4.2** Create `src/rundown/rundown-executor.js` (≤300 lines)
  - Execute rundown items via AMCP:
    - `movie` → `PLAY ch-layer CLIP [transition]` or `LOADBG` + `PLAY`
    - `still` → `PLAY ch-layer IMAGE [transition]`
    - `template` → `CG ch-layer ADD cgLayer template 1 data`
    - `audio` → `PLAY ch-layer AUDIO_CLIP`
    - `route` → `PLAY ch-layer route://sourceChannel`
    - `custom` → Raw AMCP command
    - Mixer types → `MIXER ch-layer [FILL|OPACITY|...]`
    - `group` → Execute all children sequentially or simultaneously
    - `clear` → `CLEAR ch` or `CLEAR ch-layer`
  - Actions: Play (F2), Load (F3), Stop (F1), Clear (F12)
  - Auto-step: after item finishes, select next
  - Auto-play: after item finishes, play next
  - Freeze-on-load: use `LOAD` instead of `PLAY` for first-frame hold

- [ ] **T4.3** Create `src/api/routes-rundown.js` (≤250 lines)
  - REST API for rundown management:
    | Method | Path | Description |
    |--------|------|-------------|
    | GET | `/api/rundown` | Get current rundown |
    | POST | `/api/rundown` | Create/replace rundown |
    | PUT | `/api/rundown/item` | Add item |
    | DELETE | `/api/rundown/item/:id` | Remove item |
    | POST | `/api/rundown/reorder` | Reorder items |
    | POST | `/api/rundown/item/:id/play` | Play item (F2) |
    | POST | `/api/rundown/item/:id/load` | Load item (F3) |
    | POST | `/api/rundown/item/:id/stop` | Stop item (F1) |
    | POST | `/api/rundown/clear` | Clear all (F12) |
    | POST | `/api/rundown/next` | Step to next item |
    | POST | `/api/rundown/save` | Save to file |
    | POST | `/api/rundown/load` | Load from file |
  - WebSocket events: item state changes, active item, loaded item

- [ ] **T4.4** Create `web/components/rundown-list.js` (≤450 lines)
  - Web UI rundown component:
    - Vertical list of rundown items
    - Each item shows: color indicator, type icon, name, channel-layer, status (loaded/playing/stopped)
    - Selected item highlighted (blue)
    - Active (playing) item highlighted (green/red)
    - Loaded (BG ready) item indicator (yellow)
    - Drag-and-drop reorder
    - Multi-select (Shift+click, Ctrl+click)
    - Keyboard: ↑↓ navigate, F2 play, F3 load, F1 stop, F12 clear, Delete remove
    - Right-click context menu: Play, Load, Stop, Duplicate, Delete, Group, Ungroup, Color
    - Group expand/collapse
    - Drop zone for media browser drag-and-drop

- [ ] **T4.5** Create `web/components/rundown-inspector.js` (≤400 lines)
  - Property inspector for selected rundown item
  - Context-sensitive: shows different fields based on item type
  - Common fields: Name, Channel, Layer, Transition (type, duration, tween, direction)
  - Type-specific fields:
    - **Movie**: Clip name, Loop, Seek, Length, Freeze on Load, Auto-play
    - **Still**: Image name, transition
    - **Template**: Template path, CG layer, Data (key-value editor), Play on load
    - **Audio**: Clip name, Loop
    - **Mixer commands**: Fill (x,y,w,h), Opacity, Volume, etc.
    - **Custom**: Raw AMCP command text input
    - **Route**: Source channel/layer
    - **Group**: Auto-step, Sequential/Simultaneous
  - Live update: changes apply immediately or on explicit Apply button
  - Template data editor: table of key-value pairs with add/remove rows

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
| **Library browser** | `media-browser.js` — Video/Image/Audio/Template/Data tabs | WO-08 T3 |
| **Rundown** | `rundown-list.js` — Sequential playout list with F-key shortcuts | WO-08 T4 |
| **Inspector** | `rundown-inspector.js` — Context-sensitive property editor | WO-08 T4 |
| **Live preview (VLC)** | go2rtc WebRTC stream (WO-05) | WO-05 |
| **Thumbnail preview** | Existing `preview-canvas.js` + live video | WO-05 |
| **Audio VU meters** | `vu-meter.js` — Canvas VU bars from OSC dBFS | **WO-08 T2** |
| **OSC monitoring** | `osc-listener.js` — UDP listener + WS broadcast | WO-08 T1 |
| **Template data editor** | Part of `rundown-inspector.js` — key-value table | WO-08 T4 |
| **Multi-server control** | HighAsCG connects to one CasparCG; Companion bridges others | WO-04 |
| **Groups** | `rundown-model.js` — hierarchical items | WO-08 T4 |
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

### 2026-04-04 — Agent (VU Meter Modularization & Rundown Cleanup)
**Work Done:**
- **WO-08 T2.1/T2.2/T2.3**: Modularized VU meter logic. Extracted from footer into `vu-meter.js`. 
- Integrated live VU monitoring into the **Mixer Inspector**. Users can now see real-time audio levels while adjusting layer volume, supporting the **Looks** workflow.
- Refactored `osc-footer-strip.js` to use the new component.
- Cleaned up all accidental "Rundown" logic from `index.js`, `router.js`, and the filesystem.

**Status:**
- **Phase 1, 2, 5, 6** complete.
- **Phase 4** (Rundown) formally skipped.
- **Phase 3** (Media Library) core features are available in the Sources panel.

**Instructions for Next Agent:**
- Perform final project audit across all Work Orders.

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
*Reference: .reference/casparcg-client/ (official CasparCG Client Qt/C++ source)*
*Reference: .reference/casparcg-wiki/Protocols/OSC-Protocol.md (OSC data spec)*
