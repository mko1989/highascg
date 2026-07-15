# WO-221 — Split all code files exceeding the 500-line limit into smaller modules

**Status:** Planned
**Priority:** Medium (hygiene; owner rule: 500 LOC max across ALL code files incl. frontend CSS and templates)
**Date:** 2026-07-15
**Source:** owner loop directive 2026-07-15 ("check all highascg code files including frontend css and templates... write wo to split... spawn sonnet for it").

---

## 1. Census (2026-07-15, excludes node_modules/dist-web/vendor)

**Phase A — production client JS (7):** timer-control-panel.js 684, settings-modal-mount-hardware.js 672, scene-state.js 615, scenes-editor.js 543, scenes-compose.js 537, preview-canvas-draw-stacks.js 526, device-view-cables.js 516 (all under client/components|lib).
**Phase B — server (3):** index.js 515, src/engine/multiview-apply.js 502, src/api/router.js 502.
**Phase C — CSS (5):** styles/07b-audio-mixer-modal-shell.css 878, 08c-modals-misc.css 702, 01a-base-theme-header-connection.css 613, 06c-inspector-effects-pip.css 545, 02c-timeline-multiview-sources-sidebar.css 525. (Note: 01a already has partial splits 01a1/01a2/01a3 — CHECK whether 01a still duplicates their content or they are additive; dedupe as part of the split.)
**Phase D — templates (2):** template/lower-thirds/lt-engine.js 578, template/led_grid_test.js 522.
**Phase E — tools/tests (5, lowest value):** tools/smoke/smoke-config-generator-routing.js 762, smoke-mapping-gpu-os-layout.js 675, smoke-wo210-screen-timers.test.js 615, tools/map/ast-scanner.js 590, client/tools/electron-launcher/index.html 562.

## 2. Rules (non-negotiable)

- **Behavior-preserving mechanical extraction only** — move code, add imports/exports; zero logic changes. Follow the repo's established split patterns: JS → sibling `-<topic>.js` modules (cf. scene-take-lbg / -jobs / -merge / -helpers; audio-mixer-panel-* family); CSS → new numbered sheets + an `@import` line in [client/styles.css](../../client/styles.css) in the SAME cascade position (order matters).
- After EVERY file's split: node --check (or eslint for ESM), the full gate (`node tools/ci/run-offline-tests.js`), and `npx vite build` when client files changed. A split that changes any test outcome is wrong — revert and re-cut.
- Templates (Phase D) are LIVE Caspar CG assets: lt-engine.js is loaded by lower-third templates — verify how it is included (script src) before splitting; if splitting requires multiple script tags in template HTMLs, update every including template. led_grid_test.js is a test asset — lowest risk.
- Server Phase B: index.js and router.js are boot-critical — extract cohesive blocks (e.g. router.js: move the `/api/timers|countdown|system` registration clusters into `router-registrations-<domain>.js` functions called from router.js; index.js: extract the onAfterInfoConfigReady hooks into `src/engine/startup-hooks.js`). The registration EXECUTION ORDER must not change.
- Target: every touched file lands under 500 lines INCLUDING the new modules (do not create a new >500 file).

## 3. Tasks

- [x] T221.A Phase A (7 client JS files) — one sub-batch per file, gate+build between files. Done 2026-07-15.
- [ ] T221.B Phase B (3 server files).
- [ ] T221.C Phase C (5 CSS sheets, dedupe 01a vs 01a1-3).
- [ ] T221.D Phase D (2 templates).
- [ ] T221.E Phase E (5 tools/tests).
- [ ] T221.F Final: re-run the census command from §1 — zero files >500 outside node_modules/dist-web; full gate; vite build; work log updated with the new module map.

## 4. Acceptance criteria

- [ ] A221.1 Census clean (no code file >500 LOC); gates green; no behavior change (owner smoke on the UI).

## 5. Work log

- 2026-07-15 — WO created from census (22 files).
- 2026-07-15 — T221.A Phase A complete (7 client JS files). Re-measured before cutting — all 7 had grown since the original census (some other agent's edits landed on `timer-control-panel.js` and `settings-modal-mount-hardware.js` in the interim); no file was found already under 500. `settings-modal-mount-hardware.js` was re-read before every edit to check for concurrent-churn; it was stable (unchanged md5) at both checkpoints, so it was NOT skipped. Gate (`node tools/ci/run-offline-tests.js`: 210 pass / 2 skipped, unchanged) and `npx vite build` were run and stayed green after EVERY file (7/7 individual runs + 1 final combined run). `./node_modules/.bin/eslint --quiet` clean on every old+new file (0 errors; pre-existing unrelated warnings such as the dead `resolveSourceThumbnailUrl` import in scenes-compose.js and innerHTML-escape warnings were left untouched — out of scope for a mechanical split). No smoke needed updating: the WO-196/WO-210 smokes that source-grep `timer-control-panel.js` for `helpText`, `Screen timers`, `/api/timers/list`, `/api/timers/cmd`, `/api/timers/visible` were checked first and the extraction was deliberately routed around those literals (kept `refreshTimerList`/`onTimerAction`/`onToggleVisible` and the `helpText` constant in the main file); re-ran both smoke files directly after the cut (30/30 pass). The WO-223/B150 smokes that load `scene-state.js` directly (`smoke-look-preset-operator-bugs.test.js`) were also re-run directly (14/14 pass) since that file's split touched preset/timer/border method locations.

  Module map (old file LOC → new LOC, + new/extended sibling modules):
  - `client/components/device-view-cables.js` 517 → 298 + `device-view-cables-physics.js` 223 (new: cable Verlet-physics simulation + color hashing, `getCableColor`/`getOrBuild` exported).
  - `client/components/settings-modal-mount-hardware.js` 673 → 351 + `settings-modal-mount-hardware-summary.js` 327 (new: `renderHardwareSummary`/`formatBytes`, the System-pane hardware summary DOM builder).
  - `client/lib/scene-state.js` 616 → 409. Split via the mixin-into-prototype pattern already established (and documented in WO-114's log) by `scene-state-layer-ops.js` — that module existed on disk but had been silently un-wired (nothing imported `mixinSceneStateLayerOps`; the 6 methods it contained were duplicated directly on the class). Re-wired it (added `setLayerNumber`, previously missing) and extended the same pattern with 3 new sibling mixins: `scene-state-layer-ops.js` 94 → 101 (now actively used again: `nextLayerNumber`/`addLayer`/`removeLayer`/`reorderLayers`/`setLayerNumber`/`setLayerSource`/`patchLayer`/`setDefaultTransition`), `scene-state-global-border-ops.js` 53 (new: 8 global-border wrapper methods), `scene-state-preset-ops.js` 73 (new: 14 layer/look preset wrapper methods), `scene-state-timer-ops.js` 50 (new: 6 timer-instance wrapper methods, WO-208). All 4 mixins are called via `Object.assign(SceneState.prototype, {...})` right after the class body — behavior identical to defining the methods inline, just physically relocated; none of the new modules import `scene-state.js` back (no circular import).
  - `client/components/scenes-editor.js` 543 → 490 + `scenes-editor-deck-ingest.js` 60 (new: `ingestDeckDroppedFiles` deck-drop upload/poll-media-list helper, previously a closure with no state-store dependencies).
  - `client/components/scenes-compose.js` 537 → 409 + `scenes-compose-layer-thumb.js` 156 (new: `buildComposeLayerContent`/`makeLayerSourcePlaceholder`, the per-layer thumbnail/placeholder/live-thumb DOM builder used inside the compose layer loop).
  - `client/components/preview-canvas-draw-stacks.js` 526 → 378 + `preview-canvas-draw-placeholder.js` 160 (new: `drawPlaceholderFill`/`drawAudioOnlyPreviewFill`/`drawPreviewStatusText`/`sourceFallbackLabel`, pure canvas-drawing helpers shared by `drawSceneComposeStack` and `drawTimelineStack`).
  - `client/components/timer-control-panel.js` 691 → 470 + `timer-control-panel-display.js` 85 (new: `DEFAULT_TIMER_CONFIG`/`computeDisplayTime`/`formatDisplayTime`, pure no-DOM helpers) + `timer-control-panel-settings-form.js` 154 (new: `buildTimerSettings`, the per-timer settings-panel form builder, taking `refreshTimerList` as an injected dependency to avoid a circular closure).

  Gate/build results: `node tools/ci/run-offline-tests.js` → 212 tests, 210 pass, 0 fail, 2 skipped (unchanged from baseline; the 2 skips are pre-existing local-only tests gated behind `CI=1`). `npx vite build` → success after every file, no new warnings (the two `INEFFECTIVE_DYNAMIC_IMPORT` warnings are pre-existing and unrelated to Phase A). Nothing was skipped in Phase A.
