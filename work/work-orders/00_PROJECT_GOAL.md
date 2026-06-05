# HighAsCG — Project Goal & Architecture

## Overview

**HighAsCG** is a migration and evolution of the CasparCG client functionality currently embedded inside the `companion-module-casparcg-server` Companion module. The goal is to extract the client, web GUI, and server-communication logic into a **standalone Node.js application** while maintaining a lean Companion module for button-triggered AMCP commands and 2-way API bridging.

## Current State

The `companion-module-casparcg-server` module (~17,744 lines across 64 files) is a monolith that combines:

1. **Companion module concerns** — actions, presets, feedbacks, variables, config fields (Companion SDK integration)
2. **CasparCG TCP/AMCP client** — TCP socket, AMCP protocol parser, command queue, command abstraction layer
3. **REST/WebSocket API server** — 50+ API endpoints for AMCP, mixer, CG, timelines, multiview, etc.
4. **State management** — channel state, media lists, templates, playback tracking, live scene state
5. **Web GUI (SPA)** — dashboard, scenes editor, timeline editor, multiview editor, inspector, sources panel (~8,500 lines in `src/client/`)
6. **Production features** — scene transitions with A/B bank crossfade, timeline engine, config generator, routing/multiview, DeckLink inputs, periodic sync

### Files Over 500 Lines (need splitting during migration)
| File | Lines | Notes |
|------|-------|-------|
| `api-routes.js` | 1,107 | Massive route dispatch — split into domain routers |
| `inspector-panel.js` | 1,302 | Web UI component — split into sub-panels |
| `scenes-editor.js` | 1,125 | Web UI component — split into sub-components |
| `timeline-canvas.js` | 669 | Web UI component |
| `timeline-editor.js` | 633 | Web UI component |
| `config-fields.js` | 592 | Config definitions — can be modularized |
| `config-generator.js` | 533 | XML generation — can be modularized |
| `actions.js` | 598 | Companion action definitions |
| `instance.js` | 522 | Main module class — needs splitting |
| `scene-transition.js` | 518 | Scene/look transition logic |
| `timeline-engine.js` | 509 | Timeline data model + playback |
| `dashboard.js` | 511 | Web UI component |
| `preview-canvas.js` | 513 | Web UI component |

## Target Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CasparCG Server                       │
│                   (AMCP port 5250)                       │
└───────────────┬──────────────────────┬───────────────────┘
                │ TCP/AMCP             │ TCP/AMCP
                │                      │
┌───────────────▼──────────┐  ┌────────▼──────────────────┐
│   HighAsCG Client App    │  │  Companion Module         │
│   (Standalone Node.js)   │  │  companion-module-        │
│                          │  │  highpass-highascg         │
│  • Own HTTP+WS server    │◄─┤                           │
│  • TCP→CasparCG (AMCP)   │  │  • Button → AMCP actions  │
│  • Web GUI (localhost +  │  │  • 2-way API bridge       │
│    LAN accessible)       │  │    to HighAsCG client     │
│  • Full state management │  │  • Variables/feedbacks    │
│  • Scene/timeline engine │  │    from HighAsCG state    │
│  • REST API              │  │                           │
│  • WebSocket live state  │  │  • Lightweight, focused   │
└──────────────────────────┘  └───────────────────────────┘
                │
       ┌────────▼────────┐
       │  Web Browser     │
       │  (localhost:PORT) │
       │  or LAN IP:PORT  │
       └─────────────────┘
```

### Three Deliverables

1. **HighAsCG Client App** (`/HighAsCG/`) — Standalone Node.js app
   - Creates its own HTTP + WebSocket server
   - Connects directly to CasparCG via TCP/AMCP
   - Serves the web GUI on localhost and LAN
   - Full state management, scene engine, timeline engine
   - REST + WebSocket API for real-time communication
   - Modular codebase: no file > 500 lines

2. **Companion Module - HighPass HighAsCG** (`/companion-module-highpass-highascg/`)
   - Lightweight bridge module for Bitfocus Companion
   - Sends AMCP commands via button actions (basic CasparCG control)
   - 2-way API connection to HighAsCG client app
   - Reads state from HighAsCG (variables, feedbacks)
   - Pushes commands from Companion buttons → HighAsCG → CasparCG
   - Also maintains its own direct CasparCG TCP connection for fast AMCP

3. **Analysis & Migration Documentation** — Detailed codebase scan, migration mapping, and verification checklists

## Key Principles

- **Modularity** — Every source file ≤ 500 lines, clear single responsibility
- **Robustness** — Proper error handling, reconnection logic, graceful degradation
- **Network accessibility** — Web GUI on `0.0.0.0` (localhost + LAN)
- **Separation of concerns** — CasparCG AMCP client ≠ Companion SDK ≠ Web GUI ≠ API
- **Code reuse** — Shared AMCP protocol library between client and module
- **Clean architecture** — Event-driven state management, clear data flow

## Upcoming Features: Previs, Output Slicing & Tracking

### 3D Pre-Visualization (WO-17)
Import 3D stage models (glTF/GLB, OBJ, FBX) and map live CasparCG PGM output as video textures onto designated screen surfaces. Uses **Three.js** for browser-based 3D rendering with `VideoTexture` piggybacking on the existing go2rtc WebRTC `<video>` element. Supports orbit camera, camera presets, and multi-screen mapping.

### Output Slicer (WO-18)
Define rectangular regions ("slices") on the CasparCG output canvas that correspond to physical LED displays. Each slice has its own native resolution, position, and rotation. Example: a 4K (3840×2160) output feeding a 3840×768 main LED wall plus two 256×768 portrait totems — totem content is placed rotated 90° at the bottom of the output. The LED processor reads each region and routes to the correct display.

### Person Tracking (WO-19)
Real-time detection and tracking of performers on stage using camera inputs. **Phase 1**: Browser-side using MediaPipe PoseLandmarker on the WebRTC video stream (~15 fps, single person). **Phase 2**: Server-side using ONNX Runtime + YOLOv8-Pose for multi-person tracking with persistent IDs (ByteTrack). Projects 2D detections onto the 3D stage model via homography calibration. Outputs tracking data as Companion variables, OSC messages, and WebSocket events for lighting desks and automation systems.

---

## Work Orders

| # | Document | Purpose |
|---|----------|---------|
| 1 | [01_WO_ANALYZE_MODULE.md](./01_WO_ANALYZE_MODULE.md) | Deep analysis of companion-module-casparcg-server |
| 2 | [02_WO_MIGRATE_TO_HIGHASCG.md](./02_WO_MIGRATE_TO_HIGHASCG.md) | Migration plan with file-by-file mapping |
| 3 | [03_WO_VERIFY_NODE_APP.md](./03_WO_VERIFY_NODE_APP.md) | Verification & finalization of HighAsCG Node app |
| 4 | [04_WO_CREATE_COMPANION_MODULE.md](./04_WO_CREATE_COMPANION_MODULE.md) | Build the new bridge Companion module |
| 5 | [05_WO_LIVE_PREVIEW_SETTINGS.md](./05_WO_LIVE_PREVIEW_SETTINGS.md) | Live video preview (go2rtc), settings modal, audio monitoring |
| 6 | [06_WO_AUDIO_PLAYOUT.md](./06_WO_AUDIO_PLAYOUT.md) | Multi-channel audio playout on Ubuntu (HDMI, USB, Dante/AES67, NDI) |
| 7 | [07_WO_AMCP_PROTOCOL_API.md](./07_WO_AMCP_PROTOCOL_API.md) | Complete AMCP protocol as API (~79 commands, REST + WS + JS) |
| 8 | [08_WO_CASPARCG_CLIENT_FEATURES.md](./08_WO_CASPARCG_CLIENT_FEATURES.md) | CasparCG client app features: VU meters (OSC), rundown (skipped), media browser |
| 9 | [09_WO_OSC_PROTOCOL.md](./09_WO_OSC_PROTOCOL.md) | Complete OSC protocol: real-time audio/playback/profiler, replace AMCP polling |
| 10 | [10_WO_VARIABLES_AND_REALTIME_STATUS.md](./10_WO_VARIABLES_AND_REALTIME_STATUS.md) | Variables & Real-time Status: searchable explorer, Companion variables |
| 11 | [11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md](./11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md) | Boot Orchestrator: CLI network status, hardware display mapping, TTY banner |
| 12 | [12_WO_PRODUCTION_INSTALLER.md](./12_WO_PRODUCTION_INSTALLER.md) | Production Installer: Automated bash script, service setup, firewall hardening |
| 13 | [13_WO_FINAL_POLISH_AND_HARDENING.md](./13_WO_FINAL_POLISH_AND_HARDENING.md) | Final Polish & Hardening: API batching, security restricts, Looks workflow |
| 14 | [14_WO_OFFLINE_PREPARATION_MODE.md](./14_WO_OFFLINE_PREPARATION_MODE.md) | Offline Preparation Mode: Metadata caching, simulated client, draft sync |
| 15 | [15_WO_CLIENT_SERVER_SYNC.md](./15_WO_CLIENT_SERVER_SYNC.md) | Client-Server Sync: Sequential differential media sync to production |
| 16 | [16_WO_YAMAHA_DM3_AUDIO_INTEGRATION.md](./16_WO_YAMAHA_DM3_AUDIO_INTEGRATION.md) | Yamaha DM3 Integration: ALSA default, stereo downmix, OSC metering |
| 17 | [17_WO_3D_PREVIS.md](./17_WO_3D_PREVIS.md) | 3D Previs: Import 3D models, map PGM video textures, orbit camera, presets |
| 18 | [18_WO_OUTPUT_SLICER.md](./18_WO_OUTPUT_SLICER.md) | Output Slicer: Region mapping for LED wall content placement with rotation |
| 19 | [19_WO_PERSON_TRACKING.md](./19_WO_PERSON_TRACKING.md) | Person Tracking: MediaPipe (browser) + ONNX/YOLOv8 (server), stage calibration |
| 20 | [20_WO_VERIFY_NODE_APP.md](./20_WO_VERIFY_NODE_APP.md) | Verify Node App: Post-migration app audit |
| 21 | [21_WO_TIMELINE_INSPECTOR_WAVEFORM.md](./21_WO_TIMELINE_INSPECTOR_WAVEFORM.md) | Timeline Layout, Trim Preview, Clip Waveforms |
| 22 | [22_WO_MIXER_EFFECTS.md](./22_WO_MIXER_EFFECTS.md) | Mixer Effects: Effects tab, drag-and-drop, inspector editors (blend, crop, chroma, levels, etc.) |
| 23 | [23_WO_HTML_WEBPAGE_SOURCE.md](./23_WO_HTML_WEBPAGE_SOURCE.md) | HTML Webpage Source: Live tab item, URL inspector, CasparCG HTML producer |
| 24 | [24_WO_COMPANION_BUTTON_PRESS.md](./24_WO_COMPANION_BUTTON_PRESS.md) | Companion Button Press: Timeline flag action, HTTP press API, settings tab |

---
*Created: 2026-04-04 | Updated: 2026-04-12 | Project: HighAsCG Migration*
