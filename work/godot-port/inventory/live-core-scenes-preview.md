> **Provenance:** Haiku-generated inventory (2026-10-17) for [WO-593](../../work-orders/593_WO_godot_client_port_epic.md), spot-checked by hand where a WO relies on it. Line refs are to the 2026-10-17 tree (synced to `origin/main` d5521d50) and will drift; re-grep before acting on one.

# C — Live operation core (scenes / sources / PRV-PGM preview / compose tiles / multiview / live inputs / operator-GUI)

Repo: `/Users/marcin/highascg` (client only; server routes named only where the client contract needs them). Read-only inventory. All citations are `path:line` relative to `/Users/marcin/highascg/client/` unless a path starts with `src/`.

Scope actually applied: the file list in `components/` and `lib/` matched by the given prefixes (144 JS files: 74 components, 70 lib). CSS: the 20 `client/styles/` files whose selectors belong to these surfaces (listed in the CSS group). Generated file list: `/private/tmp/claude-501/-Users-marcin-highascg/9363bbd4-dc7d-4038-81d8-27ea731484b3/scratchpad/godot-inv/C_files.txt`.

Grouping rule: each file is assigned to exactly one sub-feature (verified by a set-diff against the scope list: 0 missing, 0 duplicates). Sub-features follow the code's own seams (separate modules, separate endpoints, separate state), not the filename prefixes.

Sub-feature map (LOC = `wc -l`):

| ID | Sub-feature | Files | JS LOC |
|---|---|---|---|
| A | Operator-GUI mode gate and preview-hole rect reporting | 5 | 1008 |
| B | PRV/PGM preview panel and compose preview data sources | 17 | 3101 |
| C | Operator compose tiles (free-tile canvas) | 5 | 1377 |
| D | Scenes deck (looks grid, main columns) | 11 | 1543 |
| E | Scenes editor shell, look edit, take | 9 | 1838 |
| F | Look compose frame (layer stack editor) | 7 | 2020 |
| G | PRV preview push pipeline (AMCP to the preview bus) | 13 | 2104 |
| H | Scene/look state model and persistence | 10 | 1822 |
| I | Transitions | 2 | 113 |
| J | Global border, PIP overlays, effects | 9 | 2233 |
| K | Sources panel (media, effects, templates, placeholders, ingest) | 16 | 2683 |
| L | Live inputs and live audio | 16 | 3227 |
| M | Multiview editor | 8 | 1659 |
| N | Mapping, screen destinations, editor defaults (config adjacent to live ops) | 8 | 1217 |
| O | Playback timers and clocks | 8 | 1306 |

Totals: JS 144 files / 27251 LOC (components 74 files / 16401 LOC; lib 70 files / 10850 LOC). CSS 20 files / 4772 LOC.

---

## A. Operator-GUI mode gate and preview-hole rect reporting

- Files:
  - `lib/operator-gui-mode.js` — 153 — mode gate (`?operatorGui` / `?cefOperator`), remote read-only detection, shared-layout subscribers, title marker, `<html>` class; re-exports the report API.
  - `lib/operator-gui-mode-rects.js` — 69 — pure DOM-rect to normalized 0-1 viewport-fraction conversion (`cellRectsToLayoutCells`).
  - `lib/operator-gui-mode-report.js` — 445 — per-surface cell map, throttle, suppression latches, POST/DELETE `/api/operator-gui/layout`, WS/heartbeat re-report triggers.
  - `lib/operator-gui-interaction-suppress.js` — 194 — detects modal overlays, pointer-down on preview surfaces and native HTML5 drags, and feeds `setInteractionSuppressed`.
  - `lib/operator-gui-launch.js` — 147 — REST wrappers to launch / control the operator GUI helper windows, taskbar, apps list, pointer confine.

- What the operator can do:
  - Nothing is directly operator-visible in this group except through effects: video "holes" in the physical operator monitor follow the on-screen preview cells, and modals/drags temporarily close the holes.
  - Launch and manage operator helper windows and the taskbar (`lib/operator-gui-launch.js`).

- Rendering tech: none in this group (DOM rect measurement only). The video itself is composited server-side by CasparCG and shaped into X11 windows; the client's job is to report rects.

### The preview-hole mechanism, precisely

**1. Mode gate.** `isOperatorGuiModeActive()` returns true if the query has `operatorGui` or `cefOperator` (`lib/operator-gui-mode.js:45-53`). `isRemoteOperatorView()` (`:64-79`) is true for `?operatorView`, or when served on `https:` port `4443` (the TLS proxy). Remote views never post suppress flags (`lib/operator-gui-mode-report.js:249`).
- Window title marker: `OPERATOR_GUI_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'` (`lib/operator-gui-mode.js:116`), forced into `document.title` and re-asserted by a `MutationObserver` on `<title>` (`:126-138`). Comment says the X11 shape helper matches on this token because X does not expose the URL.
- `applyOperatorGuiHtmlClass` toggles class `operator-gui` on `<html>` (`:146-152`).

**2. Measurement sites (who calls the reporters).** Each measures its DOM with `getBoundingClientRect()` and hands `{id, role, mainIndex, rect}` cells to a reporter:

| Surface | Measurement | Reporter | Evidence |
|---|---|---|---|
| Compose PRV/PGM cells (preview panel) | `item.cellEl.getBoundingClientRect()` per cell, each `paint()` | `onComposeCellRects` to `reportComposeCellRects` | `components/preview-canvas-panel.js:332-359` (rect at `:334`, push `:357`, call `:359`); paint scheduled via rAF `:259`, poll every 2000 ms `:380`, `ResizeObserver` on wrap `:405`. Reporter wired in `components/scenes-editor.js:221` |
| Operator compose tiles (free tiles) | `t.bodyEl.getBoundingClientRect()` (inner body, not the outlined frame, per comment) | `onCellRects` to `reportComposeCellRects` (or relative to compose area when not operator mode) | `components/operator-compose-tiles-tile-controller.js:83-113`; gate on state ready `:88`; compose-area basis `:93,100-102`; unresolved mvcell skipped `:105`; `onCellRects` `:110`; rAF-coalesced schedule `:115-118` |
| Multiview editor (single panel rect) | `wrap` / canvas rect in `reportMvRect` | `reportMultiviewEditRect` (`role: 'multiview'`) | `components/multiview-editor.js:138` (definition), `:186` (`ResizeObserver` re-report), `lib/operator-gui-mode-report.js:205-216` |
| Multiview editor (per-cell holes, alternative) | per-cell rects with `srcCh` | `reportMultiviewEditCellRects` (`role: 'mvcell'`/pgm/prv) | `lib/operator-gui-mode-report.js:229-236` |
| Look editor live PRV view | `el.getBoundingClientRect()` | `reportLookEditPrvRect(rect, mIdx)` | `components/scenes-editor-edit.js:11,205,207`; `lib/operator-gui-mode-report.js:175-186` |
| Timeline preview | cell rects | `reportTimelineCellRects` | `components/timeline-editor.js:288` (out of scope, cited for the surface list); `lib/operator-gui-mode-report.js:150-154` |
| Media inspector preview | one rect + clip raster dims | `reportMediaPreviewRect` (`role: 'media'`) | `components/inspector-media-file.js:16,201,211`; `lib/operator-gui-mode-report.js:194-203` |

**3. Rect math (pure).** `cellRectsToLayoutCells(cellRects, viewport)` (`lib/operator-gui-mode-rects.js:18-60`):
- Viewport defaults to `window.innerWidth/innerHeight` (fallback 1920x1080) (`:62-68`; `defaultViewport` used in report functions).
- Each rect becomes `x = clamp01(left / vw)`, `y = clamp01(top / vh)`, `w = clamp01(width / vw)`, `h = clamp01(height / vh)` (`:38-43`). `clamp01` maps non-finite to 0 (`:7-11`).
- Zero/negative width or height is dropped (`:24`).
- Role normalized to one of `prv | multiview | mvcell | media | pgm` (default `pgm`) (`:27-36`). `mainIndex` is `max(0, parseInt)`.
- `mvcell` requires a positive integer `srcCh` or the cell is dropped (`:47-51`); `media` carries `srcW/srcH` for server aspect-fit (`:53-56`).

**4. Per-surface merge state (`lib/operator-gui-mode-report.js`).**
- Reporting gate: `reportingEnabled()` = operator mode OR stream-view active (`:31-33`, `setOperatorStreamViewActive` `:28`).
- Surfaces are stored in `_bySurface: Map<surface, cells[]>` (`:38`). Each report replaces that surface's entry; an empty array deletes it (`reportSurfaceCells`, `:126-131`). Surface names in use: `compose`, `timeline`, `lookedit`, `mediainspector`, `mvedit`.
- `mergedCells()` concatenates all surfaces (`:50-54`).
- `effectiveCells()` returns `[]` only when the foreground-tab latch is set (`_tabBlocked`), else the merged set (`:63-65`).

**5. Throttle and withdrawal rules (`scheduleReport`, `:85-116`).**
- `REPORT_DEBOUNCE_MS = 150` (`:14`). First report in a quiet period sends immediately; later ones at most every 150 ms with a trailing send (`:109-115`).
- A withdrawal (empty set) is never sent on the leading edge; it is deferred one interval (`:97-102`) so a tab handoff (outgoing surface withdraws, incoming reports in the same frame) does not send an intermediate DELETE (comment `:87-96`). A non-empty report cancels a pending withdrawal (`:104-108`).

**6. Wire send (`sendLayout`, `:243-265`).**
- Endpoint `LAYOUT_ENDPOINT = '/api/operator-gui/layout'` (`:13`).
- `suppress = isRemoteOperatorView() ? false : (_composeHolesSuppressed || _suppressed)` (`:249`) (host-only).
- Dedupe: JSON of `{cells, s: suppress}`; identical payloads are not re-sent unless `force` (`:252-253`).
- Empty cells: `api.delete(LAYOUT_ENDPOINT)` (`:255-256`). Otherwise `api.post(LAYOUT_ENDPOINT, { cells, suppressHoles: suppress })` (`:258`).
- Server routes: `src/api/router.js:258-259` (POST and GET `/api/operator-gui/layout`); `src/system/operator-gui-channel.js` owns the CasparCG side (comments at `:74`, `:337` describe DELETE).

**7. Suppression latches (three independent ones).**
- Interaction latch `setInteractionSuppressed(bool)` (`:290-315`): suppress is immediate (cancels pending report, re-sends with `suppressHoles: true`, cells stay up so routes keep playing, `:296-307`). Restore is debounced `RESTORE_DEBOUNCE_MS = 300` after the last `false` (`:19`, `:310-314`).
- Compose-holes latch `setOperatorComposeHolesSuppressed(bool)` (`:273-279`): WO-319; used when the operator live canvas is on, so the browser draws the crop instead of a hole. Forces an immediate re-send.
- Foreground-tab latch `setForegroundTabBlocksVideo(bool)` (`:326-337`): sends `[]` as the effective set (see `effectiveCells`). `registerVideoBlockingTab(name)` (`:350-360`) installs one `window` listener for `highascg-workspace-tab-activated` (CG Studio uses this; `lib/operator-gui-mode-report.js:356`). Separate from the interaction latch by design (comment `:317-323`).

**8. Who drives the suppress latch (`lib/operator-gui-interaction-suppress.js`).**
- Preview surface selector `.preview-panel__compose-cell, .preview-panel__canvas, .mv-canvas-wrap` (`:33`).
- `recompute()` (`:61-65`): suppress if modal open OR any occluder key open OR (pointer down on a preview surface and not yet re-opened) OR HTML5 drag.
- Pointer down on a preview surface (`:88-101`): sets `_pointerDown`, schedules a re-open after `DRAG_REOPEN_MS = 150` (`:57`) so a drag re-shows the hole.
- Native HTML5 drag: `dragstart` sets latch (`:121-124`); `dragend` / `drop` clear it (`:126-130`); any pointer activity clears it as a lost-dragend failsafe (`:135-139`).
- Modal detection: `hasModalOverlay()` checks `document.querySelector('.modal-overlay')` (`:141-143`) on every `MutationObserver` batch over `document.body` (`:145-162`).
- Listeners are capture-phase on `document` (`:163-169`). The file explicitly does NOT suppress for the operator tile drag (comment `:27-32`).
- Occluders can be registered by key with `setOccluderOpen(key, open)` (`:75-86`), used by `components/header-bar-operator-helper.js` (out of scope).

**9. Re-report triggers (`initOperatorGuiRectReporting(ws)`, `:413-430`).**
- WS `connect` → `resendMergedNow()` (`:416`). `resendMergedNow` never posts an empty set (`:383`) so a boot before any surface reports cannot wipe the server-held layout (comment `:376-382`).
- WS `change` with `data.path === 'operatorGuiRectsWanted'` (`:417-418`), broadcast by the server on CasparCG reconnect (`src/system/operator-gui-channel.js`, comment `:401-404`).
- Heartbeat every `HEARTBEAT_MS = 60000` (`:22`, `:421`).

**10. Shared-layout echo.** `ws.on('operatorGuiLayout', …)` calls `applySharedLayoutBroadcast(cells, {source})` (`lib/app-ws-handlers.js:197`, dispatch in `lib/operator-gui-mode.js:98-107`). Subscribers (`subscribeSharedLayout`, `:87-90`) are the operator compose tiles (`components/operator-compose-tiles.js:371`, `:406`). Only `source === 'project_load'` moves host tiles (comment `lib/operator-gui-mode.js:93-95`).

**11. Canvas 2D used to draw previews in this area.** The "holes" themselves are not drawn; the surfaces around them are canvas or DOM:
- `components/preview-canvas-panel.js:83` (`canv.getContext('2d')`), draw callback `:343-351` (skipped when operator GUI active, `:341`).
- `components/operator-compose-tiles-tile-controller.js:142` (per-tile live crop canvas), crop call `:144` into `drawOperatorLiveCanvasCrop` (`components/preview-canvas-live-stream.js:250`).
- `components/operator-stream-view.js:80`.
- `components/multiview-editor.js:131` (canvas), `components/multiview-editor-canvas-draw.js:17` (`drawMultiviewEditor`).
- `components/scenes-editor-deck-thumb.js:42`.
- `components/preview-canvas-compose-cell-chrome.js:88` (`ctx: canvas.getContext('2d')`).
- `components/preview-canvas-draw-base.js`, `preview-canvas-draw-stacks.js`, `preview-canvas-draw-placeholder.js` (ctx-parameter helpers; see B).

- Port-risk notes:
  - Pure: `operator-gui-mode-rects.js` (no I/O; header says unit-testable without jsdom); the report state machine is pure logic over timers and a `sendLayout` call.
  - DOM-entangled: rect measurement sites (all in B, C, F, M), `document`/`window` listeners, `MutationObserver`, `document.title`.
  - Tricky logic to port: the withdrawal-deferral rule (`scheduleReport` `:85-116`), the restore debounce plus re-send, the dedupe key that includes the suppress flag, and the host-only suppression rule.
  - Doc-comment anomaly: the JSDoc block for `reportMultiviewEditRect` at `lib/operator-gui-mode-report.js:156-164` is immediately followed by a second JSDoc block (`:165-174`) for `reportLookEditPrvRect`, so the first block documents nothing.

---

## B. PRV/PGM preview panel and compose preview data sources

- Files:
  - `components/preview-canvas-panel.js` — 457 — collapsible PRV/PGM preview panel: layout toggle, PRV/PGM split, per-cell canvases, the rect reporter, and the switch between JPEG / WebRTC / tiles.
  - `components/preview-canvas.js` — 15 — barrel re-exporting the draw helpers and `initPreviewPanel`.
  - `components/preview-canvas-draw.js` — 14 — barrel re-exporting from the two draw modules.
  - `components/preview-canvas-draw-base.js` — 466 — shared canvas helpers: output bounds, boundary transparency, PRV/PGM edge bars, dual-cell preview, thumbnail cache and `drawImageCover`/`drawImageContainInRect`.
  - `components/preview-canvas-draw-stacks.js` — 408 — look-stack and timeline-stack painters (FILL per layer, selection highlight).
  - `components/preview-canvas-draw-placeholder.js` — 160 — placeholder, status text, audio-only fill painters.
  - `components/preview-canvas-destination-overlay.js` — 195 — DOM overlay of destination layout on the compose canvas.
  - `components/preview-panel-math.js` — 17 — `fitComposePairRect`, `composeCellLogicalDimensions`.
  - `components/preview-panel-resize.js` — 38 — panel height and gutter drag resizing.
  - `components/preview-canvas-compose-cell-chrome.js` — 108 — "edit live on PGM" role badge and per-cell zoom slider.
  - `components/preview-canvas-compose-snapshot.js` — 462 — JPEG snapshot cache per channel (poll + WS push), canvas painter for a compose cell.
  - `components/preview-canvas-live-stream.js` — 269 — operator live canvas (WebCodecs decode of the ch4 stream, operator-toggled).
  - `components/operator-stream-view.js` — 147 — full-width ch4 stream view with a draggable crop divider and zoom.
  - `components/compose-preview-stream-driver.js` — 27 — mirrors the `composePreview.mode === 'stream'` setting into the live canvas toggle.
  - `components/live-view.js` — 76 — WebRTC viewer wrapper for a single channel (uses `lib/webrtc-client.js`, out of scope).
  - `lib/compose-preview-backpressure.js` — 82 — backoff and poll-interval math for the ffmpeg JPEG compose preview.
  - `lib/compose-preview-url.js` — 160 — mode resolution (`native` / `stream` / `ffmpeg_jpeg` / snapshot) and URL builders for compose-preview endpoints.

- What the operator can do:
  - Pick the compose preview source (Canvas thumbnails, JPEG poll, live stream) via the Compose preview "Preview source" dropdown (`compose-preview-stream-driver.js` header).
  - Collapse / expand the panel, drag the panel height (`preview-panel-resize.js:5-36`), flip PRV/PGM between side-by-side and stacked (`preview-canvas-panel.js:384-391`, layout toggle `cLayoutBtn`).
  - Drag the PRV/PGM split gutter (`preview-canvas-panel.js:394`, `components/scenes-editor-support.js:88-114` for the Scenes split).
  - Click the "edit live on PGM" badge on a cell (`preview-canvas-compose-cell-chrome.js:33-35`, event `scenes-edit-live-on-pgm`).
  - Adjust per-cell zoom (`preview-canvas-compose-cell-chrome.js` header; `zoom` read at `preview-canvas-panel.js:350`).
  - Reset tile layout from the grab button (`preview-canvas-panel.js:386`, event `operator-tiles-reset-request`).
  - Toggle the live stream on the operator canvas (`preview-canvas-live-stream.js:50-57`, persisted; `:78` availability check).
  - Drag the crop divider and Ctrl/⌘-wheel zoom in the stream view (`operator-stream-view.js:99-122`).

- Rendering tech (evidence):
  - Canvas 2D: `preview-canvas-panel.js:83` (`getContext('2d')`); per-cell canvases sized with `devicePixelRatio` (`:270`, `:336-340`) and `setTransform(dpr)` (`:340`).
  - Canvas 2D image draws: `preview-canvas-compose-snapshot.js:449` (`ctx.drawImage(entry.img, …)`); `preview-canvas-live-stream.js:213,232,264` (`drawImage` of a decoded frame; `:258` comment: out-of-bounds source rect throws).
  - Canvas 2D thumbnail painters: `preview-canvas-draw-base.js:401-418` (`new Image()`, `img.src = url`), `:429`, `:456` (`drawImageCover`, `drawImageContainInRect`); `preview-canvas-draw-stacks.js` (11 `drawImage` calls).
  - Canvas 2D text/edge painters: `preview-canvas-draw-base.js:17-33` (output bounds, `strokeRect`, `measureText`), `:48-65` (`clip('evenodd')`), `:83-87` (`createLinearGradient`).
  - `<img>` polling / loading: `preview-canvas-compose-snapshot.js:140,151` (`new Image()`), `:166` (`img.src = url`), `:183` (`setInterval`), `:306` (`fetch` meta with `cache: 'no-store'`). Interval retuned on visibility change (`:190-201`, `document.addEventListener('visibilitychange')` at `:200`).
  - Live video: none created in this group. WebRTC viewer uses `lib/webrtc-client.js` via `components/live-view.js:6`. The panel's video containers (`preview-canvas-panel.js:70-72`, `:81` selectors `[data-preview-webrtc=prv|pgm]`) are legacy placeholders for it.
  - WebCodecs: `preview-canvas-live-stream.js` header `:2-3`, `:14-15` (imports `acquireGuiStream`, `guiStreamFrame`, `subscribeGuiStreamFrames` from `lib/gui-stream-client.js`, out of scope, `:19-26`). Frames are `VideoFrame`-like objects passed to `drawImage` (`:213`).
  - DOM layout: `preview-canvas-panel.js:305-331` writes `style.cssText` per compose cell (absolute three-panel layout or flex weights).

- Interaction:
  - Pointer and mouse: `preview-panel-resize.js:6` (`mousedown`), `:19` (`mousemove`/`mouseup` on document), `:24-36` (gutter); `operator-stream-view.js:99-117` (divider `pointerdown`, `setPointerCapture` `:101`, document `pointermove`/`pointerup` `:116-117`); `operator-stream-view.js:122` `wheel` with Ctrl/⌘.
  - Click: `preview-canvas-compose-cell-chrome.js:33`; `preview-canvas-panel.js:384-391`.
  - Drag and drop: none in this group. Drops onto the compose area are handled by C (`operator-compose-tiles.js:296-301`) and by the Scenes compose frame (F).
  - Keyboard: none in this group.
  - Context menu / modals: none in this group.

- Server contract (HTTP):
  - `GET /api/gui-stream/status` — `components/preview-canvas-live-stream.js:78` (`cache: 'no-store'`).
  - `GET /api/compose-preview/:ch.:ext` (image), `GET /api/compose-preview/:ch/companion.jpg`, `GET /api/compose-preview/:ch/meta` — `lib/compose-preview-url.js:60,74,86`; meta fetched at `components/preview-canvas-compose-snapshot.js:306`.
  - Mode is forced `native` on operator-GUI pages (`lib/compose-preview-url.js:3-5` header: neither canvas thumbnails nor the ffmpeg JPEG poll run there).
  - No POST in this group.

- Server contract (WS):
  - Reads `compose.preview` via `ws.on('compose.preview', …)` in `lib/app-ws-handlers.js:194` → `ingestComposePreviewWs(data)` (`components/preview-canvas-compose-snapshot.js:212`). Carries `blocklisted`/`reason` (`:230-231`) and an etag (`:241`). Push is at JPG mtime rate (`:247` comment).
  - Live-canvas repaint is driven by `subscribeGuiStreamFrames` (`lib/gui-stream-client.js`, out of scope).

- Client state:
  - localStorage (keys built from `storageKeyPrefix`, default `casparcg_preview`, `preview-canvas-panel.js:17-18`): `…_collapsed` (kC), `…_height` (kH), `…_compose_prv_pgm_layout` (kL, values `lr`|`tb`, default `lr`, `:24`), `…_compose_prv_pgm_split` (kS, default 0.5, `:25`), a per-width map (kW, `:148,179,186`). Default body height `200` (`:28`).
  - `casparcg_preview_height` — `components/preview-panel-resize.js:16`.
  - `highascg.operatorLiveCanvas` ('1'/'0') — `components/preview-canvas-live-stream.js` (`LS_KEY`, `:50-57`).
  - `highascg.streamView.crop` and `highascg.streamView.zoom` — `components/operator-stream-view.js:18-19`, read `:62-63`, written `:108`, `:127`.
  - Store subscriptions: `streamState.subscribe`, `settingsState.subscribe` (`preview-canvas-panel.js:409-410`; `components/compose-preview-stream-driver.js:24`); `stateStore` passed in (`preview-canvas-panel.js:98` reads `channelMap.screenCount`).
  - Module-level caches: `_cache: Map<ch, {img, etag, loading}>` (`preview-canvas-compose-snapshot.js:140`, `:413`); live-canvas `_available`, `_channel`, `_enabled`, `_acquired` (`preview-canvas-live-stream.js:33-41`).

- Browser-only APIs:
  - `ResizeObserver` — `preview-canvas-panel.js:405`.
  - `requestAnimationFrame` — `preview-canvas-panel.js:259`.
  - `setInterval` — `preview-canvas-panel.js:380` (2000 ms fallback), `preview-canvas-compose-snapshot.js:183`.
  - `devicePixelRatio` — `preview-canvas-panel.js:270` (clamped to 2).
  - `document.visibilityState` / `visibilitychange` — `preview-canvas-compose-snapshot.js:18`, `:200`.
  - `Image` — `preview-canvas-compose-snapshot.js:140,151`; `preview-canvas-draw-base.js:401`.
  - `fetch` — `preview-canvas-compose-snapshot.js:306`, `preview-canvas-live-stream.js:78`.
  - `localStorage` — see above. `performance.now` — `playback-timer-format.js` (O).
  - `setPointerCapture` — `operator-stream-view.js:101`.
  - `WebCodecs` — via `lib/gui-stream-client.js` (out of scope).

- Port-risk notes:
  - Pure, portable: `preview-panel-math.js` (17 lines); `lib/compose-preview-backpressure.js` (exported constants `BACKOFF_BASE_MS=1000`, `BACKOFF_MAX_MS=30000`, `BACKOFF_FACTOR=2`, `POLL_VISIBLE_MS=1000`, `POLL_HIDDEN_MS=30000`, `PUSH_HIDDEN_MIN_GAP_MS=30000`, and pure fns `computeBackoffDelayMs`, `resolvePollIntervalMs`, `shouldAcceptFramePush`; lines 16-27, 42-43); `lib/compose-preview-url.js` (string builders and mode resolution).
  - Tricky math: the three-panel absolute layout and flex-weight layout (`preview-canvas-panel.js:305-331`); backing-store sizing with DPR (`:336-340`); hole/rect reporting basis (B reports `getBoundingClientRect`, see A).
  - DOM-entangled: all `components/preview-canvas-*` painters take a `CanvasRenderingContext2D` and are testable in principle, but the panel itself owns the DOM and `ResizeObserver`.
  - Browser-specific: `ImageBitmap`/`VideoFrame` drawing (`preview-canvas-live-stream.js:213-264`) is the part that changes most in Godot.

---

## C. Operator compose tiles (free-tile canvas for the operator GUI)

- Files:
  - `components/operator-compose-tiles.js` — 444 — the compose area as a canvas of movable/resizable tiles; source-tile drop; layout seed from server and localStorage.
  - `components/operator-compose-tiles-tile-controller.js` — 465 — tile DOM, pointer drag/resize, rect reporting, live-crop drawing.
  - `components/operator-compose-tiles-geometry.js` — 180 — pure chrome/body/hole rect math and default grid optimizer.
  - `components/operator-compose-tiles-state.js` — 224 — channel/aspect resolution, layout persistence, source-tile persistence, cells-for-surface.
  - `components/operator-compose-tiles-actions.js` — 64 — PGM-tile action buttons (edit live on PGM, PGM capture).

- What the operator can do:
  - Drag a tile (move) and resize it; the hole on the operator monitor tracks the box live (`operator-compose-tiles-tile-controller.js:354-355`, `:390-404`).
  - Drop a source (route, media, template) onto the compose area to create a source tile at the drop fraction (`operator-compose-tiles.js:296-301`, `:266` `addSourceTileFromDrop`, `:180` `removeSourceTile`).
  - Reset the layout (`operator-compose-tiles.js:240` `resetLayout`, `:333` `onResetRequest`).
  - From a PGM tile: "edit live on PGM" (`operator-compose-tiles-actions.js:31-34`, event `scenes-edit-live-on-pgm`) and "PGM capture" (`:42-48`, `POST /api/pgm/capture`).
  - Print a channel from a tile (`operator-compose-tiles-tile-controller.js:311-319`, `POST /api/amcp/print`).
  - Remove a tile (`:337`).

- Rendering tech (evidence):
  - DOM absolutely-positioned tile elements (`operator-compose-tiles-tile-controller.js:50` `layoutTileDom`, `:272` `buildTile`).
  - Per-tile canvas for the live crop: `operator-compose-tiles-tile-controller.js:124-147` (`cv.getContext('2d')` `:142`, `drawOperatorLiveCanvasCrop` `:144`). Hidden when the live canvas is off (`:135`).
  - `ResizeObserver` `operator-compose-tiles.js:319`; `IntersectionObserver` is used indirectly via `element-position-watch.js` (out of scope; comment `operator-compose-tiles.js:122`).

- Interaction:
  - Pointer: `operator-compose-tiles-tile-controller.js:354` (footer, move), `:355` (resize handle), `:390` `startDrag`, `:400` `setPointerCapture`, `:401-402` document `pointermove` / `pointerup`. Buttons stop propagation (`:311`, `:337`).
  - HTML5 DnD (drop of sources): `operator-compose-tiles.js:296` (`dragover`), `:300` (`dragleave`), `:301` `drop`; reads `application/json` then `text/plain` (`:305-307`); drop fraction computed `:309-314`; `addSourceTileFromDrop` `:318`.
  - Keyboard / context menu / modals: none in this file group.
  - Window events: `highascg-workspace-tab-activated` `operator-compose-tiles.js:340` (cleanup `:428`); `operator-tiles-reset-request` (dispatched from `preview-canvas-panel.js:386`, consumed here via `onResetRequest` `:333`).

- Server contract (HTTP):
  - `GET /api/operator-gui/layout` — `operator-compose-tiles.js:374` and `:412` (`cache: 'no-store'`). Used to reconcile the local layout with the server.
  - `POST /api/pgm/capture` — `operator-compose-tiles-actions.js:48`.
  - `POST /api/amcp/print` — `operator-compose-tiles-tile-controller.js:319`.
  - Rects are posted through A (`POST /api/operator-gui/layout`).

- Server contract (WS):
  - `operatorGuiLayout` broadcast via `subscribeSharedLayout` (`operator-compose-tiles.js:371`, `:406`), with `meta.source === 'project_load'` for authoritative restore (`lib/operator-gui-mode.js:93-107`).
  - `change` with `path: 'sourceLabels'` triggers a re-render (comment `operator-compose-tiles.js:343`).

- Client state:
  - localStorage: `${storageKeyPrefix}_operator_tiles_${screenCount}` (`operator-compose-tiles-state.js:53-54`), and `${storageKeyPrefix}_operator_source_tiles` (`:117-118`). Default prefix `casparcg_preview` (`operator-compose-tiles.js:111`).
  - `stateStore` read: `channelMap` (`getCm`, `operator-compose-tiles.js:126`); `getStateReady` gate (`operator-compose-tiles-tile-controller.js:88`).
  - Per-tile fields: `t.def`, `t.bodyEl`, `t.fill` (FILL fraction for the live crop, `:134`), `t.liveCanvas`.

- Browser-only APIs:
  - Pointer events, `setPointerCapture` (`:400`), `requestAnimationFrame` (`:115-117`), `getBoundingClientRect` (`:99`), `ResizeObserver` (`operator-compose-tiles.js:319`), `DataTransfer` drop (`:305`), `localStorage` (`operator-compose-tiles.js:112`), `window` resize/scroll listeners (`:321-322`), `fetch` (`:374`, `:412`).

- Port-risk notes:
  - Pure, portable: `operator-compose-tiles-geometry.js` (header: "every function here is a pure function"); `operator-compose-tiles-state.js` (key builders, resolution, normalization).
  - Tricky logic: the body-vs-hole vs chrome math (`tileBodyRectFromOuter`, `tileHoleRectFromOuter`, `snapToGrid`, `clampTileRect`, `computeDefaultTileLayout` in geometry; signatures at the outline level); the crop-source-is-FILL-fraction rule (comment `tile-controller.js:130-133`: display position and content are decoupled).
  - Persistence rule: local layout is authoritative until a broadcast arrives (`tile-controller.js:159`, `:202`).
  - DOM-entangled: drag, resize, tile DOM, live crop canvas.

---

## D. Scenes deck (looks grid, main columns)

- Files:
  - `components/scene-list.js` — 256 — deck: per-main look columns, main pills (output target), default transition, apply-to-all.
  - `components/scene-list-column.js` — 494 — single main column: look cards, FTB, global border, media drop, per-screen timer icon, rename.
  - `components/scene-list-column-reorder.js` — 141 — pointer-driven look-card reorder inside one main's column.
  - `components/scene-list-column-timers.js` — 82 — per-screen timer icon state with a shared `/api/timers/list` cache.
  - `components/scene-list-card-audio-only.js` — 70 — card state and stop button for audio-only looks.
  - `components/scenes-editor-deck-drop.js` — 148 — drop media onto the deck to create a look (timer drops removed by WO-210).
  - `components/scenes-editor-deck-ingest.js` — 60 — deck media drag-drop ingest (upload, then poll the media list).
  - `components/scenes-editor-deck-thumb.js` — 129 — look-card thumbnail painter (canvas).
  - `lib/scene-look-kind.js` — 137 — CG-only look detection (`isCgOnlyLook`).
  - `lib/scene-look-name-commit.js` — 18 — commits in-progress name edits before a DOM rebuild.
  - `lib/look-preset-events.js` — 8 — event names for recalling a look to PRV / PGM from the preset panel.

- What the operator can do:
  - Click a look card to send it to PRV (`scene-list-column.js:342` `sendPrv`), see the on-air highlight from the server's live state.
  - Reorder look cards by dragging the thumbnail's handle (`scene-list-column-reorder.js:97-121`).
  - Rename a look inline (Enter blurs, `scene-list-column.js:327-332`).
  - Press FTB per screen (`scene-list-column.js:110`, `POST /api/ftb` with `screenIdx`, `durationFrames`, `framerate`).
  - Open the per-screen timer (dispatch `screen-timer-select`, `scene-list-column.js:136-137`) and global border (`global-border-select`, `:184`).
  - Drop media or a route onto the column/grid to create a look (`scene-list-column.js` `dragover`/`drop`, `scenes-editor-deck-drop.js`, `scenes-editor-deck-ingest.js:23-28`).
  - Stop an audio-only look (`scene-list-card-audio-only.js:69`).

- Rendering tech:
  - DOM cards and columns (`scene-list-column.js`, `scene-list.js`).
  - Canvas 2D thumbnail painter: `scenes-editor-deck-thumb.js:42` (`c.getContext('2d')`), `:87` comment on thumbnail URL resolution, `requestAnimationFrame` (`:78`, `:106`).
  - `<img>` thumbnails: `lib/thumbnail-url.js` (K) via `getThumbnailUrl`/`getLiveThumbnailUrl`.
  - Thumbnail refresh via `scenes-preview-runtime.js:84` (`scenes-deck-thumb-redraw` event).

- Interaction:
  - HTML5 DnD: `scene-list-column.js` `dragover`/`dragleave` (`:475` on `grid`), `drop` handler; `scene-list.js` uses `DataTransfer` (`scene-list.js`, from grep).
  - Pointer-based reorder: `scene-list-column-reorder.js:97` (`pointerdown`), `:106` (`pointermove`), `:121` (`pointerup`); `setPointerCapture` at the same file; `scene-list-column-reorder.js` also has a `dragstart` path (count 1), but its header (`:6`) says Firefox ESR does not reliably fire `dragstart` for `draggable`, so the reorder itself is pointer-based.
  - Keyboard: `scene-list-column.js:327-332` (Enter blurs the name input, `preventDefault`).
  - Click: `scene-list-column.js` `headerEl`/`footerEl` `pointerdown` stopPropagation (`:409`, `:414`) so header/footer clicks do not start deck drags.
  - Confirm dialogs: `confirm(` in `scene-list-column.js` (1 call).
  - Window events out: `screen-timer-select` (`:136`), `global-border-select` (`:184`); in: `screen-timers-changed` (dispatched from `lib/screen-timer-create.js:19`).

- Server contract (HTTP):
  - `POST /api/ftb` — `scene-list-column.js:110`.
  - `GET /api/timers/list` — `scene-list-column-timers.js:58`.
  - `POST /api/scene/audio-only/stop` — `scene-list-card-audio-only.js:69`.
  - `POST /api/scene/take` is initiated from the deck via `sendPrv` → E/G (`scene-list-column.js:342`).
  - `GET /api/media` (indirect via E ingest) — `scenes-editor-deck-ingest.js:33`; `POST /api/media/refresh` — `:28`; `POST /api/ingest/upload` — `:23`.
  - `POST /api/thumbnail/live/capture` — in F (`scenes-compose-layer-thumb.js:136`).

- Server contract (WS): via `stateStore` and `change` (`scene.deck`, `scene.live`), handled in `lib/app-ws-handlers.js:138-186` (out of scope; cited for the consumer chain).

- Client state:
  - SceneState (H): `sceneState.getScene`, `sceneState.editingSceneId`, `sceneState.getGlobalBorderForScreen` (E).
  - `stateStore` `channelMap`, `scene.live`, `scene.liveAudioOnly`, `*` (`scenes-editor.js:354`, which schedules a render on these).
  - Module-level timers cache: `fetchTimersCache`, `isTimersCacheLoaded`, `ensureTimersListener` (`scene-list-column-timers.js`).
  - No localStorage keys in this group.

- Browser-only APIs:
  - HTML5 drag-and-drop: `dragstart` (`scene-layer-row.js:71`, `scene-list-column-reorder.js`), `dragover`/`drop` (`scene-list-column.js`, `scenes-editor-deck-drop.js`), `DataTransfer` (`scene-list.js`, from grep).
  - Pointer events: `scene-list-column-reorder.js:97-121`.
  - `requestAnimationFrame` `scenes-editor-deck-thumb.js` (2 uses), `window.dispatchEvent(CustomEvent)`.
  - `confirm()` `scene-list-column.js`.

- Interaction summary: drop targets: deck grid (`scene-list-column.js:475`), media drop (`scenes-editor-deck-drop.js`), drag-reorder (`scene-list-column-reorder.js`).

- Port-risk notes:
  - Pure: `scene-look-kind.js` (`isCgTemplateLayer`, `isCgRenderableLayer`, `isCgOnlyLook`; header says "keep in sync with src/engine/scene-look-kind.js"); `scene-look-name-commit.js`.
  - Stateful event wiring: CustomEvent names are the glue (`screen-timer-select`, `global-border-select`, `scenes-edit-live-on-pgm`); a Godot port needs an explicit signal bus or direct calls.
  - DOM-entangled: the column rebuilds (`innerHTML`-style) and the drag/drop handlers.

---

## E. Scenes editor shell, look edit, take

- Files:
  - `components/scenes-editor.js` — 466 — Scenes/Looks workspace: deck + drill-in per-scene compose, PRV live view, render scheduler, border events.
  - `components/scenes-editor-support.js` — 383 — shell DOM, PRV/PGM split drag, take-to-program logic (`takeScenesToProgram`), screen tabs.
  - `components/scenes-editor-edit.js` — 238 — look edit view (name, transitions, layer strip, PRV live view report).
  - `components/scenes-editor-keyboard.js` — 31 — Space = take preview to program (while Scenes tab active).
  - `components/scenes-editor-global-preview-take.js` — 67 — global take: armed-preview entries, edited-scene mainScope override.
  - `components/scenes-editor-preview-actions.js` — 36 — preview actions that coordinate with timeline playback (stop / seek).
  - `components/scenes-editor-logic.js` — 122 — resolution per screen, look recall from preset, `runLookRecall`.
  - `components/scenes-shared.js` — 481 — shared AMCP snippets, drag payload parsing, route drop rejection, transition row UI, play-seek helpers.
  - `lib/scene-content-fit.js` — 14 — shared content-fit enum.

- What the operator can do:
  - Take the armed preview to program with Space (`scenes-editor-keyboard.js:19-22`).
  - Take a look to program for one main or for the armed set (`scenes-editor-global-preview-take.js:20-33`; batch `takeSceneToProgram.batch`, `:38`).
  - Edit the look name (Enter, `scenes-editor-edit.js:114-118`).
  - Drag the PRV/PGM split (`scenes-editor-support.js:88-114`, persisted at `:32`, `:64`, `:108`).
  - Switch screen tabs (`scenes-editor-support.js:357` `renderScreenTabs`).
  - Timeline transport from the preview (`scenes-editor.js:145-149`: `sendto`, `seek`, `play`, `pause`; `scenes-editor-preview-actions.js:24` `stop`).

- Rendering tech:
  - DOM (`appendScenesEditorShell`, `scenes-editor-support.js:45`; `renderEdit`, `scenes-editor-edit.js`).
  - Canvas: none directly; the PRV preview canvas is B (`scenes-editor.js` mounts it).
  - `requestAnimationFrame` `scenes-editor.js` (1 use); `setTimeout` `scenes-editor.js` (1 use) for render scheduling (`scheduleRender`, `:312`).

- Interaction:
  - Keyboard: `scenes-editor-keyboard.js:25` (`document` `keydown`, capture phase), ignores modifiers (`:18`) and inputs (`:20`). `scenes-editor-edit.js:114` (`#scenes-name` Enter).
  - Pointer: `scenes-editor-support.js:89` (`mousedown` on split handle), `:113-114` (`mousemove`/`mouseup` on document).
  - Drag and drop: `scenes-editor-edit.js:127` (`dragover`), `:132` (`dragleave`), `:135` (`drop`) on the layer strip; `scenes-shared.js` provides `parseDraggableSourcesPayload` (`:43-56`) and `dataTransferOffersDeckMedia` (`:70-74`).
  - Window events: `highascg-workspace-tab-activated` (`scenes-editor-edit.js:18`), `highascg-border-preset-recall` (`scenes-editor.js:131`), `highascg-global-border-push` (`:137`), `scene-layer-select` (dispatched `scenes-editor.js:184`), `scenes-refresh-preview` (listened where? dispatched from `sources-panel-project-gather.js:129`).
  - Document events: `highascg-settings-applied` (`scenes-editor.js:337`); `stateStore.on('*')` (`:354`).
  - Modals: none in this group (toast via `showScenesToast`, `scenes-editor-support.js:12`).

- Server contract (HTTP):
  - `POST /api/scene/take` — `scenes-editor-support.js:229` (one per channel, concurrently, optional `takeGroup`); `scenes-preview-runtime.js:227` and `:292` (G).
  - `POST /api/timelines/:id/sendto`, `/seek`, `/play`, `/pause` — `scenes-editor.js:145-149`.
  - `POST /api/timelines/:id/stop` — `scenes-editor-preview-actions.js:24`.
  - `POST /api/scene/border-lines` — via G.
  - `GET /api/media` — `scenes-compose.js:62`/`:107` (F).

- Server contract (WS): consumes `change` paths `scene.live` and `channelMap` through `stateStore` (`scenes-editor.js:354`), and reads `scene.live` seq gaps in `lib/app-ws-handlers.js:142-158` (out of scope).

- Client state:
  - SceneState (H) `editingSceneId`; `sceneState.getScene`; `resolveMainIndexForScene` (`lib/look-stack-amcp-channel.js`, G).
  - localStorage: `casparcg_scenes_preview_split_px` (`scenes-editor-support.js:32`).
  - stateStore `channelMap` (`scenes-editor.js:44-48` getters).

- Browser-only APIs: `window`/`document` events, `localStorage` (`scenes-editor-support.js:64`, `:108`), `Date.now` (`scenes-editor-support.js` for take group id), `mousedown`/`mousemove`/`mouseup`, `requestAnimationFrame`, `setTimeout`.

- Take logic (tricky, precise):
  - `takeScenesToProgram` (`scenes-editor-support.js:143`), `takeSceneToProgram` (`:308`): `targetMains` computed per screen (`:317`), one POST per channel, tagged with a takeGroup id when more than one job (`:225-229`, id `tg_<base36 time>_<rand>`), results via `Promise.allSettled` (`:232`).
  - Edited-scene override: if the edited scene's `mainScope` is not `'all'`, take that scene to its own main only (`scenes-editor-global-preview-take.js:20-27`).
  - Mapping lookup: `resolveMainIndexForScene` (`lib/look-stack-amcp-channel.js`).

- Port-risk notes:
  - Portable: `scenes-editor-logic.js` (resolution, recall), `scene-content-fit.js`.
  - Tricky: the takeGroup batching and the armed-preview selection (`collectArmedPreviewEntries`).
  - DOM-entangled: the shell and the split drag.

---

## F. Look compose frame (layer stack editor)

- Files:
  - `components/scenes-compose.js` — 456 — compose frame: layer DOM, move-drag, border resize, media drop, fill/route apply helpers.
  - `components/scenes-compose-handlers.js` — 471 — pointer drag handlers: move, edge resize, crop; pure delta math (`cropDeltaToParams`, `edgeResizeDeltaToFill`, `snapValue`).
  - `components/scenes-compose-layer-thumb.js` — 156 — per-layer thumbnail / placeholder content (`<img>`), live thumb capture.
  - `components/scene-layer-row.js` — 448 — layer strip rows (bottom to top list): copy/paste/remove, DnD reorder, preset bar.
  - `components/scenes-editor-layer-route.js` — 171 — build a `route://` source descriptor for a look layer; add route layer to a look.
  - `lib/layer-crop.js` — 272 — MIXER CROP geometry, single source of truth (pure).
  - `lib/scene-layer-rotation-amcp.js` — 46 — compose-style center-pivot rotation lines for MIXER ANCHOR.

- What the operator can do:
  - Drag a layer's fill (move) inside the compose frame (`scenes-compose-handlers.js:165-229`, `startDrag`).
  - Resize edges (`startEdgeResize`, `:343-415`) and crop a layer (`startCropResize`, `:416-469`).
  - Reorder layers by dragging the row handle (`scene-layer-row.js:54` draggable, `:71` dragstart, `:92` dragover, `:106` drop).
  - Drop a media item or a route onto the frame or the aspect pad (`scenes-compose.js:215-245`, `:373-384`).
  - Rotate and scale: `startRotate` (`:246-284`) and `startScale` (`:285-342`) exist and are returned by the factory (`:470`), but the code comment says they are no longer wired to any DOM (`:242`). Treat as dead code.

- Rendering tech:
  - DOM absolutely positioned layer boxes (`scenes-compose.js:117` `renderComposeScene`).
  - `<img>` thumbnails with `img.draggable = false` (`scenes-compose-layer-thumb.js:54-106`), `document.createElement('img')` (`scenes-compose-layer-thumb.js` 4 uses).
  - Live thumb capture, `img.src = getLiveThumbnailUrl(n, Date.now())` (`:138`).
  - No canvas in this group.

- Interaction:
  - Pointer: `scenes-compose.js:344`, `:355`, `:365` (`pointerdown` on zones/layers); `scenes-compose-handlers.js:238-239`, `:281-282`, `:332-333`, `:402-403`, `:466-467` (document `pointermove`/`pointerup`).
  - HTML5 DnD: `scenes-compose.js:215` (`pad` `dragover`), `:220` (`dragleave`), `:223` (`drop`), `:239`/`:245` (`aspect` dragover/drop), `:373` (`el` dragover), `:383` (`dragleave`), `:384` (`drop`). Route-drop rules: `routeLayerDropAllowed` (`:154`) and `routeDropRejectionMessage` (`scenes-shared.js:465`).
  - Snap: `snapValue` (`scenes-compose-handlers.js:140`).
  - `blurFormFocus` (`:156`).
  - Keyboard: none in this group.
  - Modals: none.

- Server contract (HTTP):
  - `POST /api/thumbnail/live/capture` with `{channel, force: true}` — `scenes-compose-layer-thumb.js:136`; then the cache is invalidated (`:137`).
  - `GET /api/media` — `scenes-compose.js:62`, `:107`.
  - Thumbnail URLs: `lib/thumbnail-url.js` (`getThumbnailUrl` `:52`, `getLiveThumbnailUrl` `:57`) → `GET /api/thumbnail/:fileId?hq=1&w=&t=` and `GET /api/thumbnail/live/:ch`.
  - Layer edits are applied to the preview bus by G (AMCP via `/api/scene/live/preview`, `/api/preview/mixer-nudge`).

- Client state:
  - SceneState (H) layer records, `patchLayer`, `reorderLayers`, layer style clipboard (in H).
  - `stateStore` read only via callbacks.
  - No localStorage keys in this group.

- Browser-only APIs: `pointer` events and document listeners (`scenes-compose-handlers.js:238`), HTML5 DnD (`scenes-compose.js:215-245`, `scene-layer-row.js:71-106`), `createElement('img')` (`scenes-compose-layer-thumb.js`), `Date.now` (`:138`), `setTimeout` (`scenes-compose-handlers.js` 5 uses).

- Port-risk notes:
  - Pure, portable: `layer-crop.js` (header: "single source of truth for MIXER CROP math", WO-158 T158.1); `scenes-compose-handlers.js:23` `cropDeltaToParams`, `:69` `edgeResizeDeltaToFill`, `:140` `snapValue`; `lib/scene-layer-rotation-amcp.js` (pivot/anchor math, comment `:2-3` says it must match Caspar MIXER ANCHOR).
  - Tricky: crop/edge fraction math with the pointer delta expressed as a fraction of the aspect box; fill vs visible-rect conversions in `layer-crop.js` (`cropAdjustedFill`, `layerRectFromVisibleRect`, `alignFillForCrop`).
  - DOM-entangled: the layer boxes and handler wiring.

---

## G. PRV preview push pipeline (look edits to the preview bus)

- Files:
  - `components/scenes-preview-runtime.js` — 464 — PRV push queue, AMCP batching, PGM live edits, border-only push.
  - `components/scenes-preview-runtime-clear.js` — 118 — clear preview bus for one main and stop look-stack layers.
  - `components/scenes-preview-runtime-mixer-nudge.js` — 169 — low-latency geometry/opacity/crop nudge while dragging.
  - `lib/scenes-preview-push-scene.js` — 488 — core AMCP batch builder for a scene onto the PRV look stack.
  - `lib/scenes-preview-look-stack.js` — 155 — look-stack layer constants and helpers shared by push and clear.
  - `lib/scenes-preview-snapshot.js` — 77 — content comparison keys (which changes force a full re-PLAY vs MIXER-only).
  - `lib/scenes-preview-edit-chrome.js` — 98 — WO-339 editing chrome rendered on the PRV channel (outline and label per layer).
  - `lib/scene-route-preview-remap.js` — 130 — intra-look `route://` remapping for the preview push.
  - `lib/scene-live-sync.js` — 73 — keep client scene.live and per-main preview slots aligned with the server.
  - `lib/scene-live-main-sync.js` — 159 — derive per-main PGM/PRV look ids from scene.live.
  - `lib/scene-live-match.js` — 76 — compare edited scene to the persisted program snapshot (pure).
  - `lib/look-stack-amcp-channel.js` — 52 — Caspar channel for look-stack preview / compose.
  - `lib/look-air-compose-channel.js` — 45 — compose-preview channel when a look is on PGM or PRV.

- What the operator can do:
  - Preview push happens implicitly when a look is selected or edited; the operator sees the PRV bus update (B).
  - Live geometry/opacity/crop nudges while dragging (`scenes-preview-runtime-mixer-nudge.js` header `:2`, throttle `:14`).
  - Clear a main's preview bus (`scenes-preview-runtime-clear.js`).
  - Border-only push (`scenes-preview-runtime.js:431` `pushBorderOnly`, global event `highascg-global-border-push`).

- Rendering tech: none (AMCP is the rendering path; the client only builds command strings). Canvas-based previews are B.

- Interaction: none (no DOM events in this group except `pointermove` at `scenes-preview-runtime.js` (1 use, a drag hint)).

- Server contract (HTTP):
  - `POST /api/scene/take` (preview target) — `components/scenes-preview-runtime.js:227`, `:292`.
  - `POST /api/scene/live/preview` — `lib/scene-live-sync.js:31`.
  - `GET /api/scene/live` — `lib/scene-live-sync.js:50`.
  - `POST /api/scene/live/preview/clear` — `lib/scene-live-sync.js:66`.
  - `POST /api/scene/border-lines` — `components/scenes-preview-runtime-clear.js:92`; `lib/scenes-preview-global-border.js:245`; `lib/scenes-preview-push-scene.js:404`.
  - `POST /api/preview/mixer-nudge` — `components/scenes-preview-runtime-mixer-nudge.js:127`.
  - `GET /api/media` (media list cache) — `lib/scenes-preview-push-scene.js:52` (`mediaListCachePromise`; comment `:38` says it is expensive server-side).
  - `POST /api/scene/border-preset-crossfade` — `lib/scenes-preview-global-border.js:111`.

- Server contract (WS): `change` path `scene.live` (with `seq`) is applied via `sceneState.applyServerLiveChannels` (`lib/app-ws-handlers.js:142-158`, out of scope). Seq gap triggers `refreshSceneLiveFromServer` (`lib/app-ws-handlers.js:147-152`; `lib/scene-live-sync.js:50`).

- Client state:
  - `scene.live` (server truth), per-main preview slots (`lib/scene-live-main-sync.js` exports `syncMainSlotsFromSceneLive`, `resolveBusLookIdsForMain`).
  - `mediaListCachePromise` (module-level, `lib/scenes-preview-push-scene.js:52`).
  - Throttle and queue state in closures (`scenes-preview-runtime.js:27` factory).

- Browser-only APIs: `setTimeout`/`setTimeout`-based throttles (`scenes-preview-runtime.js` 7 uses; `scenes-preview-runtime-mixer-nudge.js` 2 uses), `Date.now` (`scenes-preview-runtime.js`, `mixer-nudge` 2), `requestAnimationFrame` (`scenes-preview-runtime.js`), dynamic `import('../lib/media-exists.js')` at `scenes-preview-runtime.js:235` (WO-360 missing-media warning on take).

- Port-risk notes:
  - Pure, portable: `lib/scenes-preview-snapshot.js` (content key projection, comment `:1-3`), `lib/scene-live-match.js` (mirrors `scene-transition.js` comparisons; header `:2`), `lib/scene-route-preview-remap.js` (string remap), `lib/scenes-preview-look-stack.js` (layer number constants), `lib/scene-live-main-sync.js` (derivation rules, mirrored in `src/engine`).
  - Tricky: the "full re-PLAY vs MIXER-only" decision (`scenes-preview-snapshot.js`), the coalesced serialized PRV queue (`scenes-preview-runtime.js:93-156`), the intra-look route remap (`scene-route-preview-remap.js`), the seq-gap recovery (`app-ws-handlers.js:147`).
  - Strings only: most logic here builds AMCP command text; this is portable if the AMCP builder is ported unchanged.

---

## H. Scene/look state model and persistence

- Files:
  - `lib/scene-state.js` — 492 — `SceneState` class: scenes, looks, layers, global borders, timers, presets, persistence.
  - `lib/scene-state-helpers.js` — 228 — layer number bands (`LOOK_LAYER_FIRST`, `LOOK_LAYER_STEP`, `LOOK_LAYER_MAX`), `nextLayerNumber`, `defaultTransition`, `previewChannelLayerForSceneLayer`, `defaultLayerConfig`, `newId`, `migrateScene`.
  - `lib/scene-state-layer-logic.js` — 164 — layer style data, layer number reassignment, reorder, patch, recent-edit guard.
  - `lib/scene-state-layer-ops.js` — 112 — `mixinSceneStateLayerOps` (SceneState method mixin).
  - `lib/scene-state-look-logic.js` — 116 — unique look names, preset import, `applySceneFromTakePayload`.
  - `lib/scene-state-persistence-logic.js` — 219 — localStorage v1 to v2 migration, `getPersistPayload`, `applyPersistedData`, main-editor visibility.
  - `lib/scene-state-preset-actions.js` — 142 — layer style clipboard, layer and look presets, server preset imports.
  - `lib/scene-state-preset-ops.js` — 73 — preset wrapper methods (mixin).
  - `lib/program-output-state.js` — 267 — per-main PGM layer mixer rectangles (labels and pixel mixer settings); localStorage per screen.
  - `lib/program-layer-bank.js` — 9 — `normalizeProgramLayerBank` (10+ vs 110+ stack selection).

- What the operator can do (via the UI in D/E/F/M): create, rename, duplicate looks; add/remove/reorder layers; save and recall layer and look presets; copy/paste layer style; set per-main main-editor visibility; set the program layer bank (not operator-set in this group; read).

- Rendering tech: none.

- Interaction: none directly (state only).

- Server contract (HTTP):
  - Preset imports: `sceneStateImportLayerPresetsFromServer`, `importLookPresetsFromServer` (`lib/scene-state-preset-actions.js`, `lib/scene-state-look-logic.js`) — the endpoint is read from the caller; not verified in this group.
  - Persistence is client-local plus the server's `scene.deck` broadcast (see G/H WS below).

- Server contract (WS): `change` `scene.deck` (ingested as REMOTE data via `ingestRemoteDeckScenes`, `lib/app-ws-handlers.js:159-165`; WO-341 comment in `lib/scene-state.js:194`). `scene.globalBorders` (`app-ws-handlers.js:166-168`).

- Client state:
  - localStorage: `casparcg_scenes_v2` (`STORAGE_KEY`, `lib/scene-state-persistence-logic.js:11`), legacy `casparcg_scenes_v1` (`:10`, migrated and removed at `lib/scene-state.js:132-136`). Save on `scene-state.js:162`, `:189`, `:474`.
  - localStorage: `casparcg_program_output` (`lib/program-output-state.js:19`), per-screen keys via `storageKey(screenIdx)` (`:25`) with legacy fallback (`:29`, `:121-130`).
  - Layer number bands: look clips on PGM/PRV use layers 10, 11, 12... (`scene-state-helpers.js:3-7`, header); 1-9 reserved; PIP CG in 260+ (J).

- Browser-only APIs: `localStorage` (try/catch around reads and writes), `Date.now` (`scene-state-helpers.js`, `scene-state-layer-logic.js` 3 uses, `scene-state-global-border.js` 4 uses), `setTimeout` (`scene-state.js:157`, deferred persist timer).

- Port-risk notes:
  - Portable: `scene-state-helpers.js` (band constants and `nextLayerNumber`, `migrateScene`), `scene-state-persistence-logic.js` (serialize/deserialize; the v1-to-v2 migration rules), `program-layer-bank.js`.
  - Tricky: layer-number bands (LOOK_LAYER_* and PIP bands) must stay aligned with `src/` (per header comments); the migration (`migrateScene`); the `Date.now`-based recent-edit guard (`isLayerRecentlyEdited`, `scene-state-layer-logic.js`).
  - The class is a shared mutable store with method mixins (`mixinSceneState*Ops`); a Godot port needs an explicit state object.

---

## I. Transitions

- Files:
  - `lib/transition-presets.js` — 76 — transition type constants and pure helpers (`DEFAULT_TRANSITION`, `TRANSITION_TYPES`, `TRANSITION_TWEENS`, `PGM_ONLY_TRANSITION_TYPES`, `migrateTransitionTypeToAnimate`, `normalizeTransitionForPgmOnly`).
  - `lib/transition-duration.js` — 37 — duration helpers; sentinel `AUTO_TRANSITION_DURATION_SENTINEL = 12` means half the project fps (`:1-4` header).

- What the operator can do: pick a transition type and tween, set a duration (or auto), for look take. UI is `mountLookTransitionControls` in `components/scenes-shared.js:85` (E group).

- Rendering tech: none.

- Interaction: none in this group (UI in E).

- Server contract: transition values are sent in the take payload (E: `scenes-editor-support.js` take body, `scenes-preview-runtime.js:227-236`).

- Client state: part of the look's `transition` object (H, `defaultTransition` in `scene-state-helpers.js`).

- Browser-only APIs: none.

- Port-risk notes: fully pure (no DOM, no state import; header `transition-presets.js:2`). Portable as-is. Note the sentinel rule (`transition-duration.js`).

---

## J. Global border, PIP overlays, effects

- Files:
  - `lib/scene-state-global-border.js` — 377 — per-screen global border read/write helpers for SceneState; default template; remote apply; preset slots.
  - `lib/scene-state-global-border-ops.js` — 53 — mixin wrappers for the above.
  - `lib/scenes-preview-global-border.js` — 309 — global border slot resolution and AMCP helpers for PRV preview (PGM 998/996, PRV 997 mirror).
  - `lib/global-border-artnet-map.js` — 113 — Art-Net DMX channel map (18 offsets from `artnetPatch.startChannel`).
  - `lib/global-border-artnet-ws.js` — 85 — throttled Art-Net to UI bridge; dispatches `global-border-artnet` window event.
  - `lib/pip-overlay-amcp.js` — 466 — browser-side PIP overlay AMCP line builders (mirrors `src/engine/pip-overlay.js`).
  - `lib/pip-overlay-registry.js` — 330 — PIP overlay catalog (HTML-template overlays); CG layer band `260-979` (WO-160).
  - `lib/effect-registry.js` — 371 — catalog of CasparCG mixer effects, defaults, schemas, AMCP body builders.
  - `lib/effect-apply-live.js` — 129 — live AMCP apply for mixer effect param edits.

- What the operator can do:
  - Edit per-screen global border settings and recall border presets (`highascg-border-preset-recall` from `scenes-editor.js:131`, `highascg-global-border-push` `:137`; `scene-list-column.js:184` opens the border panel).
  - Add PIP overlays and effects to layers (inspector UI is out of scope; the catalog and AMCP builders are here).
  - Live-apply effect parameters: `POST /api/mixer/effect` (`lib/effect-apply-live.js:125`).

- Rendering tech: none in this group (AMCP and DMX data; the overlays are rendered by CasparCG HTML templates).

- Interaction: none in this group. Window event `global-border-artnet` (`lib/global-border-artnet-ws.js:55-56`) is consumed by UI.

- Server contract (HTTP):
  - `POST /api/scene/border-preset-crossfade` — `lib/scenes-preview-global-border.js:111`.
  - `POST /api/scene/border-lines` — `lib/scenes-preview-global-border.js:245`, `components/scenes-preview-runtime-clear.js:92`, `lib/scenes-preview-push-scene.js:404`.
  - `POST /api/mixer/effect` — `lib/effect-apply-live.js:125`.

- Server contract (WS): `change` path `scene.globalBorders` (`lib/app-ws-handlers.js:166-168`); `global_border_sync` (`app-ws-handlers.js:211`, out of scope) feeds `ingestArtnetGlobalBorderSync` (`lib/global-border-artnet-ws.js`). The Art-Net side is not a browser socket: the bridge is fed by WS (see `:20-25` header of `global-border-artnet-ws.js`, "must not emit sceneState change").

- Client state: `scene.globalBorders` array in SceneState (H); `artnetPatch.startChannel`; per-screen slots.

- Browser-only APIs: `window.dispatchEvent(CustomEvent)` (`global-border-artnet-ws.js:55`), `setTimeout` (`global-border-artnet-ws.js` 1 use; throttle).

- Port-risk notes:
  - Pure: `effect-registry.js` (schemas and `effectToAmcpBody`/`effectToAmcpLines`), `pip-overlay-amcp.js` (string builders), `global-border-artnet-map.js` (channel offset table), `scenes-preview-global-border.js` (slot math and AMCP builders).
  - Tricky: fixed layer numbers (998/996/997 for borders, 260-979 band for PIP; see `scenes-preview-global-border.js:1-5`, `pip-overlay-registry.js:1-4`) must match the server.
  - The Art-Net throttle rule must not emit `change` every frame (`global-border-artnet-ws.js:3-4`).

---

## K. Sources panel (media, effects, templates, placeholders, ingest)

- Files:
  - `components/sources-panel.js` — 371 — orchestrator: tabs (Media, Effects, Live, Timelines, Templates, Placeholders), refresh, keyboard Delete, store listeners.
  - `components/sources-panel-shell.js` — 51 — DOM shell (tabs, list host, ingest footer).
  - `components/sources-panel-render.js` — 186 — tab render orchestration.
  - `components/sources-panel-helpers.js` — 489 — drag payload for items, modifier-click (download / delete), source list rendering, icons, probe overlay merge, live-source builder.
  - `components/sources-panel-media.js` — 291 — media browser: folders, drag to folder, drop targets, selection, delete.
  - `components/sources-panel-media-selection.js` — 125 — multi-select copy / move / delete.
  - `components/sources-panel-project-gather.js` — 167 — project media bar and gather-into-folder.
  - `components/sources-panel-effects.js` — 49 — Effects tab (categories, draggable effect items).
  - `components/sources-panel-templates.js` — 116 — Templates tab (Caspar TLS list, draggable templates, timer child rows, shader audition).
  - `components/sources-panel-placeholders.js` — 76 — Placeholders tab (virtual simulation media).
  - `components/placeholder-modal.js` — 105 — add or edit a placeholder asset (modal).
  - `components/sources-panel-ingest-ui.js` — 270 — ingest dropup, replication sync UI, USB badge, offline placeholders, drop onto root.
  - `components/sources-panel-ingest-logic.js` — 84 — upload and URL download logic, download poller.
  - `components/sources-panel-hap-encode.js` — 81 — HAP encode jobs for selected media (`media:hap-encode` WS).
  - `lib/thumbnail-url.js` — 142 — thumbnail URL builders (`/api/thumbnail/...`), source-to-thumb resolution.
  - `lib/thumbnail-error-handler.js` — 80 — thumbnail error retry logic (one delayed retry).

- What the operator can do:
  - Browse media, folders, effects, templates, placeholders; filter by tab.
  - Drag a media item onto a folder (`sources-panel-media.js:136-151`), onto a scene (E/F) or the multiview (M); drag an effect (`sources-panel-effects.js` `draggable`) onto a layer.
  - Select multiple media (`sources-panel-media-selection.js`); copy, move, delete (`sources-panel.js:325-328`).
  - Ctrl+click or ⌘+click downloads a file; Ctrl+Alt+click or ⌘+⌥+click removes it from the server (`sources-panel-helpers.js:73-74`).
  - Rename a media item (`sources-panel.js:313`) or a timeline by right-click (`sources-panel-helpers.js:189-193`, `prompt('Rename timeline', label)`).
  - Delete selection with Delete or Backspace (`sources-panel.js:336-342`).
  - Upload files and URLs, watch download progress (`sources-panel-ingest-logic.js:67-78`, `sources-panel-ingest-ui.js:243-250`).
  - Create placeholders (`placeholder-modal.js`; Escape closes, `:81`), open ShaderFX (`sources-panel-ingest-ui.js:239`), audition shaders (`sources-panel-templates.js:102-103`).
  - Open a sub-app at `http://127.0.0.1:4300/` (`sources-panel-templates.js:83`, `window.open` with `noopener,noreferrer`).

- Rendering tech:
  - DOM only: lists, icons, buttons, thumbnails as `<img>` (via `thumbnail-url.js`).
  - Thumbnails: `lib/thumbnail-error-handler.js` (`createElement('img')`, 1 use); `thumbnail-url.js` returns URL strings.
  - Object URL: `sources-panel-helpers.js:57` (`URL.createObjectURL(blob)` for a download).

- Interaction:
  - HTML5 DnD: `sources-panel-helpers.js:115` (`el.draggable = true`), `:120` (`dragstart`), payload `application/json` and `text/plain` (`:137-145`); `sources-panel-media.js:136` (`dragover`), `:137` reads `application/json`, `:148` (`dragleave`), `:149` (`drop`); `sources-panel-ingest-ui.js:179-183` (`root.ondragover`, `root.ondrop`) for file upload, plus `dragenter`/`dragleave`/`dragover`; `sources-panel-decklink-drop.js:73-82` (`listEl` drop, `application/x-highascg-connector` `:11`); `sources-panel-effects.js` and `sources-panel-templates.js` (`draggable`).
  - Context menu: `sources-panel-helpers.js:189` (`contextmenu`, prompt rename for timelines).
  - Keyboard: `sources-panel.js:336-342` (Delete/Backspace on the media selection; ignores inputs).
  - Modals: `placeholder-modal.js` (`keydown` `:83`, Escape `:81`); `confirm(` in `sources-panel-helpers.js`, `sources-panel-media.js`, `sources-panel-project-gather.js`, `sources-panel-placeholders.js`; `alert(` in `sources-panel-media.js`, `sources-panel-helpers.js`.
  - Window events: `media-file-select` (`sources-panel-media-selection.js:66`), `media-library-changed` (`sources-panel.js:321`), `timeline-redraw-request` (`sources-panel-helpers.js:201`), `shader-audition-request` (`sources-panel-templates.js:102`), `scenes-refresh-preview` (`sources-panel-project-gather.js:129`), `project-loaded` (`:130`).

- Server contract (HTTP):
  - `GET /api/state` — `sources-panel.js:72`. `GET /api/device-view` — `:95`. `GET /api/media` — `:124`. `GET /api/templates` — `:132`. `POST /api/media/refresh` (`ensureHqThumbs: true`) — `:142`.
  - `GET /api/shaders` — `sources-panel-templates.js:20`.
  - `GET /api/local-media/:id/file` (download) — `sources-panel-helpers.js:31-32`.
  - `POST /api/media/delete` — `sources-panel-helpers.js:92`; `sources-panel-media.js:125`.
  - `PUT /api/timelines/:id` — `sources-panel-helpers.js:194`.
  - `POST /api/media/mkdir` — `sources-panel-ingest-ui.js:218`; `sources-panel-media-selection.js:92`.
  - `POST /api/ingest/upload` (multipart with progress) — `sources-panel-ingest-logic.js:67`.
  - `GET /api/ingest/download-status` — `sources-panel-ingest-logic.js:78`; `POST /api/ingest/download` — `sources-panel-ingest-ui.js:250`.
  - `GET /api/usb/drives` — `sources-panel-ingest-ui.js:133`.
  - `POST /api/device-view` `{updateConnector: {id, patch: {caspar: {ioDirection: 'in'}}}}` — `sources-panel-decklink-drop.js:46`.
  - Ingest also reads `/api/media` after upload (`sources-panel-ingest-logic.js` via `refreshMedia`).

- Server contract (WS):
  - `usb:attached`, `usb:detached` — `sources-panel-ingest-ui.js:153-154` (`wsClient.on`).
  - `media:hap-encode` — `sources-panel-hap-encode.js:65`.
  - `state.media` read as a merge source (`sources-panel-helpers.js:295` comment; `stateStore` `media`).

- Client state:
  - stateStore: `channelMap`, `extraLiveSources`, `decklinkInputsStatus`, `liveAudioInputsStatus`, `offline`, `*` (`sources-panel.js:354-358`; `sources-panel-ingest-ui.js:267`).
  - Module state: selected media `Set` (`sources-panel.js` `selectedMedia`), `currentTab`.
  - localStorage: none in this group.

- Browser-only APIs: HTML5 DnD and `DataTransfer` (see above), `URL.createObjectURL` (`sources-panel-helpers.js:57`), `FormData` / multipart upload (`postFormDataWithProgress`, `sources-panel-ingest-logic.js:67`, `XMLHttpRequest`-style progress callbacks), `window.open`, `prompt`/`confirm`/`alert`, `contextmenu`, `setInterval` (`sources-panel-ingest-logic.js` for the download poll), `requestAnimationFrame` (`sources-panel.js:1 use`).

- Port-risk notes:
  - Portable: `lib/thumbnail-url.js` (URL builders), the media merge rules in `sources-panel-helpers.js` (`mergeMediaProbeOverlay`, `mediaCatalogMergeKey`), `sources-panel-ingest-logic.js` (`collectDroppedFiles` depends on DataTransfer, so only the upload contract ports).
  - DOM-entangled: almost all of K. Drag payloads use MIME-typed JSON, so a Godot drag system needs an equivalent typed payload.
  - Caveat: the Sources drag contract is the source of truth for drops in C, E, F, M. A port must keep the `application/json` shape `{type, value, label}` and the `text/plain` fallback (`operator-compose-tiles.js:305-307`, `multiview-editor.js` drop, `scenes-shared.js:43-56`).

---

## L. Live inputs and live audio

- Files:
  - `components/sources-panel-live-render.js` — 326 — Sources "Live" tab render: slots, status, thumbnails, capture and upload of still thumbs.
  - `components/sources-panel-live-render-actions.js` — 223 — per-slot actions (apply, restart, stop, remove, fullscreen, select).
  - `components/sources-panel-decklink-drop.js` — 90 — drag a DeckLink connector to a live input mapping.
  - `components/live-input-modal.js` — 394 — modal: add live inputs (DeckLink, NDI, webpage host, live audio, USB video).
  - `components/live-input-modal-shell.js` — 474 — modal DOM shell.
  - `components/live-input-modal-shell-v4l2.js` — 131 — USB/V4L2 section of the modal.
  - `components/live-input-modal-submit.js` — 284 — submit flows per kind.
  - `components/live-audio-mixer-modal.js` — 378 — audio mixer "+" modal: configure and remove ALSA live inputs.
  - `lib/live-audio-inputs.js` — 274 — ALSA/USB live audio slots on dedicated Caspar channels (slot math, layer bases).
  - `lib/live-audio-add-input.js` — 86 — add a live audio slot (dedicated host channel).
  - `lib/live-audio-remove-input.js` — 56 — remove a live audio slot.
  - `lib/live-audio-play.js` — 46 — start/stop ALSA capture on a program or any channel/layer.
  - `lib/live-audio-play-targets.js` — 208 — per-slot play routing (localStorage-backed).
  - `lib/live-audio-routing.js` — 150 — capture on dedicated input channels; PGM via `route://`.
  - `lib/live-audio-state.js` — 20 — shared live-audio API hydration.
  - `lib/live-input-start.js` — 87 — start/restart one input's capture producer.

- What the operator can do:
  - Add a DeckLink, NDI, webpage host, live audio (ALSA), or USB video input from the Live tab or the modal (`live-input-modal.js`; `live-input-modal-submit.js:92`, `:133`, `:183` `POST /api/device-view` with `addExtraLiveSource`).
  - Apply, restart, stop, remove each live slot (`sources-panel-live-render-actions.js:16-76`).
  - Put a live input on PGM (`sources-panel-live-render-actions.js:59-60` `PLAY … DECKLINK`), or stop and clear (`:59`, `:65`).
  - Drag a DeckLink connector onto a live input (`sources-panel-decklink-drop.js:46`).
  - Route an audio slot to PGM and set play targets (`lib/live-audio-routing.js`, `lib/live-audio-play-targets.js`).
  - Capture a still thumbnail (`sources-panel-live-render.js:187-192`) or upload one (`:211-227`).
  - Enter operator fullscreen for a source (`sources-panel-live-render-actions.js:100-104`, `POST /api/host-live/operator-fullscreen`).
  - Remove a live source (`sources-panel-live-render-actions.js:126`, `:162`, `:193`, `:209`).

- Rendering tech: DOM (lists, slots, modals). Thumbnail `<img>` via `lib/thumbnail-url.js`. No canvas. No video element in this group (live video is the Caspar channel shown in B/M/C through their canvases or the operator GUI holes).

- Interaction:
  - Click: many `onclick` handlers (`sources-panel-live-render-actions.js:16, 41, 57, 65, 100, 126, 162, 193, 209`; `sources-panel-live-render.js:187, 211`).
  - Drag: `sources-panel-decklink-drop.js:73` (`dragover`), `:79` (`dragleave`), `:82` (`drop` async); DeckLink connector data `application/x-highascg-connector` (`:11`).
  - Keyboard: `live-input-modal.js:380` (Escape, `document` `keydown`), `live-audio-mixer-modal.js:66` (`document` `keydown`, Escape at `:61`).
  - Modals: `live-input-modal.js`, `live-audio-mixer-modal.js` (`modal.querySelector('#live-audio-mixer-close').onclick` at `:56`), `live-input-modal-submit.js`.
  - Confirm: `confirm(` in `sources-panel-live-render-actions.js` (5 uses).
  - Window events: `v4l2-input-select` (`sources-panel-live-render-actions.js:31`), `ndi-host-select` (`:148-168`), `browser-display-select` (`:179-199`), `webpage-host-select` (`sources-panel-live-render.js:277`), `scene-layer-select` (`sources-panel-live-render.js:306`).
  - Document events: `highascg-settings-applied` (`live-audio-mixer-modal.js:352,357`, `live-input-modal-submit.js:216,263`), `highascg-live-audio-configured` (`live-input-modal-submit.js:217`), `highascg-v4l2-configured` (`:264`), `highascg-device-view-reload` (listened in `sources-panel.js:282`, dispatched from `lib/mapping-state.js:238`).

- Server contract (HTTP):
  - `GET /api/audio/devices` (`?refresh=1` variants) — `live-audio-mixer-modal.js:89`, `live-input-modal.js:275`, `:300`.
  - `POST /api/audio/live-inputs/config` — `live-audio-mixer-modal.js:322`, `lib/live-audio-add-input.js:58`, `lib/live-audio-remove-input.js:50`.
  - `GET /api/audio/live-inputs` — `lib/live-audio-state.js:11`.
  - `POST /api/audio/live-inputs/apply` — `lib/live-audio-routing.js:61`, `sources-panel-live-render-actions.js:20`.
  - `POST /api/audio/inputs/start` — `lib/live-input-start.js:69`.
  - `POST /api/v4l2-inputs/apply` — `sources-panel-live-render-actions.js:45`.
  - `GET /api/system/v4l2-devices?refresh=1` — `live-input-modal.js:274`.
  - `GET /api/ndi/list` — `live-input-modal.js:338`.
  - `GET /api/device-view` — `live-input-modal.js:107`; `POST /api/device-view` — `live-input-modal-submit.js:92,133,183`; `sources-panel-live-render-actions.js:75-76,134,214` (`removeExtraLiveSource`); `sources-panel-decklink-drop.js:46-47`.
  - `POST /api/raw` with AMCP text: `lib/live-audio-play.js:28-45` (`STOP`, `MIXER CLEAR`, `PLAY … LOOP`, `MIXER … OPACITY 0`); `lib/live-audio-routing.js:29-46` (`PLAY ${cl} ${clip}`); `sources-panel-live-render-actions.js:59-65` (`STOP`, `MIXER CLEAR`, `PLAY … DECKLINK`).
  - `POST /api/host-live/operator-fullscreen` — `sources-panel-live-render-actions.js:104`, `:132`.
  - `POST /api/thumbnail/live/capture` — `sources-panel-live-render.js:192`; `POST /api/thumbnail/live/upload?channel=` (multipart) — `:226-227`.

- Server contract (WS): `highascg-…` are DOM events, not WS. WS: none read directly in this group (live status arrives via `stateStore` keys `decklinkInputsStatus`, `liveAudioInputsStatus`, `extraLiveSources` in K/`sources-panel.js:354-357`).

- Client state:
  - localStorage `highascg_live_audio_play_targets` (`lib/live-audio-play-targets.js:7`) and `highascg_live_audio_play_targets_multi` (`:8`). Persisted until the server stores play targets on slots (comment `:3`).
  - Module state: `live-audio-state` hydration cache.
  - Constants: `LIVE_AUDIO_MAX_SLOTS`, `LIVE_AUDIO_PGM_LAYER_BASE`, `LIVE_AUDIO_LAYER_BASE`, `INPUT_PGM_AUDIO_LAYER_BASE` (`lib/live-audio-inputs.js`, `lib/live-audio-routing.js`).

- Browser-only APIs: `document`/`window` `keydown` and `CustomEvent`, `setTimeout` (`live-input-modal.js` 1 use), `DataTransfer`-like connector data, `FormData`/multipart upload (`sources-panel-live-render.js:226`), `fetch` (`:227`), `Date.now` (`sources-panel-live-render.js` 4 uses, cache-busting).

- Port-risk notes:
  - Portable: slot math and layer-base constants (`live-audio-inputs.js`, `live-audio-routing.js`), AMCP text builders, play-target normalization.
  - Tricky: the rule that PGM never uses `alsa://` directly; capture always on a dedicated input channel and PGM uses `route://` (header `live-audio-routing.js:1-3`, `live-audio-inputs.js` header `:2`).
  - DOM-entangled: the modals and the Live tab.

---

## M. Multiview editor

- Files:
  - `components/multiview-editor.js` — 478 — canvas editor for the multiviewer layout: pointer editing, presets, live toggle, apply, keyboard delete.
  - `components/multiview-editor-canvas.js` — 24 — barrel for the canvas helpers.
  - `components/multiview-editor-canvas-draw.js` — 182 — `drawMultiviewEditor`: cells, borders, label strips, handles, drop hover.
  - `components/multiview-editor-canvas-interaction.js` — 80 — hit testing and resize-handle logic (`fitInContainer`, `toCanvas`, `getCellAt`, `getResizeHandle`).
  - `components/multiview-editor-canvas-layout.js` — 263 — cell dimension solver, source resolution, contained video rect, label/timer overlay math.
  - `components/multiview-editor-canvas-apply.js` — 107 — `applyMultiviewLayout` (`/api/multiview/apply` with fallbacks), `applyMultiviewAudioFocus`.
  - `lib/multiview-state.js` — 413 — `MultiviewState`: cells, layout, 4 presets per multiviewer, localStorage, audio focus, live `apply` body builder.
  - `lib/multiview-state-layout.js` — 112 — layout defaults, normalization, API layout shape (`cellsToApiLayout`).

- What the operator can do:
  - Drag a cell to move it, drag a handle to resize (`multiview-editor.js:274-276`, `multiview-editor-canvas-interaction.js:43-57`).
  - Click a cell to set the audio-active cell (`multiview-editor.js:380`).
  - Right-click a cell to clear its source (or remove the cell if it has none) (`multiview-editor.js:379`).
  - Drop a source (media, route) onto a cell or the canvas (`multiview-editor.js:381-383`; `dropHoverId` highlight `:381`).
  - Delete or Backspace to remove the selected cell (`multiview-editor.js:416-431`).
  - Presets: click to recall, Shift+click to clear one of four slots (`multiview-editor.js:190`).
  - Reset the layout (`multiview-editor.js:191`), refresh (`:196`), toggle live full-output on/off (`:236-240`, `mvOperatorFullOutput`).
  - Apply to CasparCG (auto-apply when enabled, else on demand; `multiview-editor-canvas-apply.js:48-107`).

- Rendering tech:
  - Canvas 2D: `multiview-editor.js:131` (`canvas = wrap.querySelector('canvas'); ctx = canvas.getContext('2d')`); `drawMultiviewEditor` (`multiview-editor-canvas-draw.js:17`, `ctx` parameter); `requestAnimationFrame` (`multiview-editor.js`, 1 use).
  - Live video: the live preview of cells is not drawn into the canvas; the editor reports rects to the operator GUI (A) and shows the operator full output in a `<div>` `#mv-video` (`multiview-editor.js:131`).
  - `ResizeObserver` `multiview-editor.js:186`.

- Interaction:
  - Pointer: `canvas.onmousedown` (`:274`), `onclick` (`:380`), `oncontextmenu` (`:379`), `mousemove`/`mouseup` handlers (`multiview-editor.js` 1 `pointermove`, 2 `mouseup`, 1 `mousedown`, `mousemove`); `getBoundingClientRect` used for hit testing (11 uses).
  - HTML5 DnD: `canvas.ondragover` (`:381`), `ondragleave` (`:382`), `ondrop` (`:383`) (JSON then `text/plain`, self-route guard `mvSelfRouteMessage` with a toast `:90`, `showAppToast`).
  - Keyboard: document `keydown` (`:431`), Delete/Backspace when `#tab-multiview` active and not typing (`:416-428`).
  - Window events: `multiview-select` (`:276`); `multiviewState` events `change` (`:412`), `apply-request` (`:413`), `audio-change` (`:414`).
  - Alerts: `alert(...)` (`multiview-editor-canvas-apply.js:97`) when the apply route is missing (server build).

- Server contract (HTTP):
  - `POST /api/multiview/apply` — `multiview-editor-canvas-apply.js:68`; `multiview-editor.js:210` (recovery after a CasparCG restart, `:194`).
  - `POST /api/multiview` (fallback) — `multiview-editor-canvas-apply.js:82`.
  - `POST /api/amcp/batch` (AMCP fallback, `commands`) — `multiview-editor-canvas-apply.js:38`.
  - `POST /api/operator-gui/layout` for the mvedit surface (A).

- Server contract (WS): `change` (indirect) through `scheduleMultiviewRefresh` (`lib/app-ws-handlers.js:178`, `:181`) and `caspar.connection` (`app-ws-handlers.js:180-183`). `state` via `stateStore` `'*'` (`multiview-editor.js:467`).

- Client state:
  - localStorage: `casparcg_multiview_layout` (`lib/multiview-state.js:9`), suffixed `_<index>` for multiviewers 2+ (`:56`, `:261`, `:324`); presets `casparcg_multiview_presets_v1` (`:11`), same suffixing (`:378`, `:394`, `:405`).
  - `multiviewState` event emitter; `stateStore.on('*')` (`multiview-editor.js:467`).
  - `stateStore.channelMap` via `getCM` (`multiview-editor.js:80`).

- Browser-only APIs: `ResizeObserver` (`:186`), `getBoundingClientRect` (11), `requestAnimationFrame` (1), `setTimeout` (1), `contextmenu`, HTML5 DnD (`dragover` `:381`, `dragleave`, `drop` `:383`), `keydown` on document (`:431`), `localStorage` (`multiview-state.js`), `Date.now` (`multiview-state.js`).

- Port-risk notes:
  - Portable: `multiview-state-layout.js` (`cellsToApiLayout`, defaults), `multiview-editor-canvas-layout.js` (cell dimension solver, `solveCellDimensions`, `solveCellDimensionsStagePx`, `getContainedVideoRect`, `resolveSourceAspectRatio`; header `:1-4` ties timer-title height to `src/api/multiview-layout-helper.js`), `multiview-state.js` apply-body builder (`:304`).
  - Tricky: the mapping from canvas pixels to the 0-1 layout (`multiview-state-layout.js:92` normalizes editor cells "to the 0-1 layout shape `/api/multiview/apply` expects"); the per-cell hole rule for operator GUI (`mvcell` role, A).
  - DOM-entangled: the editor shell, canvas event handlers, and the drop hit tests.

---

## N. Mapping, screen destinations, editor defaults (config adjacent to live ops)

- Files:
  - `lib/mapping-state.js` — 247 — `MappingState` for slices and fixtures of a mapping node; `device-view` save.
  - `lib/mapping-node-service.js` — 429 — single source of truth for pixel-mapping device-graph mutations (output resolution, output layout proposal, save).
  - `lib/screen-consumer-defaults.js` — 136 — default CasparCG screen consumer flags (windowed, borderless, vsync), body fragments for `POST /api/settings`.
  - `lib/screen-destination-index.js` — 34 — next `mainScreenIndex` for a new destination.
  - `lib/screen-label.js` — 18 — `screenLabel` (custom or `S<n>`).
  - `lib/program-audio-layouts.js` — 147 — per-main program bus layout from Device View destinations.
  - `lib/editor-defaults.js` — 142 — Settings → Defaults applied when creating layers/clips/looks.
  - `lib/editor-defaults-constants.js` — 64 — defaults schema and merge helper (no imports; cycle-breaker).

- What the operator can do: this group is config. Operators reach it via Device View / Settings (out of scope). In the live ops, these supply the screen labels, the default transitions and layers, and the program audio layout per main.

- Rendering tech: none (`mapping-node-service.js` is pure logic over the device graph).

- Interaction: none.

- Server contract (HTTP):
  - `GET /api/device-view?_ts=` — `lib/mapping-node-service.js:148`; `POST /api/device-view` `{deviceGraph}` — `:152`; `POST /api/device-view` `{removeMappingNode}` — `:296`.
  - `GET /api/device-view`, `POST /api/device-view` `{deviceGraph}` — `lib/mapping-state.js:230-236`.
  - `POST /api/settings` — body fragments only in `lib/screen-consumer-defaults.js:52`, `:99`, `:129`; the POST is made by callers.

- Server contract (WS): `highascg-device-view-reload` dispatched from `lib/mapping-state.js:238` after a save; consumed in `components/sources-panel.js:282`.

- Client state: `stateStore` `channelMap` (`program-audio-layouts.js` reads destinations from device view), `editor-defaults` in localStorage? (check: `editor-defaults.js` holds `getEditorDefaults`; storage not verified in this pass, so not claimed).

- Browser-only APIs: `document.dispatchEvent(CustomEvent('highascg-editor-defaults-changed'))` (`lib/editor-defaults.js:78-79`), `Date.now` (`mapping-node-service.js` 3 uses, `mapping-state.js` 1).

- Port-risk notes:
  - Portable: `mapping-node-service.js` (pure graph mutations, `resolveDestinationDims`, `videoModeToResolution`, `formatCustomVideoMode`), `screen-consumer-defaults.js` (flag tables), `program-audio-layouts.js` (layout derivation), `editor-defaults-constants.js`, `screen-label.js`, `screen-destination-index.js`.
  - Tricky: the `videoModeToResolution` / custom-mode parse, the audio layout per main derivation.

---

## O. Playback timers and clocks

- Files:
  - `components/playback-timer.js` — 472 — inline elapsed/total/remaining from OSC layer `file/time`; PGM top-layer timer; progress bar and colour tiers.
  - `components/playback-timer-format.js` — 141 — formatting (`formatHmsf`, `formatMmSs`), colour tiers, `paintPlaybackDisplay`, `createPlaybackTickLoop`.
  - `lib/playback-clock.js` — 25 — client-side time from `playback.matrix` (startedAt + durationMs), no polling.
  - `lib/playback-timing-clock.js` — 229 — wall-clock extrapolation between sparse OSC `file/time` (and INFO) updates; frame-based fallback.
  - `lib/layer-playhead-resolve.js` — 193 — resolve live media position on a channel/layer for SEEK on look take (Companion variables, INFO, OSC).
  - `lib/scene-state-timers.js` — 153 — project-level named countdown instances reusable across looks (WO-208).
  - `lib/scene-state-timer-ops.js` — 54 — timer wrapper methods (mixin).
  - `lib/screen-timer-create.js` — 39 — shared "new timer" create/assign flow, `POST /api/timers/assign`.

- What the operator can do: read elapsed, total, and remaining time and a progress bar for the top PGM layer (`playback-timer.js:331-436`); create and assign a per-screen countdown timer (`screen-timer-create.js:35`); see playback label and idle label (`playback-timer.js:291-318`).

- Rendering tech: DOM text and a `div` progress bar (`playback-timer.js:37-46`, inline styles, `transition: width .08s linear`). A rAF tick loop (`playback-timer-format.js:126-133`). No canvas.

- Interaction: none (display-only). Timer creation is a modal or button in D (`scene-list-column-timers.js`).

- Server contract (HTTP):
  - `POST /api/timers/assign` — `lib/screen-timer-create.js:35`.
  - `GET /api/timers/list` — used by D (`scene-list-column-timers.js:58`).
  - `playback` state is read from `stateStore` (`getState` → `channelMap`, `playbackChannels`, `playback.matrix`; `playback-timer.js:383`, `:416-419`).

- Server contract (WS / OSC):
  - OSC via `oscClient`: `oscClient.onLayerState(channel, layer, ingest)` (`playback-timer.js:73`), `oscClient.onAfterIngest(refresh)` (`:74`, `:460`). The OSC client is out of scope; it carries Caspar `file/time`, `file/frame`, `file/fps`.
  - `timeline.tick` / `timeline.playback` are applied to stateStore in `lib/app-ws-handlers.js:189-190` (not consumed by O directly).

- Client state: `oscClient`, `getState` closure, module-level `rafId`, `_timers` cache in `scene-state-timers.js`; no localStorage.

- Browser-only APIs: `performance.now` (`playback-timer-format.js:126`, `lib/playback-timing-clock.js`), `requestAnimationFrame` (`playback-timer-format.js:127`, `:133`), `Date.now` (`playback-clock.js`, `scene-state-timers.js`), `document.createElement` and `style` injection (`playback-timer-format.js:` `ensureStyle`).

- Port-risk notes:
  - Portable: `playback-clock.js` (pure math), `playback-timing-clock.js` (extrapolation and the "prefer advancing file/frame when file/time is wrong" rule, header `:1-4`), `layer-playhead-resolve.js` (priority order of sources, header `:1-3`), `formatHmsf` / `formatMmSs`.
  - Tricky: the frame-vs-time precedence and the traffic-light tier rule (colors in `playback-timer-format.js`).
  - DOM-entangled: `paintPlaybackDisplay`, the timer cards.

---

## Area totals

- Files in scope: **144 JS** (74 components, 70 lib) + **20 CSS** = **164 files**.
- LOC:
  - components: **16401** (74 files)
  - lib: **10850** (70 files)
  - JS total: **27251**
  - CSS (selected 20 files): **4772**
  - Grand total: **32023**

- CSS files used (LOC):
  - `client/styles/02a-workspace-tabs-scenes-preview-host.css` — 190
  - `client/styles/02b-preview-panel-output-compose.css` — 301
  - `client/styles/02c2-multiview-sidebar.css` — 15
  - `client/styles/02c3-sources-sidebar.css` — 495
  - `client/styles/03b-ingest-drag-upload-progress.css` — 175
  - `client/styles/03c-sources-items-effects.css` — 395
  - `client/styles/04-media-lists-sources-tree.css` — 285
  - `client/styles/05c-multiview-editor.css` — 131
  - `client/styles/06a1-scenes-deck-toolbar.css` — 172
  - `client/styles/06a2-scenes-deck-cards.css` — 349
  - `client/styles/06a3-scenes-deck-multi.css` — 233
  - `client/styles/06b-scenes-edit-transitions-layerstrip.css` — 259
  - `client/styles/06c-inspector-effects-pip.css` — 150
  - `client/styles/06c2-inspector-layer-style-presets.css` — 130
  - `client/styles/06c3-inspector-lt-roster.css` — 300
  - `client/styles/07a-scenes-compose-canvas.css` — 454
  - `client/styles/07b-audio-mixer-modal-shell.css` — 357
  - `client/styles/07b3-audio-mixer-modal-shell-controls.css` — 162
  - `client/styles/10-operator-gui-mode.css` — 27
  - `client/styles/10b-operator-compose-tiles.css` — 192
  - Not included (shared or out of scope): `01a1-base-theme-tokens.css` (72, theme tokens, global), `01a2-header-bar.css` (492), `01b-layout-panels-workspace.css` (253), `08c-modals-misc.css`, `08a-modals-logs.css`, `05b-timeline-editor.css`, `05d`/`05e` inspector, `09*` device view, `07b1/07b2/07c*` audio mixer view, `map-explorer.css`, `previs-*.css`, `cg-studio.css`, `companion-button-picker.css`.

- Per sub-feature totals (JS files / LOC):
  - A operator-GUI mode and hole reporting: 5 / 1008
  - B PRV/PGM preview and compose sources: 17 / 3101
  - C operator compose tiles: 5 / 1377
  - D scenes deck: 11 / 1543
  - E scenes editor shell and take: 9 / 1838
  - F look compose frame: 7 / 2020
  - G PRV push pipeline: 13 / 2104
  - H scene/look state: 10 / 1822
  - I transitions: 2 / 113
  - J global border, PIP, effects: 9 / 2233
  - K sources panel: 16 / 2683
  - L live inputs and audio: 16 / 3227
  - M multiview editor: 8 / 1659
  - N mapping and defaults: 8 / 1217
  - O playback timers: 8 / 1306

- Top 5 most complex files (by LOC plus branching/handler count, from reading):
  1. `lib/operator-gui-mode-report.js` (445) — merged-surface state machine, throttle with withdrawal deferral, three suppression latches, dedupe, WS/heartbeat recovery. The timing rules are subtle and load-bearing.
  2. `components/operator-compose-tiles-tile-controller.js` (465) — tile DOM, pointer drag/resize, body vs hole vs chrome rects, live crops, seeding from server vs local layout, rect reporting.
  3. `components/scenes-compose-handlers.js` (471) — pointer move, edge resize and crop math (fraction of aspect box), snapping; dead rotate/scale code still present.
  4. `components/preview-canvas-panel.js` (457) — layout solver for the PRV/PGM pair (three-panel absolute layout and flex weights), DPR backing stores, rect reporting, mode switching (JPEG / WebRTC / tiles).
  5. `lib/scenes-preview-push-scene.js` (488) with `components/scenes-editor-support.js` (383): the AMCP batch builder for the PRV bus and the take fan-out with takeGroup batching (both large, stateful, and close to the server contract).

  Honorable mention: `components/multiview-editor.js` (478) for pointer, drag, keyboard and apply interplay.

- All distinct API endpoints used (HTTP, from client calls in scope):

  GET
  1. `/api/audio/devices` (`?refresh=1` variant also)
  2. `/api/audio/live-inputs`
  3. `/api/device-view` (also `?_ts=`)
  4. `/api/system/v4l2-devices` (`?refresh=1`)
  5. `/api/ndi/list`
  6. `/api/operator-gui/layout`
  7. `/api/gui-stream/status`
  8. `/api/compose-preview/:ch.:ext`
  9. `/api/compose-preview/:ch/companion.jpg`
  10. `/api/compose-preview/:ch/meta`
  11. `/api/media`
  12. (`/api/media` GET is entry 11; ingest reuses it)
  13. `/api/state`
  14. `/api/templates`
  15. `/api/shaders`
  16. `/api/local-media/:id/file`
  17. `/api/ingest/download-status`
  18. `/api/usb/drives`
  19. `/api/timers/list`
  20. `/api/scene/live`
  21. `/api/system/operator-helper-window`
  22. `/api/system/operator-helper-taskbar`
  23. `/api/system/apps`
  24. `/api/thumbnail/:fileId` (`?hq=1&w=&t=`) and `/api/thumbnail/live/:ch` (via `lib/thumbnail-url.js`)

  POST
  25. `/api/audio/live-inputs/config`
  26. `/api/audio/live-inputs/apply`
  27. `/api/audio/inputs/start`
  28. `/api/device-view` (addExtraLiveSource, removeExtraLiveSource, updateConnector, deviceGraph, removeMappingNode)
  29. `/api/v4l2-inputs/apply`
  30. `/api/raw`
  31. `/api/host-live/operator-fullscreen`
  32. `/api/amcp/batch`
  33. `/api/multiview/apply`
  34. `/api/multiview`
  35. `/api/pgm/capture`
  36. `/api/amcp/print`
  37. `/api/operator-gui/layout`
  38. `/api/scene/audio-only/stop`
  39. `/api/ftb`
  40. `/api/thumbnail/live/capture`
  41. `/api/thumbnail/live/upload` (`?channel=`, multipart)
  42. `/api/ingest/upload` (multipart)
  43. `/api/ingest/download`
  44. `/api/media/refresh`
  45. `/api/media/mkdir`
  46. `/api/media/delete`
  47. `/api/timelines/:id/sendto`
  48. `/api/timelines/:id/seek`
  49. `/api/timelines/:id/play`
  50. `/api/timelines/:id/pause`
  51. `/api/timelines/:id/stop`
  52. `/api/scene/take`
  53. `/api/scene/live/preview`
  54. `/api/scene/live/preview/clear`
  55. `/api/scene/border-lines`
  56. `/api/scene/border-preset-crossfade`
  57. `/api/preview/mixer-nudge`
  58. `/api/mixer/effect`
  59. `/api/timers/assign`
  60. `/api/settings` (body fragments only in scope; POST made by callers)

  PUT
  61. `/api/timelines/:id`

  DELETE
  62. `/api/operator-gui/layout`

  Count: 61 distinct method+path entries (`/api/device-view`, `/api/media`, and `/api/operator-gui/layout` are listed once per method; `/api/settings` is listed but is body-only in scope). The server route for `/api/operator-gui/layout` is `src/api/router.js:258-259`; `/api/gui-stream/status` is `src/api/router.js:106`.

  Note: the list above is what the grep of in-scope files found. Helper-composed URLs (for example `getApiBase()` plus path, `postFormDataWithProgress`, `deps.post` in `lib/live-input-start.js`) were read at their call sites where present. Anything called through an injected `deps` object was traced only as far as the call site.

- All distinct WS message types used (received from the server, as read by in-scope code; `file:line` is the dispatch point):
  1. `connect` — `lib/operator-gui-mode-report.js:416` (client event, re-report trigger)
  2. `change` — dispatched in `lib/app-ws-handlers.js:138`; relevant paths consumed by this area:
     - `operatorGuiRectsWanted` — `lib/operator-gui-mode-report.js:417-418`
     - `scene.live` (with `seq`) — `lib/app-ws-handlers.js:142-158`
     - `scene.deck` — `lib/app-ws-handlers.js:159-165`
     - `scene.globalBorders` — `lib/app-ws-handlers.js:166-168`
     - `channelMap` — `lib/app-ws-handlers.js:169-180`
     - `caspar.connection` / `caspar.*` / `configComparison` — `lib/app-ws-handlers.js:180-186` (status refresh)
     - `sourceLabels` — referenced in `components/operator-compose-tiles.js:343`
  3. `operatorGuiLayout` — `lib/app-ws-handlers.js:197` → `lib/operator-gui-mode.js:98-107`
  4. `compose.preview` — `lib/app-ws-handlers.js:194` → `components/preview-canvas-compose-snapshot.js:212`
  5. `streaming_channel` — `lib/app-ws-handlers.js:192` (ingested; consumer outside scope)
  6. `usb:attached` — `components/sources-panel-ingest-ui.js:153`
  7. `usb:detached` — `components/sources-panel-ingest-ui.js:154`
  8. `media:hap-encode` — `components/sources-panel-hap-encode.js:65`
  9. `global_border_sync` — `lib/app-ws-handlers.js:211` (ingest of Art-Net border data; feeds `lib/global-border-artnet-ws.js`)
  10. `timeline.tick`, `timeline.playback` — `lib/app-ws-handlers.js:189-190` (stateStore; not read directly in scope)
  11. `disconnect`, `error` — `lib/app-ws-handlers.js:296`, `:300` (connection lifecycle; not read directly in scope)

  Also read in scope but not WS: OSC `file/time`, `file/frame`, `file/fps` via `oscClient.onLayerState` and `onAfterIngest` (`components/playback-timer.js:73-74`, `:460`). The gui stream frames arrive through `lib/gui-stream-client.js` (out of scope; its transport was not inspected in this pass).

---

## Notes and limitations of this inventory

- Read-only; nothing under `/Users/marcin/highascg` was modified; no git commands run.
- External modules named but not inventoried (out of prefix scope): `lib/api-client.js`, `lib/app-ws-handlers.js`, `lib/gui-stream-client.js`, `lib/webrtc-client.js`, `lib/element-position-watch.js`, `lib/settings-state.js`, `components/header-bar-operator-helper.js`, `components/timeline-editor.js`, `components/inspector-media-file.js`.
- Items marked "from grep" were confirmed by a grep count but their exact lines were not individually read.
- Dead code noted: `scenes-compose-handlers.js` `startRotate` / `startScale` (`:246`, `:285`) are returned from the factory (`:470`) but not wired (`:242` comment).
- Comment anomaly noted: `lib/operator-gui-mode-report.js:156-164` JSDoc is orphaned (see A).
