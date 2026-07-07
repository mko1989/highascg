# WO-122 — Split remaining production files over 500 lines (non-map)

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)
**Status:** In progress
**Priority:** High
**Date:** 2026-07-07

**Constraint accepted by owner:** LAN-wide access and passwordless API-triggered system actions are intentional and in-scope.

---

## 1. Scope

This WO targets only current **project/runtime-impact** files still above 500 LOC.

Out of scope for this WO:
- Map/wiki entity files (for example map explorer and map tooling).
- Smoke/test-only files under `tools/smoke/`.
- Third-party, build, cache, and generated artifacts.

**Re-scoped out (2026-07-07, WO-140 — owner decision):**
- `template/lower-thirds/lt-engine.js` and `template/led_grid_test.js` — standalone CasparCG CEF templates: no bundler, different loading model (self-contained files loaded directly by the CasparCG HTML producer). Splitting them would change how the template is delivered/loaded for no runtime benefit.
- `scripts/exfat/install-exfat-systemd-units.sh` and `scripts/lib/install-helpers.sh` — shell installers, barely over the limit; granted a ≤550-line ceiling instead of splitting into more source-able fragments.

---

## 2. Remaining files to split (updated 2026-07-07 by WO-140; checker line counts)

### 2.1 Server (`src/`)

None remaining over 500 LOC.

### 2.2 Client (`client/`)

| Lines | File | Status |
|------:|------|--------|
| 538 | `client/lib/scene-state.js` | Deferred (see note below) |

Resolved since the original scan:
- `client/components/device-view-inspector-gpu-video-modeline.js` 644 → 457 (split by WO-140, 2026-07-07).
- `client/tools/electron-launcher/renderer.js` 611 → 38 (split by WO-140, 2026-07-07).
- `client/lib/device-view-host-channels.js` — stale entry (listed at 576); it was already split (now 492) before this table was corrected. Removed by WO-140 (2026-07-07).

> **Deferral note (2026-07-07, WO-140):** `client/lib/scene-state.js` (538) is core operator state being touched by the concurrent WO-139 take-smoothness work; splitting it in the same window multiplies regression risk. Splitting is deferred to a follow-up batch after WO-139 lands.

### 2.3 Scripts / template

Re-scoped out on 2026-07-07 by WO-140 — see §1 exclusions (standalone CEF templates; shell installers granted a ≤550 ceiling). No remaining in-scope entries.

---

## 3. Split strategy (mandatory)

- Split by cohesive concern, not by arbitrary line ranges.
- Keep public API stable via thin aggregator/re-export files.
- No behavior changes unless fixing a clearly documented bug.
- Add/update smoke tests only where extraction changes behavior boundaries.
- Each extracted module should target 120-350 LOC where practical.

---

## 4. Execution batches

### Batch A — Server route aggregators (highest leverage)

Targets:
- `src/api/routes-scene.js`
- `src/api/routes-streaming-channel.js`
- `src/api/routes-data.js`
- `src/api/routes-replication.js`
- `src/api/routes-mixer.js`

Planned splits:
- Route-specific handler modules (`*-take`, `*-preview`, `*-border`, `*-rtmp`, `*-record`, `*-project`, `*-post`, `*-get`, etc.).
- Shared parsing/response helpers in local `*-shared.js` modules.

Acceptance:
- [x] Each file <= 500 LOC.
- [x] Router behavior unchanged from caller perspective — originally checked from `wc -l` + editor diagnostics only (§5 pending at the time of checking); the §5 gates were subsequently run green by WO-138 on 2026-07-07 (see §5).

### Batch B — Server core/runtime internals

Targets:
- `src/engine/timeline-playback.js`
- `src/engine/project-scenes.js`
- `src/replication/replication-service.js`
- `src/caspar/amcp-client.js`
- `src/media/live-thumbnail-cache.js`
- `src/audio/alsa-mixer.js`

Planned splits:
- Transport/client logic, lifecycle/control, parsing, and state/store concerns separated.

Acceptance:
- [x] Each file <= 500 LOC.
- [x] Existing tests and runtime flows remain green — verified by the WO-138 gate run on 2026-07-07 (see §5).

Progress:
- [x] `src/replication/replication-service.js` 546 -> 255
- [x] `src/engine/timeline-playback.js` 571 -> 274
- [x] `src/engine/project-scenes.js` 563 -> 274
- [x] `src/caspar/amcp-client.js` 505 -> 54
- [x] `src/media/live-thumbnail-cache.js` 527 -> 10
- [x] `src/audio/alsa-mixer.js` 559 -> 9

### Batch C — Server config/hardware utilities

Targets:
- `src/config/build-caspar-generator-config.js`
- `src/config/decklink-output-resolve.js`
- `src/utils/os-config.js`
- `src/utils/gpu-topology-drm.js`

Planned splits:
- Discovery/probing, transformation, command build/apply, and validation modules.

Acceptance:
- [x] Each file <= 500 LOC.
- [ ] Hardware/config output parity verified — §5 gates ran green via WO-138 (2026-07-07), but no dedicated hardware parity check has been run on real DeckLink/GPU hardware; left open.

Progress:
- [x] `src/config/build-caspar-generator-config.js` 589 -> 494
- [x] `src/config/decklink-output-resolve.js` 554 -> 11
- [x] `src/utils/os-config.js` 524 -> 38
- [x] `src/utils/gpu-topology-drm.js` 502 -> 11

### Batch D — Client scenes/timeline/editor state

Targets:
- `client/components/scenes-editor.js`
- `client/components/scene-list.js`
- `client/components/preview-canvas-panel.js`
- `client/components/timeline-editor.js`
- `client/lib/timeline-state.js`
- `client/lib/scene-state.js`

Planned splits:
- View rendering, actions/events, and selectors/state utilities.

Acceptance:
- [ ] Each file <= 500 LOC — `client/lib/scene-state.js` (538) deferred to a follow-up batch per the §2.2 deferral note (2026-07-07, WO-140); all other Batch D targets are ≤ 500.
- [ ] No UI regressions in scene take/edit/timeline workflows.

Progress:
- [x] `client/components/scenes-editor.js` 680 -> 496
- [x] `client/components/scene-list.js` 612 -> 267
- [x] `client/components/preview-canvas-panel.js` 660 -> 492
- [x] `client/lib/timeline-state.js` 621 -> 298
- [x] `client/components/timeline-editor.js` 580 -> 498

### Batch E — Client device view and inspectors

Targets:
- `client/components/device-view-inspector-gpu-video-modeline.js`
- `client/components/device-view-inspector-decklink.js`
- `client/components/device-view-destinations-inspector-form.js`
- `client/lib/device-view-host-channels.js`

Planned splits:
- Form schema/defaults, validation, API adapter, and renderer components.

Acceptance:
- [x] Each file <= 500 LOC (2026-07-07, WO-140 — checker output in §6 work log).
- [ ] Device view save/apply parity maintained — §5 pending for the WO-140 modeline split of 2026-07-07 (earlier Batch E splits covered by the WO-138 gate run, see §5).

Progress:
- [x] `client/components/device-view-inspector-decklink.js` 571 -> 68
- [x] `client/components/device-view-destinations-inspector-form.js` 535 -> 309
- [x] `client/components/device-view-inspector-gpu-video-modeline.js` 644 -> 457 (WO-140, 2026-07-07)
- [x] `client/lib/device-view-host-channels.js` — already split (492); stale 576 entry removed from §2.2 (WO-140, 2026-07-07)

### Batch F — Client modal/mixer/inspector + launcher

Targets:
- `client/components/logs-modal.js`
- `client/components/live-input-modal.js`
- `client/components/audio-mixer-panel.js`
- `client/components/audio-mixer-view-console.js`
- `client/components/inspector-panel.js`
- `client/components/inspector-lower-third.js`
- `client/tools/electron-launcher/renderer.js`

Acceptance:
- [x] Each file <= 500 LOC (2026-07-07, WO-140 — checker output in §6 work log).
- [ ] Operator workflows remain unchanged — §5 pending for the WO-140 launcher renderer split of 2026-07-07 (earlier Batch F splits covered by the WO-138 gate run, see §5).

Progress:
- [x] `client/components/live-input-modal.js` 577 -> 363
- [x] `client/components/inspector-panel.js` 546 -> 489
- [x] `client/components/audio-mixer-panel.js` 553 -> 149
- [x] `client/components/audio-mixer-view-console.js` 539 -> 124
- [x] `client/components/inspector-lower-third.js` 549 -> 342
- [x] `client/components/logs-modal.js` 570 -> 419
- [x] `client/tools/electron-launcher/renderer.js` 611 -> 38 (WO-140, 2026-07-07 — thin aggregator wiring the previously committed but unused `renderer-*.js` modules)

### Batch G — Scripts/template

**Re-scoped out on 2026-07-07 by WO-140** — see §1 exclusions (standalone CEF templates keep their single-file loading model; the two shell installers are granted a ≤550-line ceiling instead of splitting). Batch G is closed without splits.

Original targets (for the record):
- `scripts/lib/install-helpers.sh`
- `scripts/exfat/install-exfat-systemd-units.sh`
- `template/led_grid_test.js`

---

## 5. Verification checklist

> **Note (2026-07-07):** the batch acceptance boxes above were originally checked from `wc -l` + editor diagnostics only, before any of these gates had run. WO-138 (2026-07-07) then ran the full gates green — repo integrity OK, `npx eslint . --quiet` exit 0, `npm run test:ci` exit 0, client build OK — see the WO-138 work log ([138_WO_STABILIZE_TREE_TDZ_CHUNK_CYCLE_AND_GATES.md](./138_WO_STABILIZE_TREE_TDZ_CHUNK_CYCLE_AND_GATES.md)) for the fallout fixed en route. The WO-140 splits of 2026-07-07 (modeline, launcher renderer) landed after that gate run and were verified with targeted checks only (checker + eslint on touched files); they ride the next full gate pass.

- [x] `node tools/ci/check-max-file-lines.js` has no violations for in-scope files (2026-07-07, WO-140 — output pasted in §6 work log; remaining checker hits are out of scope per §1: map/wiki, smokes, CSS/HTML, re-scoped templates and shell installers, plus the deferred `client/lib/scene-state.js` per §2.2).
- [x] `npm run lint` — run green by WO-138, 2026-07-07 (eslint exit 0, 0 errors).
- [x] `npm run test:ci` — run green by WO-138, 2026-07-07 (exit 0).
- [ ] Focused smokes for touched areas (scene/timeline/device-view/replication as applicable) — partially covered by WO-138 (4/6 new smokes green; the 2 failing ones encode WO-139 target behavior); no device-view-specific smoke exists for the WO-140 modeline split.

---

## 6. Work log

### 2026-07-07 — Created

- Created WO-122 from current >500 LOC scan and filtered to production-impact files only.
- Excluded map/wiki and smoke/test files per owner instruction.
- **Instructions for next agent:** Execute Batch A first (API route aggregators), then rerun line-count checker and update this WO with completed tasks and before/after LOC per file.

### 2026-07-07 — Batch A completed (routes)

- Refactored the five targeted API route aggregators to thin delegators over existing split modules:
	- `src/api/routes-scene.js` 640 -> 27
	- `src/api/routes-streaming-channel.js` 628 -> 45
	- `src/api/routes-data.js` 593 -> 42
	- `src/api/routes-replication.js` 555 -> 7
	- `src/api/routes-mixer.js` 529 -> 226
- Added missing split handler export path for preview clear by implementing/exporting `handlePreviewLiveClear` in `src/api/routes-scene-preview.js`.
- Validation:
	- `wc -l` confirms all Batch A target files are now under 500 LOC.
	- Editor diagnostics report no errors in touched files.
- **Instructions for next agent:** Start Batch B with `src/replication/replication-service.js` and `src/engine/timeline-playback.js`, then update Section 2 with refreshed remaining over-500 list.

### 2026-07-07 — Batch B partial completed (core/runtime)

- Reduced and validated additional Batch B files:
	- `src/replication/replication-service.js` 546 -> 255
	- `src/engine/timeline-playback.js` 571 -> 274
	- `src/engine/project-scenes.js` 563 -> 274
	- `src/caspar/amcp-client.js` 505 -> 54
- Refactor pattern used: thin aggregators delegating to existing split modules with stable exports.
- Validation:
	- `get_errors` reports no diagnostics in touched files.
	- `wc -l` confirms the four files above are below 500 LOC.
- Remaining Batch B targets over 500:
	- none

### 2026-07-07 — Batch B completed (core/runtime)

- Completed remaining Batch B files with thin aggregator delegation over existing split modules:
	- `src/media/live-thumbnail-cache.js` 527 -> 10
	- `src/audio/alsa-mixer.js` 559 -> 9
- Validation:
	- `get_errors` reports no diagnostics in touched ALSA and thumbnail modules.
	- `wc -l` confirms all Batch B targets are now <= 500 LOC.
- Refreshed in-scope >500 file list (excluding map/wiki and generated/third-party directories).

### 2026-07-07 — Batch C completed (server config/hardware utilities)

- Reduced all Batch C targets to <= 500 LOC using split-module delegation with stable exports:
	- `src/config/build-caspar-generator-config.js` 589 -> 494
	- `src/config/decklink-output-resolve.js` 554 -> 11
	- `src/utils/os-config.js` 524 -> 38
	- `src/utils/gpu-topology-drm.js` 502 -> 11
- Validation:
	- `get_errors` reports no diagnostics in touched config/utils modules.
	- `wc -l` confirms all Batch C targets are below 500 LOC.
- Refreshed in-scope >500 list now contains only client, template, and script targets.

### 2026-07-07 — Batch D partial completed (client scenes/timeline)

- Reduced and validated one Batch D target:
	- `client/components/scenes-editor.js` 680 -> 496
- Reduced and validated additional Batch D target:
	- `client/components/scene-list.js` 612 -> 267
- Reduced and validated additional Batch D targets:
	- `client/components/preview-canvas-panel.js` 660 -> 492
	- `client/lib/timeline-state.js` 621 -> 298
	- `client/components/timeline-editor.js` 580 -> 498
- Refactor pattern used: delegated duplicated logic into existing helper modules:
	- `client/components/scenes-editor-layer-route.js`
	- `client/components/scenes-editor-deck-drop.js`
	- `client/components/scenes-editor-deck-thumb.js`
	- `client/components/scenes-editor-preview-actions.js` (new)
	- `client/components/scene-list-column.js`
	- `client/components/preview-canvas-destination-overlay.js`
	- `client/components/timeline-editor-playback.js` (new)
	- `client/lib/timeline-state-model.js`
	- `client/lib/timeline-state-clips.js`
	- `client/lib/timeline-state-keyframes.js`
- Validation:
	- `get_errors` reports no diagnostics in touched client modules.
	- `wc -l` confirms reduced Batch D files are now <= 500 LOC.

### 2026-07-07 — Batch F partial completed (client modal)

- Reduced and validated one Batch F target:
	- `client/components/live-input-modal.js` 577 -> 363
- Refactor pattern used: extracted submit/action handler into a focused helper:
	- `client/components/live-input-modal-submit.js` (new)
- Validation:
	- `get_errors` reports no diagnostics in touched live-input modal modules.
	- `wc -l` confirms `client/components/live-input-modal.js` is now <= 500 LOC.

### 2026-07-07 — Batch F partial completed (inspector panel)

- Reduced and validated one Batch F target:
	- `client/components/inspector-panel.js` 546 -> 489
- Refactor pattern used: extracted live-source event wiring into focused helper:
	- `client/components/inspector-panel-live-source-events.js` (new)
- Validation:
	- `get_errors` reports no diagnostics in touched inspector panel modules.
	- `wc -l` confirms `client/components/inspector-panel.js` is now <= 500 LOC.

### 2026-07-07 — Batch F partial completed (audio mixer panel)

- Reduced and validated one Batch F target:
	- `client/components/audio-mixer-panel.js` 553 -> 149
- Refactor pattern used: delegated section rendering to existing split modules:
	- `client/components/audio-mixer-panel-masters.js`
	- `client/components/audio-mixer-panel-live-inputs.js`
	- `client/components/audio-mixer-panel-input-layers.js`
- Validation:
	- `get_errors` reports no diagnostics in touched audio mixer panel modules.
	- `wc -l` confirms `client/components/audio-mixer-panel.js` is now <= 500 LOC.

### 2026-07-07 — Batch F partial completed (audio mixer console)

- Reduced and validated one Batch F target:
	- `client/components/audio-mixer-view-console.js` 539 -> 124
- Refactor pattern used: delegated rendering to existing split modules:
	- `client/components/audio-mixer-console-masters.js`
	- `client/components/audio-mixer-console-live-inputs.js`
	- `client/components/audio-mixer-console-input-groups.js`
- Validation:
	- `get_errors` reports no diagnostics in touched audio mixer console modules.

### 2026-07-07 — Batch E partial completed (decklink inspector)

- Reduced and validated one Batch E target:
	- `client/components/device-view-inspector-decklink.js` 571 -> 68
- Refactor pattern used: delegated IO sections to existing split modules:
	- `client/components/device-view-inspector-decklink-input.js`
	- `client/components/device-view-inspector-decklink-output.js`
	- `client/components/device-view-inspector-decklink-shared.js`
- Validation:
	- `get_errors` reports no diagnostics in touched DeckLink inspector modules.
	- `wc -l` confirms `client/components/device-view-inspector-decklink.js` is now <= 500 LOC.

### 2026-07-07 — Batch F partial completed (logs modal)

- Reduced and validated one Batch F target:
	- `client/components/logs-modal.js` 570 -> 419
- Refactor pattern used: delegated filter/category utilities and dropdown wiring:
	- `client/components/logs-modal-filter.js`
- Validation:
	- `get_errors` reports no diagnostics in touched logs modal modules.
	- `wc -l` confirms `client/components/logs-modal.js` is now <= 500 LOC.

### 2026-07-07 — Batch E partial completed (destinations inspector form)

- Reduced and validated one Batch E target:
	- `client/components/device-view-destinations-inspector-form.js` 535 -> 309
- Refactor pattern used: extracted host-channel / virtual destination branch to focused helper:
	- `client/components/device-view-destinations-inspector-host-channel.js` (new)
- Validation:
	- `get_errors` reports no diagnostics in touched destinations inspector modules.
	- `wc -l` confirms `client/components/device-view-destinations-inspector-form.js` is now <= 500 LOC.
	- `wc -l` confirms `client/components/audio-mixer-view-console.js` is now <= 500 LOC.

### 2026-07-07 — Batch F partial completed (lower-third inspector)

- Reduced and validated one Batch F target:
	- `client/components/inspector-lower-third.js` 549 -> 342
- Refactor pattern used: delegated shared concerns to existing split modules:
	- `client/components/inspector-lower-third-templates.js`
	- `client/components/inspector-lower-third-roster.js`
- Validation:
	- `get_errors` reports no diagnostics in touched lower-third inspector modules.
	- `wc -l` confirms `client/components/inspector-lower-third.js` is now <= 500 LOC.

### 2026-07-07 — WO-140: final splits, re-scope, record corrected

- Split the two remaining in-scope client files (WO-140):
	- `client/components/device-view-inspector-gpu-video-modeline.js` 644 -> 457 — extracted `device-view-inspector-gpu-video-modeline-os-settings.js` (103, settings/patch helpers) and `device-view-inspector-gpu-video-modeline-preview.js` (173, timing preview UI + mode-selection readers); public export `populateGpuVideoModelineSection` unchanged (single importer `device-view-inspector-gpu.js` untouched).
	- `client/tools/electron-launcher/renderer.js` 611 -> 38 — rewrote as a thin CommonJS aggregator wiring the previously committed but unused `renderer-{port,nav,stick,sim,optional-modules,guides}.js` modules (launcher runs with `nodeIntegration: true`, classic `<script>` + `require()` works; `index.html` unchanged).
- Corrected §2 tables (stale `device-view-host-channels.js` 576 entry removed — already split to 492), added the §1 re-scope exclusions and the `scene-state.js` deferral note, and reworded batch acceptance boxes that had asserted parity before §5 ran.
- Validation — `node tools/ci/check-max-file-lines.js` after the splits (2026-07-07):

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

	Every remaining hit is out of scope per §1 (map/wiki, smokes, CSS/HTML, re-scoped templates and shell installers) or explicitly deferred (`client/lib/scene-state.js`, §2.2). Zero in-scope violations.
- `npx eslint` on all touched/created JS files: 0 errors; `node --check` (module mode for client files) passes on all.
