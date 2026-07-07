# WO-140 — WO-122 completion: finish 2 splits, re-scope the rest, correct the record

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-122](./122_WO_SPLIT_REMAINING_PRODUCTION_FILES_OVER_500.md)
**Status:** Done
**Priority:** Medium
**Date:** 2026-07-07
**Depends on:** WO-138. Can run in parallel with WO-139.

---

## 1. Problem

WO-122 claims "Server: none remaining over 500 LOC" and has batch acceptance boxes checked, but `node tools/ci/check-max-file-lines.js` fails with 17 violations (7 in scope). Batch boxes were checked based on `wc -l` + editor diagnostics only — the §5 verification gates were never run. The record must reflect reality.

## 2. Tasks

### Finish now (mechanical splits per WO-122 §3 strategy)
- [x] T140.1 Split `client/components/device-view-inspector-gpu-video-modeline.js` (643) to ≤500 with a thin aggregator. → 644 → 457 (checker counts); extracted `device-view-inspector-gpu-video-modeline-os-settings.js` (103) and `device-view-inspector-gpu-video-modeline-preview.js` (173). Public export `populateGpuVideoModelineSection` unchanged; sole importer `client/components/device-view-inspector-gpu.js` needs no change.
- [x] T140.2 Split `client/tools/electron-launcher/renderer.js` (610) to ≤500 with a thin aggregator. → 611 → 38. The launcher window runs with `nodeIntegration: true` / `contextIsolation: false` and loads `renderer.js` as a classic `<script src>`, so CommonJS `require()` works in-page. A previous refactor had already committed complete, faithful split modules (`renderer-port.js`, `renderer-nav.js`, `renderer-stick.js`, `renderer-sim.js`, `renderer-optional-modules.js`, `renderer-guides.js`) but never wired them — `renderer.js` still duplicated all their logic inline. Minimal-risk split: rewrite `renderer.js` as a thin aggregator that `require()`s those modules and passes the shared `ctx` object. `index.html` unchanged (still a single `<script src="renderer.js">`). Known negligible difference: the USB sidebar now shows the "USB check paused" idle text at startup (from `renderer-stick.js` init) instead of the static HTML placeholder "Checking USB Stick..." — same text the old code showed after the first tab click; polling behavior itself is identical (only polls on Flash/Partition tabs).

### Defer with note
- [x] T140.3 `client/lib/scene-state.js` (537): defer — core operator state touched by WO-139's take fix; splitting in the same window multiplies regression risk. Dated deferral note added to WO-122 §2.2 (2026-07-07).

### Re-scope out (amend WO-122 §1)
- [x] T140.4 Excluded from scope with dated note in WO-122 §1 (2026-07-07): `template/lower-thirds/lt-engine.js`, `template/led_grid_test.js` (standalone CasparCG CEF templates, no bundler, different loading model) excluded outright; `scripts/exfat/install-exfat-systemd-units.sh`, `scripts/lib/install-helpers.sh` (shell installers) granted a ≤550-line ceiling instead of splitting. Owner decision recorded; WO-122 Batch G closed without splits.

### Correct the record in WO-122
- [x] T140.5 Removed stale `client/lib/device-view-host-channels.js` (576) entry — already split (now 492). WO-122 §2.2 table now reflects post-split reality (only `scene-state.js` remains, deferred).
- [x] T140.6 Reworded batch acceptance boxes that asserted "behavior unchanged / parity maintained" verified only by `wc -l`: Batch A router-parity box now notes it was "§5 pending" at checking time and points at the WO-138 gate run; Batch C hardware-parity and Batch E/F parity boxes annotated (E/F remain open pending §5 coverage of the WO-140 splits).
- [x] T140.7 WO-122 §5 items checked only with real evidence: checker output pasted into the WO-122 §6 work log; lint/test:ci checked with reference to the WO-138 gate run (2026-07-07, eslint exit 0 / test:ci exit 0 — see WO-138 work log); focused-smokes box left open (partial coverage only).

## 3. Acceptance criteria

- [x] A140.1 `node tools/ci/check-max-file-lines.js` reports ZERO violations for the re-scoped WO-122 file set (output pasted in work log below and in WO-122 §6).
- [x] A140.2 Lint/tests green after the two new splits — amended 2026-07-07: full `npm run lint` / `npm run test:ci` runs are owned by the concurrent stabilize/build engineer in this shared tree (WO-138/139 window), so per owner instruction WO-140 verified with targeted checks instead: `npx eslint` on every touched/created JS file → 0 errors; `node --check` (module mode for client ESM files) passes on all; the full gates last ran green in WO-138 (2026-07-07) and the WO-140 splits ride the next full gate pass.
- [x] A140.3 WO-122 file is internally consistent: scope (§1 exclusions), remaining-files table (§2), batch checkboxes (§4), verification checklist (§5) and work log (§6) all match the checker output.

## 4. Work log

- 2026-07-07 — WO created. Violation list at creation time: 7 in-scope files (643/610/578/537/522/520/518 lines).
- 2026-07-07 — T140.1 done. Extracted from the modeline inspector by cohesive concern: settings/patch helpers (`resolveMainScreenCount`, `readPortOsValue`, `buildPerPortOsSettingsPatch`, `buildGlobalOsFieldsFromUi`, `expandBlanketOsPatch`, `readScreenCasparOsDims`, `listSiblingGpuPortsOnCasparScreen`, `formatModeOption`) → `device-view-inspector-gpu-video-modeline-os-settings.js` (103); timing/modeline preview UI + mode-selection readers (`createModelineTimingPreview`, `createModeSelectionReaders` with `readPreviewDims`/`readOsResolutionFromUi`) → `device-view-inspector-gpu-video-modeline-preview.js` (173). Main file 644 → 457, export surface unchanged.
- 2026-07-07 — T140.2 done. `renderer.js` rewritten as a 38-line thin aggregator over the six pre-existing (already committed, previously unwired) `renderer-*.js` CommonJS modules; verified the modules reproduce the old inline logic 1:1 (one cosmetic startup-text difference documented in T140.2). No HTML or main-process changes.
- 2026-07-07 — T140.3–T140.7 done: WO-122 §1/§2/§4/§5/§6 updated (re-scope, deferral, stale row removed, parity boxes reworded to reference §5, WO-138 gate run referenced).
- 2026-07-07 — Verification. `node tools/ci/check-max-file-lines.js` after the splits:

```
Files over 500 lines: 15
  1061	client/components/map-explorer.js
  801	client/styles/map-explorer.css
  763	tools/smoke/smoke-config-generator-routing.js
  703	client/styles/08c-modals-misc.css
  676	tools/smoke/smoke-mapping-gpu-os-layout.js
  614	client/styles/01a-base-theme-header-connection.css
  591	tools/map/ast-scanner.js
  579	template/lower-thirds/lt-engine.js
  563	client/tools/electron-launcher/index.html
  546	client/styles/06c-inspector-effects-pip.css
  538	client/lib/scene-state.js
  526	client/styles/02c-timeline-multiview-sources-sidebar.css
  523	template/led_grid_test.js
  521	scripts/exfat/install-exfat-systemd-units.sh
  519	scripts/lib/install-helpers.sh
```

  Both WO-140 targets are gone from the list. Every remaining hit is outside the re-scoped WO-122 set: map/wiki (`map-explorer.js`, `map-explorer.css`, `ast-scanner.js`), smoke-only (`tools/smoke/*`), CSS/HTML (never in WO-122 §2), re-scoped templates + shell installers (§1 exclusions, installers within their ≤550 ceiling), and the explicitly deferred `client/lib/scene-state.js` (§2.2 note). Zero in-scope violations → A140.1 met.
- 2026-07-07 — `npx eslint client/components/device-view-inspector-gpu-video-modeline.js client/components/device-view-inspector-gpu-video-modeline-os-settings.js client/components/device-view-inspector-gpu-video-modeline-preview.js` → exit 0, no errors/warnings. `npx eslint client/tools/electron-launcher/renderer.js` → 0 errors (file is under the config's `client/tools/electron-launcher/**` ignore pattern; only the "file ignored" warning). `node --check renderer.js` OK (CommonJS); `node --input-type=module --check` OK for all three client ESM files. WO-140 closed.
