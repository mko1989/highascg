# Sweep 1: files over 500 lines (code / CSS / HTML)

**Project root:** `highascg/` (this repo)  
**Generated:** 2026-05-18  
**Rule:** Line count `> 500` (strictly greater than 500), counted with `wc -l`.

## Included extensions

`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.vue`, `.css`, `.scss`, `.less`, `.html`, `.htm`

## Excluded paths (pruned)

- `node_modules/`
- `.git/`
- `dist/`, `build/`, `coverage/`

*(`.cursor/` was not pruned in the find; no matches there.)*

---

## Split module trees (`wc -l`)

Refactors that broke one entry file into several modules (line counts from `wc -l`). **Latest first.**

### `playback-tracker` (Caspar playback matrix)

```text
src/state/
├── playback-tracker.js           141   matrix mutations + reconcile + `module.exports` (same API for `require('../state/playback-tracker')`)
├── playback-tracker-media.js     188   clip id matching; `resolveClipDurationMs`, disk/CINF probes
└── playback-tracker-osc.js       199   OSC snapshot matrix, occupied layers, clip-end fade delay helper
```

### `multiview-editor-canvas` (browser multiview layout editor)

```text
client/components/
├── multiview-editor-canvas.js           24   barrel; same exports as before (`multiview-editor.js`, `inspector-fill.js`)
├── multiview-editor-canvas-layout.js   230   overlay typing, contained video rect, aspect / dimension solves
├── multiview-editor-canvas-interaction.js   86   canvas fit, hit-testing, resize handles
├── multiview-editor-canvas-draw.js     177   `drawMultiviewEditor` (2D chrome + cells + labels)
└── multiview-editor-canvas-apply.js     93   `applyMultiviewLayout`, `applyMultiviewAudioFocus`
```

### `routes-system-hardware` (WO-39 system hardware HTTP)

```text
src/api/
├── routes-system-hardware.js       38   entry; `hardwareHandleGet` / `hardwareHandlePost` → delegates only
├── system-hardware-nvidia.js      233   pool scan, `GET /api/system/gpu-nvidia`, `POST /api/system/gpu-nvidia/apply`
├── system-hardware-decklink.js     73   `GET /api/system/decklink` + DeckLink/log merge + updater path
├── system-hardware-gui.js         156   GUI binary resolve + `spawnGuiDetached`, `POST /api/system/gui-launch`
└── system-hardware-gpu-ports.js    82   `POST /api/system/gpu-ports-reset` (`xrandr` HDMI/DP pairs)
```

### `settings-modal` (browser settings overlay)

```text
client/components/
├── settings-modal.js                   308   entry; `showSettingsModal`, optional tabs, tab activation, nuclear + NVIDIA apply / GUI launch, plugins pane, autosave / hydrate
└── settings-modal-mount-hardware.js    275   media mount + exFAT sync table + USB tab listeners; NVIDIA pool summary / branch select; DeckLink summary; destructive mount confirm overlay
```

*(Existing pieces remain: `settings-modal-templates.js`, `settings-modal-logic.js`, `settings-modal-caspar-collect.js`, etc. — not part of this split tree.)*

### `scene-state` (browser look / layer store)

```text
client/lib/
├── scene-state.js                   446   entry; `SceneState` + `sceneState` singleton + re-exports from `scene-state-helpers.js` (public API unchanged)
├── scene-state-global-border.js     163   per-screen global border read/write + preset slots (`sceneState*` helpers)
└── scene-state-preset-actions.js    142   layer clipboard, layer/look presets, server preset import helpers
```

*(Existing helpers remain: `scene-state-helpers.js`, `scene-state-persistence-logic.js`, `scene-state-layer-logic.js`, `scene-state-look-logic.js` — not part of this split tree.)*

### `multiview_overlay` (Caspar multiview CG overlay)

```text
template/
├── multiview_overlay.html    13   shell; `<link href="multiview_overlay.css">` + `<script src="multiview_overlay.js">` (CG template name unchanged)
├── multiview_overlay.css    238   Rewir font, cells, labels, PGM/PRV/decklink chrome, timer dock layout
└── multiview_overlay.js     390   WebSocket live state, `update()` cell DOM, `tick` + `window.update` / `window.play`
```

### `device-view-caspar-render` (Device View — Caspar rear panel)

```text
client/components/
├── device-view-caspar-render.js                      338   entry; `renderCasparBand` (unchanged export for `device-view-bands-render.js`)
├── device-view-caspar-render-helpers.js               78   RandR / GPU canonical id, kind title + icon, `createCasparRearMarkerStatusResolver`
├── device-view-caspar-render-gpu-doc-listeners.js     83   document `gpu-layout-changed` / `gpu-layout-save` / `gpu-layout-export`
└── device-view-caspar-render-markers.js              294   `buildCasparRearMarkerLayoutItems`, `appendCasparRearPanelMarkers` (markers, drag/drop, cable dots)
```

### `device-view-inspector-gpu` (Device View — GPU output inspector)

```text
client/components/
├── device-view-inspector-gpu.js                  342   entry; `renderGpuOutControls` (unchanged export for `device-view-inspectors.js`)
├── device-view-inspector-gpu-resolve.js           34   `resolveGpuScreenNumber(conn, lastPayload)` — screen index from binding / graph / suggested order
├── device-view-inspector-gpu-layout-editor.js    193   edit-mode GPU layout drag/drop, localStorage, export/load, xrandr reset
└── device-view-inspector-gpu-video-modeline.js   411   video mode + inherited source, EDID/xrandr row, timing + modeline preview, patch builders, “use detected display mode”
```

### `scene-take-lbg` (server PGM take — `runSceneTakeLbg`)

```text
src/engine/
├── scene-take-lbg.js                   295   entry; `module.exports = { runSceneTakeLbg }` unchanged for callers
├── scene-take-lbg-amcp-pipeline.js     313   global border CG lines + LOADBG / MIXER / PLAY / PIP / crossfade + clip-end fades
├── scene-take-lbg-merge.js             131   merge outgoing opacity defer, `buildMergeMixerExtrasForTake`, `logPlannedCommand`
├── scene-take-lbg-teardown.js          124   fade wait + STOP/CLEAR exits + dual border clear + COMMIT
├── scene-take-lbg-playlist.js          285   `setupLayerPlaylists`, OSC playlist advance, image timers, preload
└── scene-take-lbg-jobs.js              248   unchanged — `buildTakeJobs` (uses `scene-take-lbg-helpers.js`)
```

### `scenes-preview-runtime` (browser PRV preview)

```text
client/components/scenes-preview-runtime.js   300
client/lib/scenes-preview-push-scene.js       365
client/lib/scenes-preview-global-border.js    263
client/lib/scenes-preview-look-stack.js        83
client/lib/scenes-preview-snapshot.js          73
```

### `inspector-panel-views` (shorthand)

`inspector-panel-views.js` (44) + `inspector-scene-layer.js` (229) + `inspector-layer-playlist.js` (305) + `inspector-global-border.js` (399) + `inspector-channel-resolution.js` (12) — full table in § Split progress below.

---

## Summary

| Metric | Value |
|--------|------:|
| **Files matching** | **0** *(same exclusion rules as below — **`> 500`** threshold cleared on **`multiview-editor-canvas`** + **`playback-tracker`** splits, 2026-05-18)* |
| **Largest (listed)** | — *(none above 500)* |
| **Largest under `src/` or `client/` or `template/`** | — *(none above 500)* |
| **Last verified** | **2026-05-18** — `find` + `wc -l`; **0** paths **`> 500`** *(prunes: `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `cef-cache/`, `work/`)* |

---

## Approaching the threshold *(optional watchlist)*

Largest files under **`src/`**, **`client/`**, **`template/`** at **≥ 430** lines (**2026-05-18**) — rerun counts before refactoring; **`09a-device-view-layout-destinations.css`** / **`scenes-editor.js`** / **`routes-mixer.js`** are nearest **500**.

| Lines | Path |
|------:|------|
| 496 | `client/styles/09a-device-view-layout-destinations.css` |
| 496 | `client/components/scenes-editor.js` |
| 496 | `src/api/routes-mixer.js` |
| 491 | `src/media/local-media.js` |
| 488 | `client/components/inspector-panel-timeline.js` |
| 485 | `src/config/defaults.js` |
| 481 | `template/led_grid_test.js` |
| 481 | `src/system/exfat-sync.js` |
| 480 | `src/utils/os-layout-calculator.js` |
| 477 | `client/components/timeline-canvas.js` |
| 475 | `client/lib/timeline-state.js` |
| 473 | `client/components/preview-canvas-draw-stacks.js` |
| 465 | `client/components/scene-list.js` |
| 463 | `client/components/usb-import-modal.js` |

---

## Findings (sorted by line count, descending)

*(No paths **`> 500`** lines under the app-only scan — excluding **`cef-cache/`**, **`work/**`** — after **`multiview-editor-canvas`** + **`playback-tracker`** modularization.)*

---

## Grouped interpretation

### Application/runtime (primary maintenance surface)

*(No **`> 500`** files in this snapshot.)* Earlier splits covered settings modal, scene state, device-view bands/inspector GPU, scene take LBG, multiview overlay/template routes, **`routes-system-hardware`**, **`multiview-editor-canvas`**, and **`playback-tracker`** — see § Split module trees + § Split progress.

Anything under **`work/`** is excluded from this sweep table.

### Reference / vendored / cache (lower priority for “split this module”)

*(No `> 500` line matches under `.reference/` in this workspace snapshot; add rows back when vendored trees are present.)*

---

## Split progress: `inspector-panel-views.js` (2026-05-18)

**Goal:** Bring the inspector entrypoint under 500 lines and isolate maintainable units.

**Done:**

| New file | Lines (`wc -l`) | Role |
|----------|----------------:|------|
| `client/components/inspector-panel-views.js` | 44 | Multiview + look title shells; **re-exports** `renderSceneLayerInspector`, `getResolutionForScreen`, `renderGlobalBorderInspector`. |
| `client/components/inspector-channel-resolution.js` | 12 | `getResolutionForScreen(stateStore)` for active main program resolution. |
| `client/components/inspector-scene-layer.js` | 229 | Look **layer** inspector: style clipboard, fill/mixer/template/effects/PIP, take override, delegates playlist UI. |
| `client/components/inspector-layer-playlist.js` | 305 | **Playlist / list mode** UI (single vs list, dropzone, reorder, transitions). |
| `client/components/inspector-global-border.js` | 399 | **Global border** inspector (type, fade, mirror PRV, params, presets, slices, Art-Net table). |

**Imports:** `client/components/inspector-panel.js` unchanged — it still imports the same four symbols from `inspector-panel-views.js` (re-exported).

**Follow-up (optional):** `inspector-global-border.js` (399) and `inspector-layer-playlist.js` (305) remain largest inspector chunks; no mandatory **`> 500`** sweep targets until something grows past the threshold again.

---

## Split progress: `multiview_overlay.html` (2026-05-18)

**Goal:** Bring the Caspar multiview CG overlay under 500 lines and keep the HTML entry name stable for `CG ADD multiview_overlay` / `PLAY [html] multiview_overlay`.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `template/multiview_overlay.html` | 13 | Thin shell: links `multiview_overlay.css`, loads `multiview_overlay.js`, `#container` root. |
| `template/multiview_overlay.css` | 238 | Styles: Rewir `@font-face`, cell geometry, label/timer chrome (PGM/PRV/decklink colours, progress bar, layers list). |
| `template/multiview_overlay.js` | 390 | WebSocket `/api/ws`, OSC merge, `update(json)` layout, `tick` timer UI, `window.update` / `window.play`. |

**Deploy:** `src/api/routes-multiview.js` auto-deploy (when `local_media_path` is set) now copies **`multiview_overlay.css`** and **`multiview_overlay.js`** next to **`multiview_overlay.html`** so relative `href` / `src` resolve on the Caspar template path.

---

## Split progress: `scene-state.js` (2026-05-18)

**Goal:** Bring the browser scene / look store under 500 lines without changing the `SceneState` / `sceneState` public surface.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/lib/scene-state.js` | 446 | `SceneState` class: persistence wiring, screens, scenes, layers, live/preview IDs, exports + `sceneState` singleton. |
| `client/lib/scene-state-global-border.js` | 163 | `sceneStateGetGlobalBorderForScreen`, `sceneStateSetGlobalBorderForScreen`, PRV snapshot + preset slot helpers, per-look `setGlobalBorder`. |
| `client/lib/scene-state-preset-actions.js` | 142 | Layer style clipboard, layer/look preset CRUD + patch, server preset imports. |

**Imports:** All existing `import { sceneState } from '…/scene-state.js'` paths unchanged — only `scene-state.js` is the entry module.

**Follow-up (optional):** Watch **`device-view-inspector-gpu-video-modeline.js`** (411) if it grows past **500** lines.

---

## Split progress: `settings-modal.js` (2026-05-18)

**Goal:** Bring the settings modal entry under 500 lines without changing `showSettingsModal` imports (`app.js`, `header-bar.js`, `device-view.js`).

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/components/settings-modal.js` | 308 | `showSettingsModal`: optional tabs injection, tab activation + lazy optional panes, nuclear actions, NVIDIA branch apply + `guiLaunch`, DeckLink GUI buttons, plugins list/add/toggles/restart, autosave + `Logic.buildSettingsPayload` / hydrate. |
| `client/components/settings-modal-mount-hardware.js` | 275 | `refreshMediaMountPanel`, `refreshExfatSyncPanel`, `refreshSystemHardwarePanel`, `refreshDecklinkPanel`, `openMediaMountDestructiveConfirm`, `wireMediaUsbMountListeners` (refresh / dry-run / apply with `settingsState.load`). |

**Imports:** Public API unchanged — only `./settings-modal.js` exports `showSettingsModal`.

**Follow-up (optional):** Watch **`device-view-inspector-gpu-video-modeline.js`** (411) if it grows past **500** lines.

---

## Split progress: `device-view-caspar-render.js` (2026-05-18)

**Goal:** Bring the Caspar rear-panel renderer under 500 lines and isolate GPU layout document listeners, marker layout math, and marker DOM (drag/drop, tooltips, cable dots).

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/components/device-view-caspar-render.js` | 338 | `renderCasparBand`: band shell, connector lists, slot column DOM, edit toggles, apply GPU, builds marker list and delegates marker append. |
| `client/components/device-view-caspar-render-helpers.js` | 78 | `normRandrCaspar`, `resolveCanonicalGpuConnectorId`, `casparRearKindTitle`, `casparRearKindToIcon`, `createCasparRearMarkerStatusResolver`. |
| `client/components/device-view-caspar-render-gpu-doc-listeners.js` | 83 | Binds `gpu-layout-changed` / `gpu-layout-save` / `gpu-layout-export` on `document` (updates overlay markers + localStorage / download). |
| `client/components/device-view-caspar-render-markers.js` | 294 | `buildCasparRearMarkerLayoutItems`, `appendCasparRearPanelMarkers` (DeckLink/GPU drag reorder, REF row, selection / armed styling). |

**Imports:** `client/components/device-view-bands-render.js` still imports `renderCasparBand` from `./device-view-caspar-render.js` only (public API unchanged).

**Follow-up (optional):** Watch **`device-view-inspector-gpu-video-modeline.js`** (411) if it grows past **500** lines.

---

## Split progress: `device-view-inspector-gpu.js` (2026-05-18)

**Goal:** Bring the GPU output inspector under 500 lines and isolate screen-index resolution, edit-mode layout UI, and video mode / EDID / modeline logic.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/components/device-view-inspector-gpu.js` | 342 | `renderGpuOutControls`: consumer toggles, save/apply/reset, advanced panel wiring; delegates layout + video/modeline modules. |
| `client/components/device-view-inspector-gpu-resolve.js` | 34 | `resolveGpuScreenNumber(conn, lastPayload)` — same rules as graph layout screen index. |
| `client/components/device-view-inspector-gpu-layout-editor.js` | 193 | Edit-mode GPU layout editor (drag reorder, port selects, save/export/load, `resetGpuLayout`). |
| `client/components/device-view-inspector-gpu-video-modeline.js` | 411 | Video mode + inherited producer, xrandr/NVIDIA backend select, EDID mode list, override + timing preview, `buildOutputPatchFromSelection` / `buildOsOutputPatchForApply`, “use detected display mode”. |

**Imports:** `client/components/device-view-inspectors.js` still imports `renderGpuOutControls` from `./device-view-inspector-gpu.js` only (public API unchanged).

**Follow-up (optional):** Optional further split of `device-view-inspector-gpu-video-modeline.js` (411) if it grows past **500** lines.

---

## Split progress: `scenes-preview-runtime.js` (2026-05-18)

**Goal:** Shrink the PRV preview runtime entrypoint under 500 lines and isolate preview push / border / look-stack helpers.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/components/scenes-preview-runtime.js` | 300 | Factory: debounced queue, `pushSceneToPreview` wrapper, clear PRV bus, snapshot prime, border debounce; wires `createScenesPreviewGlobalBorder`. |
| `client/lib/scenes-preview-look-stack.js` | 83 | `PREVIEW_SCENE_LAYER_MIN`, timeline constants, matrix / occupied-layer sets, `resolvePreviewAmcpChannel`. |
| `client/lib/scenes-preview-snapshot.js` | 73 | `buildPreviewContentSnapshot`, `layerContentMetaForSnapshot`, `isGeometryOnlyPreview`. |
| `client/lib/scenes-preview-push-scene.js` | 365 | `pushSceneToPreviewImpl` — AMCP batching for look layers, PIP overlays, border slots via injected `border.*` callbacks. |
| `client/lib/scenes-preview-global-border.js` | 263 | `createScenesPreviewGlobalBorder`: PGM/PRV border slots, preset recall, `pushBorderOnlyNow`, meta map updates. |

**Imports:** Only consumer remains `client/components/scenes-editor.js` → `createScenesPreviewRuntime` (public API unchanged).

---

## Split progress: `scene-take-lbg.js` (2026-05-18)

**Goal:** Bring the PGM LOADBG take entrypoint under 500 lines and isolate AMCP pipeline, merge helpers, teardown, and playlist automation.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `src/engine/scene-take-lbg.js` | 295 | `runSceneTakeLbg` orchestration: diff, exit fades, `buildTakeJobs`, merge extras, pipeline + teardown + playlist hook. |
| `src/engine/scene-take-lbg-amcp-pipeline.js` | 313 | Incoming border CG + take `LOADBG` / mixer / PIP / bank crossfade / `PLAY` / browser CG / clip-end `fadeWatcher` scheduling. |
| `src/engine/scene-take-lbg-merge.js` | 131 | `resolveGlobalBorderPhysicalLayer`, merge outgoing opacity defer, `buildMergeMixerExtrasForTake`, `logPlannedCommand`. |
| `src/engine/scene-take-lbg-teardown.js` | 124 | Post-take STOP/CLEAR (+ PIP strips) and dual global border clear after fade window. |
| `src/engine/scene-take-lbg-playlist.js` | 285 | `setupLayerPlaylists` and OSC/image-timer playlist continuation. |

**Imports:** `require('../engine/scene-take-lbg')` in `routes-scene.js` / `routes-project.js` unchanged — only `runSceneTakeLbg` is exported.

**Follow-up (optional):** Optional further splits in `scene-take-lbg-amcp-pipeline.js` (313) or related take helpers if needed; multiview overlay + **device-view** Caspar/GPU + **scene-state** + **settings-modal** + **`routes-system-hardware`** + **`multiview-editor-canvas`** splits are complete — **no app-only files exceed 500 lines** in this snapshot.

---

## Notes: `scene-take-lbg.js` vs `scenes-preview-runtime.js` (why large, performance)

**`src/engine/scene-take-lbg.js` (~295 lines; helpers in `scene-take-lbg-*.js`)** — **server-side program take** (`runSceneTakeLbg`): Caspar **LOADBG + MIXER + PLAY** pipeline for look-to-look transitions on **PGM** (and similar). Heavy AMCP sequencing lives in **`scene-take-lbg-amcp-pipeline.js`**; merge-only mixer extras in **`scene-take-lbg-merge.js`**; post-take cleanup in **`scene-take-lbg-teardown.js`**; list-mode playlist / OSC in **`scene-take-lbg-playlist.js`**. **`scene-take-lbg-jobs.js`** still builds `takeJobs`. **PRV behaviour is orchestrated in** `src/api/routes-scene.js` around `runSceneTakeLbg`.

**`client/components/scenes-preview-runtime.js` (~300 lines; helpers in `client/lib/scenes-preview-*.js`)** — **browser-side PRV preview**: debounced queue, `pushSceneToPreview` AMCP batches (see `scenes-preview-push-scene.js`), **same layer numbers as PGM**, global border on PRV mirror layer, PIP overlay AMCP, incremental vs full pushes. Logic was large for parity with PGM; it now lives mostly in **`pushSceneToPreviewImpl`** plus border / look-stack modules.

**Performance:** Both paths are already **batched AMCP** (`batchSend` / `postAmcpPreviewPipeline`) and avoid unnecessary PLAY when geometry-only changes (preview). The heavy cost is **intrinsic** (many layers × commands). Further wins are structural (smaller modules, fewer redundant INFO round-trips on the client), not a single “faster API” switch.

**PRV-after-PGM-take (product, 2026-05-18):** After the **PGM** look transition **finishes**, **PRV** should be **fully cleared** (occupied look-stack layers stopped), then the **previous PGM look** rebuilt on PRV **with `forceCut` / no transition** — implemented in `routes-scene.js` + `clearSceneProgramLookStackLayers` (preview channels now contribute live-scene layer hints for clearing). Mid-PGM callback `onProgramTransitionStarted` is no longer used for this exchange so PRV work does not race the PGM mix.

---

## Split progress: `09b-device-view-connectors-inspector.css` (2026-05-18)

**Goal:** Shrink the large device-view stylesheet (595 lines) under 500 lines and modularize hardware rendering, cable overlays, and the inspector sidebar.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/styles/09b-device-view-connectors-inspector.css` | 4 | Backward-compatibility forwarder sheet importing sub-sheets. |
| `client/styles/09b1-device-view-connectors-overlay.css` | 188 | Cable overlay lines, rear panel marker dots, active/target glow states, and affordances. |
| `client/styles/09b2-device-view-backpanel-hardware.css` | 134 | Hardware backpanel, band grids, metal slot titles, and connector layout rows. |
| `client/styles/09b3-device-view-inspector-sidebar.css` | 179 | Sidebar inspector panel, KV details, status indicators, stream badges, and media queries. |

**Imports:** Updated `client/styles/09-device-view.css` directly to import `09b1`, `09b2`, and `09b3` for clean, modular rendering.

---

## Split progress: `routes-system-hardware.js` (2026-05-18)

**Goal:** Bring the WO-39 system-hardware API router under **500** lines by isolating NVIDIA pool/apply, DeckLink GET, GUI launch allow-list, and `xrandr` GPU-port hinting.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `src/api/routes-system-hardware.js` | 38 | `hardwareHandleGet` / `hardwareHandlePost` only — same exports for `router.js` |
| `src/api/system-hardware-nvidia.js` | 233 | Pool scan, `GET /api/system/gpu-nvidia`, `POST /api/system/gpu-nvidia/apply` |
| `src/api/system-hardware-decklink.js` | 73 | `GET /api/system/decklink` |
| `src/api/system-hardware-gui.js` | 156 | Binary resolution, detached spawn, `POST /api/system/gui-launch` |
| `src/api/system-hardware-gpu-ports.js` | 82 | `POST /api/system/gpu-ports-reset` |

**Imports:** `routes-system-hardware.js` re-`require`s the four helpers; **`router.js` unchanged** (still `require('./routes-system-hardware')`).

---

## Split progress: `multiview-editor-canvas.js` (2026-05-18)

**Goal:** Bring the multiview editor canvas module under **500** lines without changing its public exports (`multiview-editor.js`, `inspector-fill.js`).

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `client/components/multiview-editor-canvas.js` | 24 | Re-export barrel only |
| `client/components/multiview-editor-canvas-layout.js` | 230 | PGM/PRV overlay typing, contained rects, resolution suffix, aspect / resize solves |
| `client/components/multiview-editor-canvas-interaction.js` | 86 | `fitInContainer`, coordinate transforms, outer rect / hit-test / resize handles |
| `client/components/multiview-editor-canvas-draw.js` | 177 | `drawMultiviewEditor` |
| `client/components/multiview-editor-canvas-apply.js` | 93 | `applyMultiviewLayout`, `applyMultiviewAudioFocus` |

**Imports:** Call sites keep **`from './multiview-editor-canvas.js'`** — API unchanged.

---

## Split progress: `routes-multiview.js` (2026-05-18)

**Goal:** Shrink the multiview route controller (540 lines) under 500 lines by separating layout calculations, coordinate adjustments, aspect fill formulas, and CasparCG overlay templates.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `src/api/routes-multiview.js` | 290 | Endpoint handler (`POST /api/multiview/apply`), body parser, auto-deploy logic, BG solid layer, cell rendering loops, and overlay packaging. |
| `src/api/multiview-layout-helper.js` | 185 | Screen/source type inference, coordinate containing math, label suffix formatters, and CG ADD/PLAY overlay template loading. |

**Imports:** Replaced local layout helpers with `require('./multiview-layout-helper')` imports.

**Note (2026-05-18):** Multiview overlay auto-deploy also copies `multiview_overlay.css` and `multiview_overlay.js` with `multiview_overlay.html` (see § Split progress: `multiview_overlay.html`).

---

## Split progress: `playback_timers.js` (2026-05-18)

**Goal:** Shrink the playback timer page controller (525 lines) under 500 lines by separating WS data selectors, formatting helpers, and timer layer traversal.

**Done:**

| File | Lines (`wc -l`) | Role |
|------|----------------:|------|
| `template/playback_timers.js` | 277 | WebSocket lifecycle, dynamic font size configuration, PGM/PRV screen grid DOM drawing, and look layer timeline grid drawing. |
| `template/playback_timers_helpers.js` | 134 | Standardized `getActiveScenes`, time MM:SS calculators, layer color tiers, and recursive routing BNC B-Bank timeline layer resolver. |

**Imports:** Injected `<script src="playback_timers_helpers.js"></script>` directly in `template/playback_timers.html` right before `playback_timers.js`.

---

## Notable “just over 500” boundary

Under an **app-only** scan (excluding **`cef-cache/`** + **`work/**`**), **no source files exceed 500 lines** after **`routes-system-hardware`** and **`multiview-editor-canvas`** modularization (**2026-05-18**). Re-run the § **How to reproduce** script after large edits.

---

## How to reproduce

```bash
cd /path/to/highascg
find . \( -path './node_modules' -o -path './.git' -o -path './dist' -o -path './build' -o -path './coverage' \) -prune -o -type f \
  \( -iname '*.js' -o -iname '*.mjs' -o -iname '*.cjs' -o -iname '*.ts' -o -iname '*.tsx' -o -iname '*.jsx' -o -iname '*.vue' \
     -o -iname '*.css' -o -iname '*.scss' -o -iname '*.less' -o -iname '*.html' -o -iname '*.htm' \) -print 2>/dev/null \
| while read -r f; do
    [ -f "$f" ] || continue
    n=$(wc -l < "$f" | tr -d ' ')
    [ "$n" -gt 500 ] && printf '%s\t%s\n' "$n" "$f"
  done | sort -t$'\t' -k1 -nr -n
```

---

## Optional follow-ups (not run here)

- Add `.py`, `.sql`, `.xml`, `.yaml`/`.yml`, `.json` (careful: large generated JSON).
- Prune `cef-cache/`, `.reference/`, **`work/**`** by default for “app-only” sweeps.
- Fail CI if new files exceed N lines (requires baseline).

*End of sweep 1.*
