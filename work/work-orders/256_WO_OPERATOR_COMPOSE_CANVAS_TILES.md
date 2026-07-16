# WO-256 — Operator GUI: compose preview becomes a free-tile canvas (multiviewer-style windows)

**Status:** OPEN
**Priority:** HIGH (owner feature, follows the WO-255 pivot)
**Owner check:** A256.1

## Owner intent (verbatim)
"due to change in the nature of the ui on operator gui. i want to change how the compose preview is used. i want the compose preview full window to be a canvas for windows like on the mulviviewer that can be sized and positioned freely. they should have the same border label and single layer progress bar (highest with running timer). default positioning of the windows should be similar to current."

## Design
Operator-GUI mode ONLY (?operatorGui / legacy ?cefOperator — `isOperatorGuiModeActive()`); the normal browser compose preview is untouched. In operator mode the compose preview panel body becomes a full-area **tile canvas**:

- One tile per compose cell (same set as today's cells: PRV/PGM per screen — reuse `getComposeCellDefs` so screen count/roles stay in sync).
- Each tile = **header strip** (label — same source as the MV: `screenLabel()` + role, e.g. "PRV 1 / Dioda"), **body** (the video rect — this exact rect is what gets reported to `/api/operator-gui/layout`, NOT the whole tile), **footer strip** (single-layer progress bar: highest running layer, reusing the bank-aware `pickTopLayerStateForPlayback` from client/components/playback-timer.js — WO-250 — fed by the shared OscClient; bar style mirrors the MV templates' bar).
- Chrome (border/label/bar) is DOM — it must NEVER overlap the reported body rect (video stacks ABOVE the GUI; anything under it is invisible). Tile border sits outside the body rect.
- **Free move/resize**: drag on the header moves; a corner handle resizes (min size ~160x90 + chrome). Reuse interaction patterns from the multiview editor (client/components/multiview-editor.js has drag/resize precedent). While dragging/resizing, the existing suppression (operator-gui-interaction-suppress.js) hides the video — the tile outline gives feedback; on release the new rect reports and video returns. Verify the suppressor actually catches these drags (its pointer detector is scoped to preview-surface selectors — add the tile canvas selector if needed).
- **Persistence**: tile layout saved per screen-count key in localStorage (follow the preview panel's existing `storageKeyPrefix` conventions in preview-canvas-panel.js). A "Reset layout" button restores defaults.
- **Default layout** mirrors today's arrangement: per screen, PRV|PGM side-by-side rows filling the canvas (same proportions as the current compose pair split).
- Snap: light 8px grid snap on move/resize (cheap, keeps rects tidy for the shape overlay).

## Anchors
- Mode + reporting: client/lib/operator-gui-mode.js (`initOperatorGuiRectReporting`, `cellRectsToLayoutCells` — extend so tiles feed the same merged-report path with surface 'compose').
- Current compose panel: client/components/preview-canvas-panel.js (cell defs at ~:67, options at :14 — in operator mode the panel should mount the tile canvas INSTEAD of the canvas-pair; keep one code path switch, don't fork the file; if the addition pushes the file over ~500 lines, split the tile canvas into client/components/operator-compose-tiles.js — preferred anyway).
- Labels: client/lib/screen-label.js (WO-222).
- Progress data: OscClient (client/lib/osc-client.js) + pickTopLayerStateForPlayback (playback-timer.js — import, do not copy; export it if not exported).
- MV chrome visuals for parity: template/multiview_overlay.css label-row/progress-bar styles (copy the LOOK, not the files).
- Server: NO changes expected — /api/operator-gui/layout + aspect-fit + shape overlay already consume arbitrary rects. If the tile body rects work end-to-end without server edits, say so explicitly.

## Tasks
- [x] T256.1 `client/components/operator-compose-tiles.js` — tile canvas (tiles, chrome, drag/resize+snap, persistence, reset, default layout)
- [x] T256.2 preview-canvas-panel.js mounts tiles instead of the canvas pair in operator mode (hard-gated; zero change otherwise — smoke asserts the gate)
- [x] T256.3 progress bar + label wiring (bank-aware highest-running-layer, screenLabel)
- [x] T256.4 rect reporting from tile bodies through the existing merged-report path; drag/resize suppression verified/extended
- [x] T256.5 smoke (gate): default-layout math (N screens → expected tile rects), persistence round-trip (storage stub), gate assertion, body-rect-excludes-chrome invariant
- [ ] A256.1 (owner) tiles drag/resize with live video returning on release; labels+bars match MV; defaults look like the old layout — NOT verifiable from this box (no GUI/live Caspar/kiosk here); needs owner sign-off on real hardware.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm, no vite build (orchestrator runs it), curated gate ONLY. node --check + repo eslint --quiet; exact gate counts; <500 lines/file; honest checkboxes. client/lib/operator-gui-mode.js and preview-canvas-panel.js were modified this week — read current state first.
