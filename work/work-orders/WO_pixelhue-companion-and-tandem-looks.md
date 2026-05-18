# Work order: PixelHue API integration & tandem multi-screen control

**See also**

- `docs/PIXELHUE_API.md` — HTTP/WSS endpoints and auth (from the PixelHue Companion module).  
- `work/WO_pixelhue-highascg-webui-mixing.md` — concrete plan to proxy the API in HighAsCG and drive **Caspar + PixelHue** from the web UI.

## Vision

Use **HighAsCG** to program **both** **CasparCG** outputs and **PixelHue** show-control surfaces in **one** workflow, similar to how large events chain **Barco** / **Analog Way** / **PixelHue** for LED + projection + broadcast—here we explicitly add **PixelHue** as a first-class control target alongside **Caspar**.

Goals:

- **Tandem “looks”**: one user action (or one saved **look preset**) drives **Caspar** layer/stack state **and** a **PixelHue** preset (or scene/cut) in lockstep.
- **Programming PRV** using **PixelHue** sources where useful—e.g. **RTSP** (or other vendor feeds) in the **preview** / programming UI so operators match **what they see** on the PixelHue side with what Caspar is doing.
- **Advanced layout**: e.g. **ultra-wide** as **Key + Fill** on **two DeckLink** outputs from **Caspar**, with **background** on **PGM1** in Caspar and **layer 1** on **PixelHue**; presets recall **both** sides consistently.

*Note: exact PixelHue product lines and API names must be taken from **official documentation** and/or vendor SDKs at implementation time. This WO uses generic terms (presets, layers, “programs”) to avoid encoding wrong URLs or endpoints here.*

---

## 1. Companion module (PixelHue)

- **New repository or package**: `companion-module-pixelhue` (or under monorepo if applicable).
- **Responsibilities**:
  - Connection (host, port, auth or token as per API).
  - **Actions/feedbacks** for: recall preset, select layer, take/cut, status (at minimum what the public API allows).
  - **Variables** for: connection, last error, current preset name (if available).
- **Config**: same machine vs remote; same LAN assumptions as Caspar; document firewall.

**Reference**: Companion’s generic module pattern (Upgrade scripts, `runEntrypoint`, etc.)—align with this repo’s existing **Caspar** companion work if any.

---

## 2. HighAsCG application integration (separate from Companion)

### 2.1 Server-side PixelHue client (preferred for security)

- **Node** service in this repo: `src/pixelhue/` (name TBD) with a thin **HTTP/REST** or **WebSocket** client to PixelHue, configured via `highascg.config.json` (host, port, credentials).
- **API surface** in `src/api/`: e.g. `GET/POST /api/pixelhue/...` proxied to the device so the **web UI** does not hold secrets (or use env for tokens).

### 2.2 Look / look-preset model extension (when tandem is enabled)

Extend stored look or **look preset** (see `work/WO_look-and-layer-presets.md`) with optional:

```text
tandem: {
  pixelhue: {
    presetId: string,      // or vendor’s native id
    // optional: layer id, take group, “program” name — to be set after API review
  }
}
```

**Execution order on recall (product decision):** Caspar first then PixelHue, or reverse, or parallel with timeout—document and test against **frame-accurate** requirements (often **PixelHue** first for routing, then **Caspar** for content).

### 2.3 RTSP / streams for “programming PRV”

- If PixelHue exposes **RTSP** (or HLS) for a **bus** or **layer**, allow configuring **one or more** URLs in settings and:
  - Either embed in a **previs** or **web preview** surface, *or* feed into a **go2rtc** or **existing streaming** path already in this repo (`streaming/`, previs) as a **“PixelHue bus”** source type.
- **Non-goal** for v1: full NDI replacement; v1 = **enough to frame-accurately program** next to scene compose.

### 2.4 Key + Fill (Caspar) + PixelHue background

- **Caspar**: two program outputs (e.g. **DeckLink** key + **DeckLink** fill) already a **config generator** / routing concern—ensure `channelMap` and **take** paths know which channel is K vs F.
- **PixelHue**: map **one** recall action to “background on PGM1 + layer 1” (or whatever the show file uses)—stored as part of the **tandem** payload.
- **UI**: in **Look preset** or **tandem** editor, show **two columns** of targets: **Caspar** and **PixelHue** with “link” or “recall both”.

---

## 3. Phases

| Phase | Deliverable |
|--------|-------------|
| **P0** | Vendor API research document (auth, rate limits, test unit on bench). |
| **P1** | Companion module: connect + recall one preset (proof of life). |
| **P2** | HighAsCG: config slice + `api/pixelhue` proxy + one button in UI (test). |
| **P3** | Tandem field on look/look-preset; recall order + error handling. |
| **P4** | RTSP (or stream URL) in settings + preview path for PRV programming. |
| **P5** | Key+Fill + PixelHue L1 + Caspar L1 E2E test script in `tools/`. |

---

## 4. Risks & dependencies

- **API** availability, licensing, and **breaking changes** between PixelHue software versions.
- **Latency** between Caspar and PixelHue on recall—may need **delay** or **handshake** (OSC trigger from PixelHue back—future).
- **RTSP in browser** often requires **transmux** (e.g. go2rtc WebRTC) — reuse existing `streaming` stack in this repo where possible.
- **Security**: do not log tokens; prefer **read-only** scope for status-only features first.

---

## 5. References in this repo (when implementing)

- `src/config/routing.js`, `channel-map-from-ctx.js` — multi-main PGM/PRV.
- `web/lib/scene-state.js` — looks and `mainScope`.
- `work/WO_look-and-layer-presets.md` — preset panel and look/layer save-recall.
- `src/streaming/`, `go2rtc` usage — for RTSP/WebRTC.

---

*Version: 1.0 — planning only; no vendor API details encoded here.*
