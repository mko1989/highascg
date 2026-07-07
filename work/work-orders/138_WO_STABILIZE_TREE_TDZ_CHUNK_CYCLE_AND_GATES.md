# WO-138 — Stabilize working tree: TDZ chunk-cycle fix + verification gates

**Status:** In progress
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
- [ ] T138.1 Build unminified with maps: `npx vite build --sourcemap --minify false`; reload UI; record the real module/export behind minified `C` in the work log.
- [ ] T138.2 Run an import-graph cycle analysis over `client/**/*.js` (parse static `import ... from`, mirror the `manualChunks` function, list module cycles + cross-chunk edges). Paste the cycle list into the work log.

### Phase B — Fix chunk cycles in `vite.config.js` manualChunks
- [ ] T138.3 Route `lib/timeline-compose-preview.js` + `lib/timeline-program-canvas.js` correctly: add `/lib/timeline-` to the scenes rule, or move `components/preview-canvas-draw-base.js` + `preview-canvas-compose-snapshot.js` into the `shared` list.
- [ ] T138.4 Collapse remaining `main → scenes` edges by adding leafish helpers (`scenes-editor-support.js`, `scenes-shared.js`, `scenes-editor-logic.js`) to `shared`.
- [ ] T138.5 Plug `shared → main` leaks: add `lib/app-runtime.js`, `lib/scene-content-fit.js`, `lib/audio-channel-layouts.js` to `shared`.
- [ ] T138.6 Break the device-view 4-file module cycle: extract what `device-view-caspar-render-helpers.js` needs from `device-view-helpers.js` into a leaf module (e.g. `device-view-shared-utils.js`).
- [ ] T138.7 Where a main→scenes import is used only inside an event handler, dynamic `import()` is acceptable instead of re-chunking.

### Phase C — Verification gates (fix fallout as found)
- [ ] T138.8 `npm run verify:repo-integrity` green (broken require paths from server splits — fix immediately).
- [ ] T138.9 `npm run lint` green.
- [ ] T138.10 `node tools/ci/check-max-file-lines.js` — record current violation list in work log (feeds WO-140).
- [ ] T138.11 `npm run test:ci` green. Triage rule: re-run each failing file alone (`node --test <file>`); refactor breakage (aggregator lost an export) → fix the split; new-feature test issue → fix the feature.
- [ ] T138.12 Run never-executed smokes: `node --test tools/smoke/smoke-timeline-take.test.js tools/smoke/smoke-timeline-compose-preview.test.js tools/smoke/smoke-timeline-clip-layout.test.js tools/smoke/smoke-host-live-ndi.test.js tools/smoke/smoke-host-live-decklink.test.js tools/smoke/smoke-timeline-opacity-fade.test.js` — all green.
- [ ] T138.13 `npm run build:client` + `npm run format:check` green.

---

## 3. Acceptance criteria

- [ ] A138.1 Production build (`npm run build:client`) + hard reload of `http://<host>:4200` → zero console errors; scenes deck, timeline editor, device view, sources panel all render.
- [ ] A138.2 Cycle analysis re-run: zero module cycles; no bidirectional chunk pairs.
- [ ] A138.3 Gates green: verify:repo-integrity, lint, test:ci, build:client (command output pasted in work log — `wc -l`-style verification is NOT acceptance).
- [ ] A138.4 All work committed incrementally on the stabilization branch (no unstaged-only fixes).

## 4. Work log

- 2026-07-07 — WO created. Root cause pre-confirmed by import-graph analysis during triage. Snapshot `4caa156` + tag `wip-snapshot-2026-07-07` in place.
