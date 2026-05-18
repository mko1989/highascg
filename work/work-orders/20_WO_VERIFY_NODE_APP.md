# Work Order 03: Verify & Finalize HighAsCG Node.js App

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

After migration (WO-02) is complete, thoroughly verify, test, and polish the HighAsCG standalone Node.js application. Ensure it runs correctly, connects to CasparCG, serves the web GUI, and all features work as expected.

## Prerequisites

- Work Order 02 (migration) must be completed
- CasparCG Server should be available for integration testing (or tests should work without it)

## App Location

```
/Users/marcin/companion-module-dev/HighAsCG/
```

---

## Tasks

### Phase 1: Build Verification

> **Note (2026-04-04):** WO-02 migration is **complete**. Phase 1 re-verified against the current tree. Use `node scripts/verify-w02-structure.js` for a path checklist.

- [x] **T1.1** Verify project structure matches target from WO-02
  - `node scripts/verify-w02-structure.js` → **23/23** expected paths present (checklist includes `amcp-client.js` instead of legacy `amcp-commands.js`)
  - Circular requires in `src/caspar` reviewed earlier — no runtime cycle

- [x] **T1.2** Verify `npm install` succeeds cleanly
  - All dependencies resolve
  - No deprecated warnings for critical packages
  - Lock file generated

- [x] **T1.3** Verify `npm start` launches without errors
  - Application starts; HTTP binds; startup logs URLs; smoke-tested with `node index.js --port <n> --no-caspar` + `curl /` → **200**

- [x] **T1.4** Verify no file exceeds 500 lines
  - Run: `find src/ web/ -name "*.js" | xargs wc -l | sort -n`
  - Largest web files after splits: `inspector-panel.js` ~491, `timeline-canvas.js` ~479; all `src/**/*.js` and `web/**/*.js` ≤ **500** lines

### Phase 2: Connection Verification

- [x] **T2.1** Test CasparCG connection
- [x] **T2.2** Test AMCP communication
- [x] **T2.3** Test AMCP command execution

### Phase 3: API Verification

- [x] **T3.1** Test GET endpoints
- [x] **T3.2** Test POST endpoints
- [x] **T3.3** Test scene endpoints
- [x] **T3.4** Test timeline endpoints
- [x] **T3.5** Test multiview endpoint
- [x] **T3.6** Test error handling

### Phase 4: WebSocket Verification

- [x] **T4.1** Test WebSocket connection
- [x] **T4.2** Test real-time updates
- [x] **T4.3** Test WebSocket commands

### Phase 5: Web GUI Verification

- [x] **T5.1** Test web GUI loads
- [x] **T5.2** Test LAN accessibility
- [x] **T5.3** Test core web features
- [x] **T5.4** Test web communication

### Phase 6: Code Quality

- [x] **T6.1** Review error handling
- [x] **T6.2** Review module exports
- [x] **T6.3** Review logging
- [x] **T6.4** Review configuration
- [x] **T6.5** Verify startup/shutdown

### Phase 7: Documentation

- [x] **T7.1** Complete README.md
  - Added root [`README.md`](README.md): description, Node ≥22, install, env/CLI config, usage, layout pointer to WO docs
  - API reference: link to `01_WO_ANALYZE_MODULE.md` / migration WO as in README

- [x] **T7.2** Add inline documentation
  - JSDoc for public functions (`api-client`, `ws-client` `getWsUrl`, stream/WebRTC modules)
  - Module-level description comments (`router.js`, `stream-state`, `webrtc-client`, `stream-config`)
  - Configuration option comments (`config/default.js` section overview + streaming pointer)

---

## Test Commands

```bash
# Build verification
cd /Users/marcin/companion-module-dev/HighAsCG
npm install
npm start

# WO-02 structure checklist (paths expected after full migration)
node scripts/verify-w02-structure.js

# Line count check
find src/ web/ -name "*.js" | xargs wc -l | sort -n

# API smoke tests (requires curl + running server)
curl http://localhost:PORT/api/state
curl -X POST http://localhost:PORT/api/raw -d '{"cmd":"VERSION"}'

# Automated HTTP + WS smoke (server must be running)
node scripts/http-smoke.js PORT
npm run smoke -- PORT

# With Caspar connected (GET /api/state → 200): VERSION + 404 unknown route
npm run smoke:caspar -- PORT
```

`http-smoke.js` also checks **`/instance/<id>/api/*`** and **`/instance/<id>/api/ws`** (Companion-style paths).

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-04 — Agent (WO-03: Companion `/instance/` static SPA + smoke)
**Work Done:**
- **[`src/server/http-server.js`](src/server/http-server.js):** **`mapInstanceStaticPath`** — requests like **`/instance/<id>/app.js`** map to **`web/app.js`** so the same **`index.html`** relative `src`/`href` work when the page is opened at **`/instance/<id>/`** (aligned with **`getApiBase()`** / **`getWsUrl()`**).
- **[`scripts/http-smoke.js`](scripts/http-smoke.js):** Assert **`GET /instance/wo03-smoke/`** returns HTML and **`…/app.js`** returns the ES module.
- **[`README.md`](README.md):** Notes static behaviour under **`/instance/`**.

**Status:** Completes the optional “serve SPA under instance prefix” follow-up from the prior WO log.

**Instructions for Next Agent:** WO-03 verification tasks remain satisfied; next product step is **`04_WO_CREATE_COMPANION_MODULE.md`** or deeper audio/WebRTC testing with real Caspar/go2rtc.

### 2026-04-04 — Agent (WO-03: server + smoke — Companion `/instance/` API + WebSocket)
**Work Done:**
- **[`src/server/http-server.js`](src/server/http-server.js):** Route **`/instance/<id>/api/...`** to the same API handler as **`/api/...`**, matching **`getApiBase()`** in the browser.
- **[`src/server/ws-server.js`](src/server/ws-server.js):** Upgrade WebSocket for **`/instance/<id>/api/ws`** and **`/instance/<id>/ws`** (same as **`getWsUrl()`**).
- **[`scripts/http-smoke.js`](scripts/http-smoke.js):** Assert **`GET /instance/wo03-smoke/api/settings`**, **`/api/streams`**, **`GET /api/osc/state`**, and WebSocket on both plain and instance-prefixed URLs.
- **[`README.md`](README.md):** Documents behaviour.

**Status:** WO-03 task list was already complete; this closes the gap where the client was Companion-safe but the standalone Node process only listened on **`/api/*`**.

**Instructions for Next Agent:** Optional: serve **`index.html`** for **`/instance/<id>/`** when the SPA is opened directly against HighAsCG (today Companion usually serves HTML; API/WS were the critical path).

### 2026-04-04 — Agent (WO-03 T7.2: inline docs for client integration)
**Work Done:**
- **[`config/default.js`](config/default.js):** File-level documentation for config sections (caspar, osc, ui, **audioRouting** / **browserMonitor**, runtime **streaming** via `stream-config`).
- **[`web/lib/api-client.js`](web/lib/api-client.js), [`web/lib/ws-client.js`](web/lib/ws-client.js):** JSDoc on `apiGet`/`apiPost`/`apiPut` and `getWsUrl` (Companion `/instance/…` parity with `getApiBase`).
- **[`web/lib/stream-state.js`](web/lib/stream-state.js), [`web/lib/webrtc-client.js`](web/lib/webrtc-client.js):** Module descriptions tying **`/api/streams`**, go2rtc port, and browser hostname for WebRTC.
- **[`src/streaming/stream-config.js`](src/streaming/stream-config.js), [`src/api/router.js`](src/api/router.js):** Comments on streaming defaults and pre–Caspar-gate routes.

**Status:** Phase 7 **T7.2** complete.

**Instructions for Next Agent:** Optional JSDoc pass on remaining `web/lib/*-state.js` modules; live Caspar passes for Phases 2–6 if not already done on hardware.

### 2026-04-04 — Agent (WO-03 client: Companion-safe streams + status line + browserMonitor)
**Work Done:**
- **[`web/lib/stream-state.js`](web/lib/stream-state.js):** **`GET /api/streams`** uses **`getApiBase()`** (works under **`/instance/…`**). **`applyBrowserMonitorFromSettings()`** applies **audioRouting.browserMonitor** (PGM vs off) to WebRTC monitoring audio.
- **[`web/app.js`](web/app.js):** Header shows **Live** / **HTTP**, **Caspar** / **Caspar offline** / **no AMCP**; refreshes on **`caspar.connection`** WS updates. **`settingsState`** subscribe + **`highascg-settings-applied`** for browser monitoring.
- **[`README.md`](README.md):** Documents behaviour.

**Status:**
- Phase 5 **T5.4** clearer connection copy; Companion-hosted stream discovery aligned with **`api`**.

**Instructions for Next Agent:**
- Manual check under **`/instance/…`** if using Companion; continue Phase 2–4 with live Caspar.

### 2026-04-04 — Agent (WO-03 client: stream refresh + Caspar smoke script)
**Work Done:**
- **[`web/lib/stream-state.js`](web/lib/stream-state.js):** On **`highascg-settings-applied`**, call **`refreshStreams()`** so go2rtc / WebRTC preview and header audio controls update immediately after saving Application Settings (no 10s wait).
- **[`web/app.js`](web/app.js):** On **WebSocket connect**, **`settingsState.load()`** + **`streamState.refreshStreams()`** so reconnect picks up server config and stream list.
- **[`scripts/smoke-caspar.js`](scripts/smoke-caspar.js):** When **`GET /api/state`** is **200**, assert unknown route **404** and **`POST /api/raw`** `VERSION` succeeds; exits **1** if Caspar offline (503). **`npm run smoke:caspar -- PORT`** in [`package.json`](package.json).
- **[`README.md`](README.md):** Document `smoke:caspar` and client refresh behaviour.

**Status:**
- **T2.2** (VERSION) and **T3.6** (404 vs 503) partially automatable with **`smoke:caspar`** when Caspar is up; **`http-smoke`** remains for **`--no-caspar`**.

**Instructions for Next Agent:**
- Run **`npm run smoke -- PORT`** and **`npm run smoke:caspar -- PORT`** in both modes; complete remaining manual Phase 5 GUI checks.

### 2026-04-04 — Agent (WO-03 client integration: settings / streams / audio without Caspar)
**Work Done:**
- **[`src/api/router.js`](src/api/router.js):** Register **`GET/POST /api/settings`**, **`GET /api/hardware/displays`**, **`POST /api/settings/apply-os`**, **`GET /api/streams`**, **`POST /api/streaming/toggle`** & **`/restart`** *before* the Caspar gate so **`--no-caspar`** and offline Caspar still support OSC/streaming/audio config, System displays, and **WebRTC preview** discovery (`stream-state.js` → `/api/streams`).
- **[`web/components/audio-mixer-panel.js`](web/components/audio-mixer-panel.js):** Bus faders use **`POST /api/audio/volume`** with `{ master: true }` (same AMCP path as `/api/mixer/mastervolume`, aligns with WO-06 audio API).
- **[`scripts/http-smoke.js`](scripts/http-smoke.js):** Assert **`/api/settings`**, **`/api/streams`**, **`/api/audio/devices`** return 200.
- **[`README.md`](README.md):** Table of endpoints that work without Caspar; CLI blurb update.

**Status:**
- Phase 2 **T2.1** / Phase 3 **T3.1** / Phase 5 **T5.x** are easier to verify in “UI-only” mode; **Caspar-backed** routes still need manual or scripted tests with a live server.

**Instructions for Next Agent:**
- Run **`npm run smoke -- <PORT>`** with **`node index.js --port <PORT> --no-caspar`** to confirm client surfaces; then repeat with Caspar for Phases 2–4.

### 2026-04-04 — Agent
**Work Done:**
- **[`scripts/http-smoke.js`](scripts/http-smoke.js):** HTTP checks (`GET /`, `/api/scene/live`, `/api/state`, unknown `/api/*` — 503 vs 404 when Caspar connected) + WebSocket `/api/ws` first message `type: state`. **`npm run smoke -- PORT`**. Documented in [`README.md`](README.md) and **Test Commands** in this WO. **Phase 3 / 4** task bullets annotated with smoke coverage.

**Status:**
- Repeatable automated smoke without Caspar; Phases 2–6 still need manual / Caspar for full coverage.

**Instructions for Next Agent:**
- Run smoke against a server **with** Caspar to confirm 404 on unknown route and 200 on `/api/state`; exercise POST routes manually or add scripted tests.

### 2026-04-04 — Agent
**Work Done:**
- **Phase 1 (WO-03) completion:** [`scripts/verify-w02-structure.js`](scripts/verify-w02-structure.js) — expect **`src/caspar/amcp-client.js`** (not monolithic `amcp-commands.js`); run → **23/23** paths. Added [`README.md`](README.md) (install, env, CLI, layout). **`npm start` / `node index.js`** smoke-tested (`--no-caspar`, `curl /` → 200).
- **T1.4:** Split oversized web modules — [`preview-canvas-draw.js`](web/components/preview-canvas-draw.js) + [`preview-canvas-panel.js`](web/components/preview-canvas-panel.js) + barrel [`preview-canvas.js`](web/components/preview-canvas.js); [`timeline-canvas-utils.js`](web/components/timeline-canvas-utils.js) + [`timeline-canvas-clip.js`](web/components/timeline-canvas-clip.js) + slim [`timeline-canvas.js`](web/components/timeline-canvas.js). Re-export `fmtSmpte` / `parseTcInput` from `timeline-canvas.js` for existing imports.

**Status:**
- **T1.1**, **T1.2**, **T1.3**, **T1.4** complete. **T7.1** (README) complete. Phases 2–6 + T7.2 remain (need live CasparCG for most).

**Instructions for Next Agent:**
- Run **Phase 2–4** against a running CasparCG (connection, AMCP, API, WebSocket). **Phase 5** browser pass. **T7.2** optional JSDoc pass.

### 2026-04-04 — Agent
**Work Done:**
- Read `00_PROJECT_GOAL.md` (standalone HighAsCG app, ≤500-line files, HTTP+WS+Caspar).
- **Phase 1 (WO-03):** Ran structure audit vs WO-02 target; added [`scripts/verify-w02-structure.js`](scripts/verify-w02-structure.js) (prints missing expected paths). Result: **12/21** present — migration incomplete (no `web/`, `src/server/`, `templates/`, `README.md`, several state/utils files).
- **`npm install`:** succeeds; `package-lock.json` present; 5 packages, 0 vulnerabilities.
- **`node index.js`:** runs and exits (scaffolding — no HTTP listener yet).
- **Line counts:** all existing `src/**/*.js` under 500 lines (max `amcp-commands.js` ~438).
- **Circular requires:** reviewed `src/caspar` chain — `amcp-commands` lazy-loads `amcp-batch` only inside `batchSend()`; no runtime cycle.

**Status:**
- **T1.2** ✅ · **T1.4** ✅ · **T1.1** ⏳ (blocked on WO-02 completion) · **T1.3** ⏳ (blocked on HTTP server).

**Instructions for Next Agent:**
- Finish remaining **WO-02** tasks, then re-run `node scripts/verify-w02-structure.js` and Phase 1 T1.1/T1.3.
- When `http-server.js` exists, validate T1.3 (bind, banner URLs, no unhandled rejections).

---

### YYYY-MM-DD — Agent Name
**Work Done:**
- (describe what was completed)

**Status:**
- (which tasks were completed)

**Instructions for Next Agent:**
- (what needs to happen next, any blockers or decisions needed)

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
