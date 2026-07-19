# WO-265 — CG Studio on the playout box: workspace tab in the operator GUI

**Status:** Implemented (owner acceptance A265.1 pending)
**Priority:** HIGH (owner request 2026-07-18, todos18.07.26)
**Depends on:** WO-32 (CG Studio module), WO-263/264 (Firefox holes + kiosk operator GUI), WO-30 (module registry)

## Owner intent (todos18.07.26)
"as we moved the main gui to be displayed on the server system, we can also add the cg studio to it. id like the cg studio to open in a new tab seperate from the main gui. but how can i easily change tabs while in fullscreen mode? will it also 'cut out' parts of the page in cg studio?"

## Owner questions — answered up front (drove the design)
1. **"How can I easily change tabs while in fullscreen mode?"** Real Firefox tabs are wrong here: `--kiosk` hides the tab strip entirely, so there is no visible affordance and no mouse path to switch. The GUI already has its own workspace tab bar (`activateTab`, `client/app.js:121-190` — device-view / scenes / multiview / pixelmap / timeline / audio-mixer). CG Studio becomes **another workspace tab** in that bar — switching is one click, exactly like every other view, and works identically over LAN and in the kiosk.
2. **"Will it also cut out parts of the page in cg studio?"** If CG Studio were a browser tab in the same kiosk window — **yes**. The shape helper (`tools/runtime/operator-shape-overlay.py`) punches holes in the **Firefox window** (matched by WM_CLASS + `HIGHASCG-OPERATOR-GUI` title marker), so every tab of that window inherits the holes; the server keeps holing wherever the last-reported rects were. As an in-app workspace tab the SPA controls the rects: preview surfaces withdraw when their view deactivates (surface map in `client/lib/operator-gui-mode.js:150-182` — absent surface = no rect), so the CG Studio tab shows **unshaped, fully clickable** Firefox. T265.4 verifies/enforces this.

## Ground truth (verified 2026-07-18, agent sweep)
- CG Studio today is **launcher-hosted only**: `src/cg-studio/register.js:2-22` is a stub descriptor that logs "not started on playout server". The real server is `src/cg-studio/studio-server.js` + `routes.js` (DEFAULT_PORT 4300, binds 127.0.0.1), UI in `src/cg-studio/public/` (`index.html` 61 lines, `app.js` 277 lines, `studio.css`). Electron launcher starts/opens it via `client/tools/electron-launcher/main-cg-studio.js` (synced copy under the launcher tree).
- Studio API today (its own :4300 origin): `GET /api/health`, `GET /api/templates`, `GET /api/templates/:id?category=`, `POST /api/export` (`routes.js:45-94`); static `/` → public/index.html, `/studio-assets/` → repo `template/` (`routes.js:104-109`). Export writes `template/studio/lt-<name>.html`, picked up by `src/api/routes-lower-thirds.js:33,69,80-82`.
- Main server extension points: unmatched `/api/*` falls through to `moduleRegistry.handleApi` (`src/api/router.js:448`); static mounts via `vendorDirs` map prefix→dir in `serveWebApp` (`src/server/http-server.js:66-71,99-129`, previs/grapesjs precedent), dirs assembled in `index.js:360-369`.
- Module invariant (WO-32): core never imports `src/cg-studio/*` directly — everything goes through the `register.js` descriptor (`src/module-registry.js:1-24`).
- Workspace tabs: `client/app.js` `activateTab` toggles `.workspace__tabs .tab` / `#tab-<name>` panes, persists `localStorage['highascg_active_tab']`, dispatches `highascg-workspace-tab-activated`.
- Shape-rect withdrawal: per-surface map (`compose`/`timeline`/`mvedit`) in `operator-gui-mode.js`; empty report deletes the surface; empty merged set → `DELETE /api/operator-gui/layout` → helper restores Firefox unshaped (`operator-shape-overlay.py` empty-rects branch).

## Design

**T265.1 — serve CG Studio from the playout :4200 process (module descriptor, no second port)**
Flesh out `src/cg-studio/register.js`:
- `apiPathPrefixes: ['/api/cg-studio']`, `handleApi` adapter that maps `/api/cg-studio/health|templates|templates/:id|export` onto the existing handler logic in `routes.js` (refactor `routes.js` so its handler bodies are exported pure-ish functions taking `(ctx, params, body)`; the :4300 standalone server and the adapter both call them — no logic duplication, standalone/Electron path keeps working).
- `staticMounts: { '/cg-studio/': path.join(__dirname, 'public') }` — NEW generic descriptor field; `index.js` merges every loaded module's `staticMounts` into the `vendorDirs` map it already passes to `serveWebApp` (core touches only the registry API, invariant preserved).
- `index.js` boot: `tryLoad('cg-studio')` alongside the other optional modules (it is deletable — tryLoad swallows a missing dir).

**T265.2 — base-path adaptation of `public/`**
`public/app.js` fetches `/api/templates` etc. against its own origin. Parameterize: detect mount (`location.pathname.startsWith('/cg-studio/')`) → API base `/api/cg-studio`; else legacy `/api` (standalone :4300 unchanged). Asset/`/studio-assets/` references: keep working on :4200 by adding `/studio-assets/` → `template/` to the same staticMounts. All refs in `index.html` must be relative so they resolve under `/cg-studio/`.

**T265.3 — "CG Studio" workspace tab (lazy iframe)**
- New tab button in the workspace tab bar + `#tab-cg-studio` pane in `client/index.html`.
- New `client/components/cg-studio-tab.js`: on first `highascg-workspace-tab-activated` with `tab === 'cg-studio'`, create `<iframe src="/cg-studio/">` filling the pane; keep it alive across switches (studio state survives). Availability-gate: `GET /api/cg-studio/health` on boot — hide the tab button when the module isn't loaded (mirror how module webBundles gate UI; check `GET /api/modules`).
- Styles: pane is `position:relative`, iframe `absolute inset:0 border:0` — scoped in `client/styles/` per house pattern.

**T265.4 — shape-hole safety on tab switch (the "cut out" guarantee)**
- Verify by grep+read that each rect-reporting surface withdraws (reports empty) when its view deactivates on `highascg-workspace-tab-activated`. Record findings in the work log.
- Belt-and-braces regardless: in `operator-gui-mode.js` add `setForegroundTabBlocksVideo(blocked)` (same semantics as `setInteractionSuppressed` but a separate latch so a modal closing can't unsuppress it); `cg-studio-tab.js` sets it on activate, clears on deactivate. Cheap, testable, and immune to a future surface forgetting its deactivate handler.

**T265.5 — offline smokes** (`tools/smoke/smoke-wo265-cg-studio-tab.test.js`, curated gate)
- Descriptor shape: name, apiPathPrefixes, staticMounts point at an existing dir; `handleApi` health/templates round-trip with a stubbed ctx (no sockets).
- Adapter/legacy parity: same handler functions reachable from both path styles.
- `client/index.html` contains the tab button + pane; `cg-studio-tab.js` lazy-iframe logic as pure fns where possible.
- Suppression latch: modal suppress→restore cycle while tab-latch held keeps merged set empty.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm install, no vite build (orchestrator runs it), curated gate ONLY (`node tools/ci/run-offline-tests.js`), NEVER the full suite. `node --check` + repo-local `./node_modules/.bin/eslint --quiet` on touched files; exact gate counts; <500 lines/file (split adapters if needed); tabs + JSDoc house style; honest checkboxes. Electron-launcher synced copy (`client/tools/electron-launcher/cg-studio/`) is regenerated by `sync-cg-studio.sh` — do NOT hand-edit it; note in log if a resync is needed.

- [x] T265.1 register.js descriptor: handleApi adapter + staticMounts + plugin-catalog load
- [x] T265.2 public/ base-path adaptation (:4200 mount + :4300 legacy both work)
- [x] T265.3 CG Studio workspace tab with lazy iframe + availability gate
- [x] T265.4 surface-withdrawal verification + foreground-tab video latch
- [x] T265.5 smokes in curated gate
- [ ] A265.1 (owner) live: kiosk GUI → click CG Studio tab → full studio visible with NO video holes, fully clickable; switch back → previews hole through again; export from the tab → template appears in lower-thirds list; LAN browser gets the same tab

## Work log

**2026-07-18 — implemented (all offline tasks).**
- T265.1 `src/cg-studio/register.js` is now a real descriptor: `apiPathPrefixes ['/api/cg-studio']` with a `toStudioPath` adapter onto the existing `handleStudioApi` (newly exported from `routes.js` — no logic duplication, :4300 standalone path untouched); `staticMounts { '/cg-studio/': public, '/studio-assets/': template }` via a NEW generic `moduleRegistry.collectStaticMounts()` (first prefix wins, duplicates warn) merged into `buildVendorDirs` (`src/bootstrap/modules.js`) — core only touches the registry API, WO-32 invariant preserved. Loading: new `cg-studio` entry in `PLUGIN_CATALOG` (`src/plugins/plugin-manager.js`), **enabled by default** (`features.cgStudio !== false`, env `HIGHASCG_CG_STUDIO` overrides both ways) — deliberate deviation from the opt-in plugins per owner intent (studio tab on every box; module is static-files + template scan, no heavy deps). `context.configure()` runs at require time with `REPO_ROOT/template`.
- T265.2 `public/index.html` asset refs made relative; `public/app.js` gets `API_BASE` (path-detected: `/cg-studio/` mount → `/api/cg-studio`, else `/api`). `previewUrl`/`thumbnail` are absolute `/studio-assets/...` and now resolve on both origins. CSP check: `security-headers.js` allows `'unsafe-inline'` + `frame-ancestors 'self'` — studio UI and template previews render fine under the main server's headers. Launcher bundle resynced via `sync-cg-studio.sh` (needed `HIGHASCG_SERVER_ROOT=<repo>`; its candidate list doesn't find this checkout on its own — future cleanup candidate).
- T265.3 `client/components/cg-studio-tab.js` — injects tab button + pane dynamically (core `index.html` untouched for disabled boxes), gated on `isModuleEnabled('cg-studio')` after `initOptionalModules` (wired in `app.js`); iframe created on first activation (`/cg-studio/index.html` — NOTE not `/cg-studio/`: the vendorDirs mount 404s a bare prefix), kept alive across switches.
- T265.4 verification: compose (scenes) and timeline previews in operator mode run `initOperatorComposeTiles`, whose root `ResizeObserver` → `layoutAll` → `reportRectsNow` fires when the pane goes display:none; zero-size body rects are then dropped by `cellRectsToLayoutCells` (width>0 guard) ⇒ empty report ⇒ surface withdrawn. MV editor withdraws explicitly on zero wrap rect. (A first-pass subagent read claimed scenes/timeline never withdraw — traced the actual chain and that is wrong; RO + zero-filter covers them.) So the latch is belt-and-braces as designed, NOT load-bearing. Latch: `setForegroundTabBlocksVideo` in `operator-gui-mode.js`, a separate `_tabBlocked` flag beside popup suppression (modal close over the studio tab can't restore holes); every send path now goes through `effectiveCells()`.
- T265.5 `tools/smoke/smoke-wo265-cg-studio-tab.test.js` (13 tests: descriptor shape + adapter round-trips incl. 404/400 paths, collectStaticMounts merge/dup/invalid, plugin default-on + both opt-outs, dual-origin source asserts, latch source asserts) — registered in the curated gate after wo264.
- Carried risk: none new at runtime for non-operator boxes (module default-on serves static files only). The kiosk iframe experience (fonts, dialog element sizing at 1080p) is A265.1's to judge live.
