# Work Order 30: Previs & Tracking Module — Packaging and Integration

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Package 3D Previs ([WO-17](./17_WO_3D_PREVIS.md)), Person Tracking ([WO-19](./19_WO_PERSON_TRACKING.md)), and Stage Auto-Follow ([WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md)) as an **isolated, detachable feature module** on top of HighAsCG's base build, so that:

- The **core HighAsCG codebase has zero hard dependency** on any of the previs/tracking code.
- Deleting the `src/previs/`, `src/tracking/`, `src/autofollow/`, `web/components/previs-*`, `web/components/tracking-*`, and `web/components/autofollow-*` trees leaves the rest of the app booting and working normally.
- Heavy dependencies (`three`, `onnxruntime-node`, model files) never appear in the base install.
- A single environment/config flag toggles the whole module on or off.

This is the **umbrella** work order that defines the boundary, the integration contract, and the shared conventions for the three feature WOs underneath it. It does not define any feature itself — those live in WO-17, WO-19, and WO-31.

---

## Why a module, not a branch

We considered four packaging options (feature flag, build variants, workspace packages, git branch strip). The operator goal is: _"make it easy to delete the whole 3D branch if it becomes hard/buggy."_ That maps cleanly to **isolated side-car directories gated by a runtime feature flag**, rather than a git branch or a monorepo split.

- One source of truth, no branch merges.
- Zero core imports of the module's code — the module registers itself via a thin hook in `index.js`.
- Heavy deps live in `optionalDependencies`; `npm install --omit=optional` produces the lean build.
- `rm -rf src/previs src/tracking src/autofollow web/components/{previs,tracking,autofollow}-*.js web/lib/{previs,tracking,autofollow}-*.js web/styles/previs*.css` cleanly removes everything.

---

## Module boundary — directories

| Path | Owner | Notes |
|------|-------|-------|
| `src/previs/` | WO-17 | Server routes for model upload/listing, server-side helpers |
| `src/tracking/` | WO-19 | ONNX session, ByteTrack, FFmpeg raw-frame ingress worker |
| `src/autofollow/` | WO-31 | Per-device calibration, zone-exit logic, Companion out stream |
| `web/components/previs-*.js` | WO-17 | 2D/3D toggle in PGM cell, mesh picker, screen-mapping UI |
| `web/components/tracking-*.js` | WO-19 | Tracking overlay canvas, calibration wizard |
| `web/components/autofollow-*.js` | WO-31 | Device list, per-device calibration, start/stop actions |
| `web/lib/previs-*.js` | WO-17 | Three.js scene controller, model loader, video-texture helper |
| `web/lib/tracking-*.js` | WO-19 | Homography math, EMA/one-euro filter, stage-coord helper |
| `web/lib/autofollow-*.js` | WO-31 | Lock state, delta computation, device driver registry |
| `web/styles/previs*.css`, `tracking*.css`, `autofollow*.css` | per-WO | Scoped styles |
| `web/assets/models/`, `web/assets/mediapipe/` (if any) | WO-17 | Static assets served only when module is enabled |

**Invariant:** no file under `src/` (outside the three module dirs) or `web/components/`, `web/lib/`, `web/app.js`, `web/index.html` may `import` / `require` from the module paths directly. All touchpoints go through the registration API below.

---

## Integration contract

### 1. Registration API

A tiny, stable surface owned by core:

```js
// src/module-registry.js  (core, ships always)
module.exports = {
  /** @type {Array<{name:string, register:(ctx)=>void}>} */
  modules: [],
  register(mod) { this.modules.push(mod) },
  applyAll(ctx) { for (const m of this.modules) m.register(ctx) },
}
```

Each feature module exposes exactly one file:

```js
// src/previs/register.js       (deleted when module removed)
module.exports = {
  name: 'previs',
  register(ctx) {
    ctx.router.mount('/api/previs',   require('./routes-previs'))
    ctx.ws.registerNamespace('previs:', require('./ws-previs'))
    ctx.web.addComponent('previs-pgm-3d', '/assets/previs-pgm-3d.js')
    ctx.web.addStylesheet('/assets/previs.css')
  },
}
```

In `index.js`, loading is guarded and non-fatal:

```js
const registry = require('./src/module-registry')
if (process.env.HIGHASCG_PREVIS === '1' || config.features?.previs3d) {
  try { registry.register(require('./src/previs/register')) } catch (e) {
    log.warn('previs module not installed; skipping')
  }
  try { registry.register(require('./src/tracking/register')) } catch (e) { log.warn(...) }
  try { registry.register(require('./src/autofollow/register')) } catch (e) { log.warn(...) }
}
registry.applyAll(ctx)
```

If the directories are deleted, the `require()` throws, the `try/catch` swallows it, the app boots. No rebuild needed.

### 2. Web side

`web/app.js` calls a single function `initOptionalModules()` that asks the server for an enabled-module list (`GET /api/modules`) and dynamically `import()`s the corresponding JS bundles only if listed. Zero static imports from app.js → module code.

### 3. Shared conventions

- **Stage coordinate system (meters, right-handed):**
  - X: stage-left (+) / stage-right (−) as seen from the house.
  - Y: upstage (+) / downstage (−).
  - Z: up (+). Floor is `Z = 0`.
  - Origin: centre of the stage floor unless the calibration wizard overrides.
- **WebSocket event namespaces:**
  - `previs:*` — scene/model/screen-mapping changes.
  - `tracking:persons` — detection broadcast (see WO-19 payload shape).
  - `autofollow:*` — lock status, per-device command streams, zone transitions.
- **Settings keys:** all module settings under `features.previs3d.*`, `features.tracking.*`, `features.autofollow.*` in `highascg.config.json` so they're easy to grep out.
- **Feature flag precedence:** `HIGHASCG_PREVIS=1` env wins over config; config `features.previs3d = true` is the stable opt-in.

---

## Dependencies — how they stay optional

`package.json`:

```json
{
  "dependencies": { /* everything the base needs, no three/onnx here */ },
  "optionalDependencies": {
    "three": "^0.170.0",
    "onnxruntime-node": "^1.19.0"
  }
}
```

`scripts/install-phase4.sh` grows a `--with-previs` flag:

- Without flag: `npm install --omit=optional` → base build, no 3D libs on disk.
- With flag: `npm install` → full install, also downloads the YOLOv8n-Pose ONNX model and Three.js Draco decoder into `<data>/models/` and `<data>/draco/`.

The CI produces two installer artifacts: `highascg-base.tar.gz` and `highascg-previs.tar.gz`. The second is simply the first + `src/{previs,tracking,autofollow}` + `web/{components,lib,styles}/{previs,tracking,autofollow}*` + models + optional deps vendored.

---

## Code map

| Concern | File |
|---------|------|
| Module registry (core) | `src/module-registry.js` [NEW, ships always] |
| Boot hook (core) | `index.js` (~10 lines added) |
| Optional-module discovery (core) | `src/api/routes-modules.js` [NEW, tiny] |
| Web loader (core) | `web/lib/optional-modules.js` [NEW], `web/app.js` (~5 lines) |
| Previs registration | `src/previs/register.js` [NEW] |
| Tracking registration | `src/tracking/register.js` [NEW] |
| Autofollow registration | `src/autofollow/register.js` [NEW] |
| Build variants | `scripts/install-phase4.sh`, `package.json` `optionalDependencies` |

---

## Tasks

### Phase 1 — Core registry and boot hook
- [x] **T30.1** Create `src/module-registry.js` with the `register` / `applyAll` surface. _(2026-04-21 — `src/module-registry.js` ships `register`, `tryLoad`, `listNames`, `bootAll`, `shutdownAll`, `handleApi`, `describe`.)_
- [x] **T30.2** Wire `index.js` to attempt loading `src/previs/register`, `src/tracking/register`, `src/autofollow/register` behind `HIGHASCG_PREVIS=1` or `config.features.previs3d === true`, with try/catch per module. _(2026-04-21 — `loadOptionalModules()` in `index.js` + `moduleRegistry.bootAll(appCtx)` after WS is up + `shutdownAll` in shutdown.)_
- [x] **T30.3** Create `GET /api/modules` → `{ enabled: ['previs','tracking','autofollow'] }` (only those that successfully loaded). _(2026-04-21 — `src/api/routes-modules.js`, registered in `router.js` at top of dispatch. Returns `{ enabled, bundles, styles, wsNamespaces }`.)_
- [x] **T30.4** Extend the web bootstrap (`web/app.js`) with `initOptionalModules()` that fetches `/api/modules` and dynamic-imports each module's entry bundle (`/assets/<name>.js`). _(2026-04-21 — `web/lib/optional-modules.js` added; `web/app.js init()` fires it in parallel with layout setup. Each module's default export receives `{ stateStore, ws, api, sceneState, settingsState, streamState }`.)_
- [x] **T30.5** Move `three` and `onnxruntime-node` to `optionalDependencies`. Add `npm run install:base` and `npm run install:previs` scripts. _(2026-04-21 — `three@^0.184.0`, `onnxruntime-node@^1.24.3` added; `install:base` = `npm install --omit=optional`, `install:previs` = `npm install --include=optional`.)_

### Phase 2 — Installer split
- [ ] **T30.6** Add `--with-previs` flag to `scripts/install-phase4.sh`. Without it: `npm install --omit=optional`.
- [ ] **T30.7** With the flag: additionally download YOLOv8n-Pose ONNX + Draco decoder into `<data>/models/` and `<data>/draco/`.
- [ ] **T30.8** Build two release artifacts from CI: `highascg-base.tar.gz` (no previs code) and `highascg-previs.tar.gz` (full).

### Phase 3 — Deletion test (the real acceptance criterion)
- [ ] **T30.9** With the module installed: `HIGHASCG_PREVIS=1 npm start` → PGM 2D/3D toggle, tracking overlay, and auto-follow UI all present.
- [ ] **T30.10** Delete `src/{previs,tracking,autofollow}` and `web/{components,lib,styles}/{previs,tracking,autofollow}*`. App boots cleanly, `GET /api/modules` returns `{ enabled: [] }`, no UI references dangle, no 500s in the log.
- [ ] **T30.11** `npm install --omit=optional` produces a working lean build with no `three`/`onnxruntime-node` on disk.

### Phase 4 — Shared conventions documented
- [x] **T30.12** Document the stage coordinate system, WS namespaces, settings key layout, and the registration API in `docs/MODULES.md` [NEW]. _(2026-04-21 — see [docs/MODULES.md](../docs/MODULES.md).)_
- [ ] **T30.13** Add a section to `AGENTS.md` / `README.md` explaining "Previs module is optional — see WO-30."

---

## Sub–work orders

- [**WO-17** — 3D Previs (PGM 2D/3D toggle)](./17_WO_3D_PREVIS.md): the in-PGM-panel 3D viewport, model import, screen-mapping.
- [**WO-19** — Person Tracking (YOLOv8-Pose + ByteTrack server-side)](./19_WO_PERSON_TRACKING.md): detection, persistent IDs, calibration, WS broadcast.
- [**WO-31** — Stage Auto-Follow (PTZ / Moving-Heads via Companion)](./31_WO_STAGE_AUTOFOLLOW_PTZ.md): lock-to-person, delta/absolute streaming, zone-exit home-return, per-device calibration.

All three are gated by this module. If WO-30 feature flag is off, none of them activate and none of their code is required on disk.

---

## Notes on rejected options

- **Build variants with separate entry points (Option B):** rejected — still keeps previs code in the base repo's build graph and complicates CI. Option A is lighter and meets the "easy to delete" goal better.
- **Workspace packages (Option C):** rejected for now — would require defining a stable plugin API surface we don't have yet. Could graduate there later; Option A's registry pattern is a natural subset of what a workspace plugin would export.
- **Git branch strip (Option D):** rejected — merges from `main` to a pruned branch are a known source of drift and bugs.
- **GPU frame-sharing from Caspar to the tracker:** there is **no public CasparCG fork** that exports CUDA / DMA-BUF frame handles to an external process. Building one would mean patching Caspar's consumer layer and writing an IPC surface for `onnxruntime-node` CUDA EP. Deferred; v1 uses FFmpeg → raw-frame UDP, which is well-trodden territory for the DMX sampling pipeline we already have.

---

## Work Log

### 2026-04-21 — Agent (Initial Work Order)

**Work Done:**
- Confirmed packaging direction with operator: runtime feature flag + isolated side-car directories, to make deletion trivial.
- Defined registration contract, directory boundary, shared coord system, WS namespaces, and installer split.
- Referenced sibling WOs (17, 19, 31) and updated them to hang off this umbrella.

**Status:** Work order created. Implementation pending.

**Instructions for Next Agent:** Start with T30.1–T30.4 to stand up the registry and boot hook before any module code is written. The deletion test (T30.9–T30.11) is the gating acceptance criterion — verify it after every phase.

### 2026-04-21 — Agent (Phase 1 — Module System Foundation)

**Work Done:**
- **T30.1** — Added `src/module-registry.js`. Public surface: `register`, `tryLoad`, `listNames`, `bootAll`, `shutdownAll`, `handleApi`, `describe`. Every method is per-module try/catch so a bad module never crashes core.
- **T30.2** — `index.js` now calls a small `loadOptionalModules(config, log)` helper after `appCtx` is built. Gate is `HIGHASCG_PREVIS=1` (env) or `config.features.previs3d === true`. It attempts `moduleRegistry.tryLoad('previs' | 'tracking' | 'autofollow')`; missing dirs log a single "skipped" warn and boot continues. `moduleRegistry.bootAll(appCtx)` runs after the WS server is attached so modules can use `appCtx._wsBroadcast`. `shutdownAll` runs inside the shutdown pipeline.
- **T30.3** — `src/api/routes-modules.js` responds to `GET /api/modules` with `{ enabled, bundles, styles, wsNamespaces }`. Wired into `src/api/router.js` right after the `/api/selection` ping.
- **Router module dispatch** — added once, **before** the `!ctx.amcp` 503 gate, so tracking/autofollow stay reachable when Caspar is offline. Modules that need AMCP check `ctx.amcp` themselves.
- **T30.4** — Added `web/lib/optional-modules.js` (`initOptionalModules`, `isModuleEnabled`, `getOptionalModuleState`). Fetches `/api/modules`, injects stylesheet `<link>`s, then dynamic-imports each bundle and awaits `default(sharedCtx)`. `web/app.js init()` fires it in parallel with the rest of bootstrap. Shared context = `{ stateStore, ws, api, sceneState, settingsState, streamState }`.
- **T30.5** — `package.json`: `three@^0.184.0` and `onnxruntime-node@^1.24.3` added to `optionalDependencies`. New scripts: `install:base` = `npm install --omit=optional`, `install:previs` = `npm install --include=optional`.
- **T30.12** — Wrote `docs/MODULES.md`: directory layout, enable flags, install scripts, registration API shape, WS namespace table, **stage coordinate system** (metres, right-handed, +X stage-right, +Y upstage, +Z up, floor = Z=0), and a deletion checklist.

**Smoke tests:**
- `HIGHASCG_PREVIS` unset → one info log, `listNames()` empty.
- `HIGHASCG_PREVIS=1` with module dirs missing → three "skipped" warns, boot continues, `listNames()` empty.
- Empty registry → `GET /api/modules` returns `{ enabled: [], bundles: [], styles: [], wsNamespaces: [] }` at `200`.
- Fake `tracking` module registered → `GET /api/modules` reflects it; `GET /api/tracking/persons` dispatches to the module even when `ctx.amcp` is null.
- Existing `/api/media` behaviour unchanged; unknown paths still hit the Caspar gate.

**Status:** Phase 1 landed. Phase 2 (installer split, smoke scripts) + Phase 3 (acceptance test automation) still pending.

**Instructions for Next Agent:** WO-30 Phase 1 is the gating dependency that unblocks WO-17, WO-19, WO-31. Any of those three is safe to start now — each just needs to create its `src/<name>/register.js` descriptor and an entry bundle served under `/assets/modules/<name>/entry.js`. Don't forget to add an `optionalDependencies` bump when the first actual `require('three')` / `require('onnxruntime-node')` lands.

---
*Work Order created: 2026-04-21 | Parent: 00_PROJECT_GOAL.md*
