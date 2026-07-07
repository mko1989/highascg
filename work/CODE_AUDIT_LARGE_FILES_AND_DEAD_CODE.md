# HighAsCG code audit — large files & dead code

**Generated:** 2026-07-05  
**Updated:** 2026-07-05 (map excluded; initial cleanup applied)  
**Repository:** `highascg/`  
**Method:** Recursive scan + `npx eslint .` (`no-unused-vars`) + AST export cross-reference (acorn)

---

## Scope note — map explorer excluded

The **code map** (`client/components/map-explorer.js`, `client/styles/map-explorer.css`, `client/map.html`, `tools/map/`, `npm run build:map`) is a **standalone developer tool** and is **out of scope** for main-project maintenance metrics below.

---

## Executive summary

| Metric | Count |
|--------|------:|
| Source files > 500 lines (JS/SH/PY, excl. map) | **47** |
| App-surface JS files > 500 lines (excl. map, template, scripts, smoke) | **41** |
| CSS/HTML files > 500 lines (excl. map) | **5** |
| ESLint `no-unused-vars` findings | **156** (was 295) |
| Likely dead imports removed this pass | **~45** |
| Orphan WO-112 split modules | **wired** (device-view + replication + destinations) |

### Top folders — files > 500 lines (excl. map)

| Folder | Count |
|---|---|
| client/components | 18 |
| src/api | 5 |
| client/lib | 4 |
| src/utils | 3 |
| src/engine | 3 |
| template | 2 |
| tools/smoke | 2 |
| src/config | 2 |
| scripts | 2 |
| src/system | 1 |
| client/tools | 1 |

---

## Work completed (2026-07-05)

### Deleted dead/orphan code
- `template/lower-thirds/lt-engine-from-client/lt-engine copy.js` (accidental duplicate)

### Device View split wired (WO-112)
- Restored and wired: `device-view-toolbar.js`, `device-view-selection.js`, `device-view-cable.js`, `device-view-render.js`, `device-view-events.js`
- `device-view.js` reduced from ~948 lines to **63 lines** (thin orchestrator)
- Ported monolithic-only features into split modules: live sources band, virtual cam removal, enhanced `load()` with freshGpu/mergeSettings

### Replication inspector wired (WO-112)
- `device-view-inspector-replication.js` reduced from **827 → 173 lines** by delegating to existing `-controls.js` and `-shared.js`

### Destinations inspector wired (WO-112)
- `device-view-destinations-inspector.js` reduced from **796 → 12 lines** (re-export barrel)
- Canonical `renderDestinationInspector` moved to `-form.js` (521 lines); mode helpers live in `-modes.js` (280 lines)
- Restored features from monolith: `onHostInputRemoved`, NDI/DeckLink/V4L2/webpage remove handlers, `findExtraLiveSourceForHostDestination`

### Timeline inspector wired (WO-113)
- `inspector-panel-timeline.js` reduced from **786 → 7 lines** (re-export barrel)
- Canonical `renderTimelineClipInspector` synced to `-clip.js` (377 lines): `getTimelineProgramCanvas`, `refreshTimelineClipGeometryOnServer`, `clearClipTransformKeyframes`, align buttons
- `-flag.js` (352) and `-shared.js` (63) already matched monolith

### CEF interactive bridge wired (WO-118)
- `cef-interactive-bridge.js` reduced from **768 → 35 lines** (re-export hub)
- Split modules already existed: `-shared.js`, `-zones.js`, `-events.js`, `-lifecycle.js`
- Fixed missing `readCefDebugPortFromCasparXml` import in `-zones.js` (latent bug when interactive config is enabled)

### Timeline canvas wired (WO-113)
- `timeline-canvas.js` reduced from **731 → 246 lines** (orchestrator + public API)
- Wired existing `-pointer.js`, `-wheel.js`, `-snap.js`, `-render.js`; removed ~485 lines of duplicated handlers
- Synced `-pointer.js` to monolith: empty-track click deselects only (no seek); double-click add-layer

### x-display-session wired (WO-118)
- `x-display-session.js` reduced from **719 → 9 lines** (re-export hub)
- Split modules: `-layout.js` (386), `-runtime.js` (340)

### Sources panel wired (WO-114)
- `sources-panel.js` reduced from **688 → 320 lines** (orchestrator)
- Wired existing `-render.js`, `-project-gather.js`, `-media-selection.js`, `-decklink-drop.js`
- Extracted and wired: `-shell.js` (48 lines, DOM template), `-ingest-ui.js` (255 lines, ingest/replication/USB)
- Synced `-render.js` live tab: `effectiveChannelMap`, parallel v4l2/live config fetch
- Synced `-decklink-drop.js` to use `addDecklinkInputSlot` (canonical API)

### Dead imports removed (high-impact files)
- `client/components/device-view.js` — unused modal/UI imports
- `client/components/device-view-actions.js`, `device-view-bands-render.js`, `device-view-inspector-*.js`
- `client/components/header-bar.js` — unused modal imports (handled by submodules)
- `client/components/sources-panel-helpers.js` — unused imports + misplaced import block fixed
- `client/components/inspector-panel.js`, `preview-canvas-panel.js`, `scenes-editor.js`, `scenes-preview-runtime.js`
- `client/components/inspector-fill-timeline.js`, `sources-panel-project-gather.js`, `sources-panel-media.js`, `timeline-editor-handlers.js`
- `client/lib/device-view-gpu-port-merge.js`, `device-view-gpu-port-topology.js`, `device-view-host-channels.js`
- `client/lib/editor-defaults.js`, `pip-overlay-amcp.js`, `previs-scene-utils.js`, `project-import-flow.js`
- `client/lib/scene-state*.js`, `timeline-compose-preview.js`

### Dead-code pass (2026-07-05 continued)
- `device-view-destinations-ui.js`, `device-view-inspector-mapping.js`, `device-view-mappings-render.js`
- `device-view-ui-utils.js`, `sources-panel-helpers.js`, `timeline-canvas-render.js`
- `routes-data.js` (project delete ctx bug), `routes-project.js`, `routes-scene.js`, `global-border.js`
- ESLint `no-unused-vars`: **295 → 156**
- `tailscale-service.js`, `routes-ingest.js`, `scene-list.js`, `scenes-preview-global-border.js`, `smoke-replication-handshake.test.js`

---

## 1. Large files (> 500 lines)

**Rule:** Line count strictly > 500.  
**Excluded:** `node_modules/`, `dist-web/`, `cef-cache/`, `work/references/`, **map explorer tree**

### 1.1 App maintenance priority (runtime `client/` + `src/`)

| Lines | Path |
|------:|------|
| 63 | `client/components/device-view.js` |
| 7 | `client/components/inspector-panel-timeline.js` |
| 9 | `src/utils/x-display-session.js` |
| 12 | `client/components/device-view-destinations-inspector.js` |
| 35 | `src/system/cef-interactive-bridge.js` |
| 173 | `client/components/device-view-inspector-replication.js` |
| 246 | `client/components/timeline-canvas.js` |
| 320 | `client/components/sources-panel.js` |
| 521 | `client/components/device-view-destinations-inspector-form.js` |
| 720 | `src/utils/x-display-session-layout.js` |
| 687 | `client/components/live-input-modal.js` |
| 681 | `client/components/scenes-editor.js` |
| 679 | `client/components/device-view-inspector-decklink.js` |
| 645 | `client/components/device-view-inspector-gpu-video-modeline.js` |
| 645 | `src/api/routes-scene.js` |
| 629 | `src/api/routes-streaming-channel.js` |
| 627 | `client/components/preview-canvas-panel.js` |
| 622 | `client/lib/timeline-state.js` |
| 596 | `src/api/routes-data.js` |
| 590 | `src/config/build-caspar-generator-config.js` |
| 579 | `client/components/timeline-editor.js` |
| 578 | `client/lib/device-view-host-channels.js` |
| 571 | `client/components/logs-modal.js` |
| 564 | `src/engine/project-scenes.js` |
| 562 | `src/engine/timeline-playback-amcp.js` |
| 560 | `src/audio/alsa-mixer.js` |
| 558 | `client/components/scene-list.js` |
| 556 | `src/api/routes-replication.js` |
| 555 | `src/config/decklink-output-resolve.js` |
| 554 | `client/components/audio-mixer-panel.js` |
| 550 | `client/components/inspector-lower-third.js` |
| 548 | `client/components/inspector-panel.js` |
| 547 | `src/replication/replication-service.js` |
| 540 | `client/components/audio-mixer-view-console.js` |
| 540 | `client/lib/scene-state.js` |
| 530 | `src/api/routes-mixer.js` |
| 528 | `src/media/live-thumbnail-cache.js` |
| 525 | `src/utils/os-config.js` |
| 506 | `src/caspar/amcp-client.js` |
| 503 | `src/engine/timeline-playback.js` |
| 503 | `src/utils/gpu-topology-drm.js` |
| 501 | `client/lib/pip-overlay-amcp.js` |

### 1.2 CSS & HTML files > 500 lines (excl. map)

| Lines | Path |
|------:|------|
| 702 | `client/styles/08c-modals-misc.css` |
| 613 | `client/styles/01a-base-theme-header-connection.css` |
| 562 | `client/tools/electron-launcher/index.html` |
| 545 | `client/styles/06c-inspector-effects-pip.css` |
| 525 | `client/styles/02c-timeline-multiview-sources-sidebar.css` |

---

## 2. Remaining dead code (next passes)

### 2.1 Files with most `no-unused-vars` warnings (still open)

| Issues | File |
|---|---|
| 6 | `client/components/device-view-caspar-render.js` |
| 6 | `src/api/routes-project.js` |
| 6 | `src/api/routes-scene.js` |
| 5 | `client/components/device-view-inspector-gpu.js` |
| 4 | `client/components/device-view-inspector-gpu-video-modeline.js` |
| 4 | `client/components/preview-canvas-panel.js` |
| 4 | `client/lib/pip-overlay-amcp.js` |
| 4 | `client/lib/scene-state-layer-logic.js` |
| 4 | `src/api/routes-data.js` |
| 4 | `src/engine/global-border.js` |

### 2.2 Large-file splits still needed

1. **`device-view-destinations-inspector-form.js`** (521) — optional further split if form grows
2. **`sources-panel-live-render.js`** (485) — under limit; monitor if it grows
3. **`sources-panel-helpers.js`** (474) — possible split target if it grows

---

## 3. Reproduce

```bash
cd highascg

# Large files (excl. map)
find . -type f \( -name '*.js' -o -name '*.css' -o -name '*.sh' \) \
  ! -path './node_modules/*' ! -path './dist-web/*' ! -path './cef-cache/*' \
  ! -path './tools/map/*' ! -path './client/components/map-explorer.js' \
  ! -path './client/styles/map-explorer.css' \
  -exec wc -l {} + | awk '$1 > 500' | sort -rn

npm run lint
```

**Raw data (pre-cleanup):** [`work/code-audit-raw.json`](./code-audit-raw.json)
