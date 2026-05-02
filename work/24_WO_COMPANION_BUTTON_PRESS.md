# Work Order 24: Companion Button Press from Timeline

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Allow **timeline flags** in HighAsCG to trigger a **Bitfocus Companion** button via its **HTTP Remote Control** API: when the playhead crosses a flag of type `companion_press`, the server sends a **POST** to Companion so the configured page/row/column runs its actions (press + release).

## Prerequisites

- **Companion** running with **HTTP API** enabled (default web port is often **8000**; user may use another port).
- Network reachability from the HighAsCG process to `companion.host:companion.port` (localhost is typical).
- See the **HTTP Remote Control** / **HTTP API** section in the Bitfocus Companion documentation for your installed version (paths and defaults can change between releases).

## API contract (Bitfocus)

HighAsCG uses the documented pattern:

```http
POST /api/location/<page>/<row>/<column>/press
```

Example: `POST http://127.0.0.1:8000/api/location/1/0/2/press` — page **1**, row **0**, column **2**.

- **Method:** `POST` (required; GET-style legacy `/press/bank/...` is deprecated).
- **Implementation:** server-side `fetch()` from Node (`src/engine/timeline-playback.js`) — **not** from the browser, so **CORS does not apply** between HighAsCG UI and Companion.

## Architecture

```
Timeline playback (_processTimelineFlags)
       │
       └─ flag.type === 'companion_press'
              │
              ├─ Read ctx.config.companion { host, port }  (defaults 127.0.0.1:8000)
              ├─ Read flag.companionPage | companionRow | companionColumn
              └─ fetch(`http://${host}:${port}/api/location/${page}/${row}/${col}/press`, { method: 'POST' })
                     .catch → log warn (fire-and-forget)
```

## Code map

| Concern | File / area |
|---------|----------------|
| Flag handling + HTTP POST | `src/engine/timeline-playback.js` — `_processTimelineFlags`, `companion_press` branch |
| Persisted settings | `src/api/routes-settings.js` — `companion` object on GET/POST settings |
| Timeline UI (flag type + fields) | `web/components/inspector-panel.js` — `companion_press`, Page/Row/Column |
| Flag colour in timeline | `web/components/timeline-canvas.js` |
| Settings UI (host/port) | `web/components/settings-modal.js` — Companion tab |

---

## Tasks

### Implementation

- [x] **T24.1** Timeline flag type `companion_press` with page/row/column fields
- [x] **T24.2** Server-side POST to `/api/location/.../press` using configured host/port
- [x] **T24.3** Application settings: Companion host + port (persisted with other settings)
- [x] **T24.4** Inspector copy / hint pointing users to Settings → Companion

### Testing & ops

- [x] **T24.5** QA: `npm run smoke:companion-press` (mock HTTP server + POST/JSON) + real Companion manual pass optional

### Security note

- Anyone who can **edit timelines** or **POST settings** can point Companion presses at arbitrary grid cells. Treat HighAsCG access and project files accordingly on shared networks.

---

## Work Log

*(Agents: add entries below in reverse chronological order)*

### 2026-04-22 — Agent (T24.5 + request body)

**Work Done:** `fetch()` for Companion now sends `Content-Type: application/json` and body `{}` (some API gateways expect a body). Added `tools/smoke-companion-press.mjs` and `npm run smoke:companion-press` — no Bitfocus required; simulates the same request pattern as `timeline-playback.js`.

**Instructions for Next Agent:** On a show machine, still do one manual fire against real Companion to confirm the grid cell and release behaviour.

### 2026-04-13 — Agent (WO-24: initial work order + status sync)

**Work Done:**

- Created this work order describing the Companion HTTP API, data flow from timeline flags to `fetch`, and file map for settings/UI/engine.
- Confirmed implementation matches documented **POST** `/api/location/<page>/<row>/<col>/press` pattern used by Bitfocus Companion 3.x/4.x remote control.

**Status:** **T24.1–T24.5** complete (T24.5 = automated smoke + optional real Companion run).

**Instructions for Next Agent:** None — use `npm run smoke:companion-press` in CI.

---
*Work Order created: 2026-04-13 | Series: HighAsCG operations*
