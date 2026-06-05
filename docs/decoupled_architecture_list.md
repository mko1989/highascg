# HighAsCG Decoupled Service Architecture

This document defines the strict boundary of responsibilities between the **Headless Backend (Service Engine)** and the **Decoupled Frontend (Single-Page Application)**.

```mermaid
graph TD
    subgraph Browser Client (Frontend SPA)
        UI[Interactive UI & Inspectors]
        VS[Vite Dev Server & Proxy]
        WS_C[Client WebSocket Manager]
        Previs[Three.js 3D Previs]
    end

    subgraph Headless Server (Backend Engine)
        API[Express REST API]
        WS_S[WebSocket Telemetry Hub]
        AMCP[CasparCG AMCP Driver]
        DMX[ArtNet DMX Controller]
        DB[(State & Presets JSON DB)]
    end

    UI -->|Relative Requests| VS
    VS -->|Proxy Pass /api| API
    VS -->|Proxy Pass /ws| WS_S
    WS_C <-->|Bi-directional State Sync| WS_S
    API <--> DB
    API --> AMCP
    AMCP <-->|TCP Playout Control| CasparCG[CasparCG Server]
```

---

## 1. Headless Backend Server (Service Engine)
The backend is a pure, headless Node.js program running as a system service. It owns all state persistence, hardware interfaces, and playout scheduling.

### Responsibilities
- **HTTP / REST API Engine**: Handles saving configurations, uploading previs GLTF models, backing up snapshot states, and processing operational logs.
- **WebSocket Synchronization Hub**: Coordinates bidirectional telemetry updates (`state_delta` updates, active playback metrics, and DMX level packets).
- **CasparCG Connection (AMCP Driver)**: Manages direct socket channels to CasparCG servers. Automatically performs reconnects, parses clip listings, query configurations, and dispatches real-time commands.
- **DMX & ArtNet Driver**: Maps physical LED mapping dimensions, binds UDP sockets, and emits real-time lighting control packets.
- **Scene Engine & Take Compositor**: Performs mathematical layout evaluations, groups devices into active configurations, and schedules multi-step take playout jobs.
- **Config & Preset Database**: Reads and persists settings inside local JSON files (e.g., `highascg.config.json` and active scene states).

---

## 2. Decoupled Frontend Client (SPA)
The frontend is a lightweight, pure static bundle (HTML, CSS, JS, SVG logos) compiled via Vite. It can be hosted on any CDNs, static file servers, or local Nginx instances.

### Responsibilities
- **Interactive UI (Vanilla JS Components)**: Renders the Devices panel, Sources inspector, Audio Mixer, and Timeline grid.
- **State Store (`state-store.js`)**: Tracks client-side caches of loaded media, active streams, and DMX universes.
- **WebSocket Interface (`ws-client.js`)**: Subscribes to real-time events and handles instant state synchronization updates.
- **Lazy-Loaded Modules**: 
  - **Three.js Previs Viewport**: Renders 3D layouts, camera orbits, and mock video textures.
  - **GrapesJS Layout builder**: Renders HTML/CSS visual composition editors.
  - **WebRTC Streaming Client**: Binds incoming low-latency video preview streams.
- **Style System (CSS)**: Defines harmonious layout tokens, glassmorphism headers, dark mode variants, and responsive layout grids.

---

## 3. The Shared Boundary (API & WS Contracts)
The frontend and backend interact **only** through a strictly defined interface.

| Category | Endpoint / Event | Payload Structure | Description |
| :--- | :--- | :--- | :--- |
| **REST API** | `GET /api/media` | Array of `MediaItem` objects | Fetch cached files from the server's media path. |
| **REST API** | `POST /api/config/save` | Full `Config` JSON model | Overwrite the server's active hardware mapping. |
| **WebSocket** | Send `{ type: "amcp", cmd: "..." }` | `{ type: "amcp_result", data: "..." }` | Execute live raw AMCP commands directly. |
| **WebSocket** | Recv `state_delta` | HSL or diff delta object | Real-time synchronization of screen layouts. |
