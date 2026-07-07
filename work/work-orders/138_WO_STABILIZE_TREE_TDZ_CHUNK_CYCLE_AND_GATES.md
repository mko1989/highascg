# WO-138 — Stabilize working tree: TDZ chunk-cycle fix + verification gates

**Status:** Done (2026-07-07) — two aspirational smokes carried to WO-139 (see work log)
**Priority:** Critical (UI is blocked from loading)
**Date:** 2026-07-07
**Depends on:** none (first, blocking). Snapshot exists: branch `wip/2026-07-07-pre-stabilize`, tag `wip-snapshot-2026-07-07`, commit `4caa156`.
**Blocks:** WO-139, WO-140, WO-141.

---

## 1. Problem

The operator UI fails to load with:

```
Uncaught (in promise) ReferenceError: can't access lexical declaration 'C' before initialization
  assets/scenes-DBJwBo4f.js:106  (called from main-*.js)
```

**Root cause (confirmed):** circular Rollup chunk imports. The new `client/lib/timeline-compose-preview.js` and `client/lib/timeline-program-canvas.js` land in the `main` chunk (the `manualChunks` rule in `vite.config.js` only matches `/components/timeline-`, not `/lib/timeline-`) while importing `components/preview-canvas-*` / `components/scenes-editor-logic.js`, which land in the `scenes` chunk. `main ↔ scenes` becomes a chunk cycle → TDZ crash. The config's own comment (vite.config.js ~line 350) documents this exact failure mode.

Additional confirmed cycles:
- `shared` chunk leaks back into `main` (3 edges): `lib/api-client.js → lib/app-runtime.js`, `lib/editor-defaults-constants.js → lib/scene-content-fit.js`, `lib/program-audio-layouts.js → lib/audio-channel-layouts.js`.
- One true 4-file module cycle inside device-view: `components/device-view-helpers.js → lib/device-view-gpu-port-list.js → lib/device-view-gpu-port-entries.js → components/device-view-caspar-render-helpers.js → components/device-view-helpers.js`.
- ~24 `main → scenes` edges total (offenders imported by main-chunk files: `components/scenes-editor-support.js`, `scenes-shared.js`, `scenes-editor-logic.js`).

Separately, the entire Jul 5–7 working tree (WO-122 splits + host-live/timeline features, ~144 modified + 33 untracked files) was never verified: no lint, no test:ci, no smokes.

---

## 2. Tasks

### Phase A — Diagnose (confirm before fixing)
- [x] T138.1 Build unminified with maps: `npx vite build --sourcemap --minify false`; reload UI; record the real module/export behind minified `C` in the work log.
- [x] T138.2 Run an import-graph cycle analysis over `client/**/*.js` (parse static `import ... from`, mirror the `manualChunks` function, list module cycles + cross-chunk edges). Paste the cycle list into the work log.

### Phase B — Fix chunk cycles in `vite.config.js` manualChunks
- [x] T138.3 Route `lib/timeline-compose-preview.js` + `lib/timeline-program-canvas.js` correctly: their scenes-chunk deps were hoisted (`preview-canvas-draw-base.js` + `ui-font.js` → shared); both libs stay in `main` legitimately. `preview-canvas-compose-snapshot.js` NOT hoisted (dependency closure cascades into main via `compose-preview-url.js` → `look-stack-amcp-channel.js`) — see work-log decision.
- [x] T138.4 ~~Collapse remaining `main → scenes` edges by hoisting `scenes-editor-support.js` / `scenes-shared.js` / `scenes-editor-logic.js`~~ — REJECTED after analysis: their dependency closures (scene-state, program-output-state, pip-overlay-registry, lower-third-cg-data, …) would create new `shared → main` leaks. The residual main↔scenes bidirectionality (21/88 edges) is the pre-existing architecture (app.js statically imports view chunks) and shipped fine for months; the actual crash was an intra-module bug (see log).
- [x] T138.5 Plug `shared → main` leaks: added `lib/app-runtime.js`, `lib/scene-content-fit.js`, `lib/audio-channel-layouts.js` to `shared`. shared→main edge count now **0** (leaf-only shared chunk).
- [x] T138.6 Broke the device-view module cycle (7 files, not 4): extracted `normRandrCaspar` into new leaf `client/lib/device-view-randr-norm.js`; redirected imports in `device-view-helpers.js` + 4 `lib/device-view-gpu-port-*.js`; kept a re-export in `device-view-caspar-render-helpers.js` for the other 4 importers. Module-cycle count: 7-file SCC eliminated.
- [x] T138.7 Not needed — no re-chunking required beyond the above.

### Phase C — Verification gates (fix fallout as found)
- [x] T138.8 `npm run verify:repo-integrity` → `[check-require-integrity] OK` (after removing 11 untracked Syncthing `*.sync-conflict-*` project JSONs + 1 stray `.bak`; all preserved in snapshot `4caa156`). **No broken require paths — the ~30 server splits are wire-intact.**
- [x] T138.9 `npx eslint . --quiet` → exit 0 (zero errors; 1938 warnings are pre-existing WO-112/113/114 debt). Fixed en route: parse error `src/engine/project-scenes.js` (duplicate `enrichProjectScenesFromLiveDeck` left behind by split — removed leftover body, import wins); deleted stale untracked `client/dist/` old build artifact that was polluting lint.
- [x] T138.10 `node tools/ci/check-max-file-lines.js` → 17 total violations; in-scope for WO-122/140: `device-view-inspector-gpu-video-modeline.js` 644, `electron-launcher/renderer.js` 611, `lt-engine.js` 579, `scene-state.js` 538, `led_grid_test.js` 523, `install-exfat-systemd-units.sh` 521, `install-helpers.sh` 519.
- [x] T138.11 `npm run test:ci` → exit 0. One failure fixed: `smoke-os-config-persist.test.js` read the source of `src/utils/os-config.js` for patterns that the split moved to `os-config-xrandr-apply.js` — test repointed (refactor-breakage class).
- [x] T138.12 4 of 6 new smokes green (`smoke-timeline-clip-layout`, `smoke-timeline-compose-preview`, `smoke-host-live-ndi`, `smoke-host-live-decklink`). **`smoke-timeline-take` + `smoke-timeline-opacity-fade` FAIL by design**: they assert a batch/DEFER frame-locked opacity schedule (`OPACITY 0 0` preset + `OPACITY 1 13 linear DEFER`) that the engine does not implement yet — that IS WO-139's target behavior (current impl uses per-call `mixerOpacity`). Carried to WO-139 as its acceptance tests.
- [x] T138.13 `npm run build:client` ✓ (262ms) + `npm run format:check` → "All matched files use Prettier code style!"

---

## 3. Acceptance criteria

- [x] A138.1 Production build + headless Puppeteer load of `http://127.0.0.1:4200` → **0 JS errors** while navigating Timelines / Media / Templates / Live tabs. (Remaining 404s are server-state: `/api/usb/drives`, stale timeline ids, `ch2_direct.jpg` thumbnail → WO-144.)
- [x] A138.2 Cycle analysis re-run: device-view SCC eliminated; `shared → main` edges 0. One benign same-chunk module cycle remains (`audio-channel-layouts ↔ program-audio-layouts`, function-only references, both in `shared`) — documented, not TDZ-capable. Residual main↔scenes / main↔device-view chunk bidirectionality is pre-existing architecture (decision T138.4).
- [x] A138.3 Gates green: repo-integrity OK, eslint 0 errors, test:ci exit 0, build ✓, format ✓ (outputs in Phase C boxes above).
- [x] A138.4 All work committed on `wip/2026-07-07-pre-stabilize`.

## 4. Work log

- 2026-07-07 — WO created. Root cause pre-confirmed by import-graph analysis during triage. Snapshot `4caa156` + tag `wip-snapshot-2026-07-07` in place.
- 2026-07-07 — **Actual root cause was simpler than the chunk-cycle hypothesis.** Unminified build + headless Puppeteer revealed: `ReferenceError: Cannot access 'getPlayback' before initialization` at `initTimelineEditor` — an **intra-module TDZ** in `client/components/timeline-editor.js`: the WO-122 split extracted the playback runtime to `timeline-editor-playback.js` and left the `const { getPlayback, … } = createTimelinePlaybackRuntime(…)` destructuring ~25 lines BELOW a `createTimelineCanvasHandlers({ …, getPlayback, … })` object literal that reads it eagerly. Every sibling property was already lazily wrapped (`getView: () => view`) — only `getPlayback` was passed bare. Fix: `getPlayback: () => getPlayback()`.
- 2026-07-07 — Two more split casualties found by headless navigation + gates:
  1. `syncSendToWithChannelMap is not defined` in `timeline-editor.js` — function stayed local inside `createTimelineTransport` after the transport split; exposed it on the transport API and added it to the editor's destructuring.
  2. `escapeHtml is not defined` in `sources-panel-helpers.js` — the file re-exports it (`export { escapeHtml } from '../lib/dom-escape.js'`, which creates NO local binding) while using it in a template literal at line 185; added the proper import.
  3. Parse error `src/engine/project-scenes.js` (duplicate function vs import declaration — split leftover body removed).
  4. `smoke-os-config-persist.test.js` repointed to `os-config-xrandr-apply.js` (source-introspection test vs moved code).
- 2026-07-07 — Chunk hygiene: `shared` list extended (+app-runtime, scene-content-fit, audio-channel-layouts, ui-font, preview-canvas-draw-base) → shared is now leaf-only (0 back-edges); device-view 7-file cycle broken via new `lib/device-view-randr-norm.js` leaf. Hoisting `scenes-editor-*`/`scenes-shared` REJECTED (closure cascade) — recorded as deliberate scope decision.
- 2026-07-07 — Housekeeping under this WO: removed 11 untracked Syncthing `*.sync-conflict-*` project JSONs + `install-exfat-systemd-units.sh.bak` + stale `client/dist/` (all recoverable from snapshot `4caa156`).
- 2026-07-07 — Smokes: 4/6 new smokes green; `smoke-timeline-take` + `smoke-timeline-opacity-fade` encode WO-139's target batch/DEFER behavior (not-yet-implemented) → adopted as WO-139 acceptance tests. WO-138 closed.
