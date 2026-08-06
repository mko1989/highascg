# WO-255 — Operator GUI v2: shaped Caspar video overlay above fullscreen Firefox (CEF route retired)

**Status:** IMPLEMENTED (all T-tasks done; the operator GUI has been the daily driver since — owner acceptance A255.1 on `work/checklist06.08.26_close_all_wos.md`)
**Priority:** HIGH (owner architecture decision 2026-07-16: "shaper and firefox")
**Owner check:** A255.1

## Decision + PoC
CEF-in-Caspar for the GUI is retired (shared-process starvation, synthetic-input fragility — see INCIDENT-2026-07-16). New architecture, PoC-proven on this box (SHAPE extension present; shaped override-redirect window with EMPTY input region created/destroyed cleanly on the operator monitor — scratchpad shape-poc.py):

- **Firefox-ESR** (installed; Gecko, not Chromium) runs fullscreen+opaque on the operator monitor loading the web UI in operator mode. 100% native input. No compositor anywhere.
- The **operator_gui Caspar channel keeps its route layers** (existing orchestration + WO-254 aspect-fit) and its **screen consumer window sits ABOVE Firefox** (`always-on-top`), shaped via X SHAPE so ONLY the preview rects are visible, with an **empty input shape** → all clicks pass through to the GUI, even over video.
- A small **python-xlib shape helper** (python-xlib verified installed) applies/reapplies the shapes; the same rect reports that drive `MIXER FILL` drive the shapes.
- The owner's surface list for video blending: **looks editor (compose preview), timeline preview, multiview layout editor**.
- The operator_gui destination remains the config home: monitor picker (exists) + **"Launch / Bring to front"** button in the inspector.

## Pre-existing uncommitted work you MUST reconcile first
The killed WO-254 agent left uncommitted edits in `src/system/operator-gui-channel.js` (aspect-fit: `fitAspectRectPx`, `computeAspectFitCellRect`, `resolveCellSourceDims`, `resolveOperatorGuiChannelDims` — KEEP, still exactly right for fitting video in rects), `client/app.js`, `client/lib/cef-operator-mode.js` (partial re-report work — review; keep what fits, finish or drop cleanly), possibly `tools/smoke/smoke-wo243-operator-gui.test.js`. `git diff` them before anything. config/*.json and docs/wiki-site changes are NOT yours — never stage them.

## Tasks

**T255.1 — shape overlay helper + server manager**
- `tools/runtime/operator-shape-overlay.py` (python-xlib, mirror tools/runtime/confine-pointer-barriers.py's conventions): long-running; reads JSON lines on stdin: `{ "monitor": {x,y,w,h}, "rects": [[x,y,w,h],...] }` (rects in MONITOR-relative pixels). Finds the Caspar screen consumer window for the operator monitor — match strategy: enumerate top-level windows, pick the one whose geometry equals the monitor rect and whose WM_CLASS/name matches casparcg (verify what class/title the screen consumer actually sets: `xprop -display :0` on the live consumer window OR read the caspar source screen consumer window title — document what you matched on). Applies: bounding shape = the rects (window-relative), input shape = EMPTY, restack Above. Re-applies on stdin updates AND polls every 2s for a new window id (Caspar restart). Empty rects list → hide entirely (bounding shape empty). Clean exit on stdin EOF.
- `src/system/operator-shape-overlay.js`: spawn/respawn with `displaySessionEnv()` (mirror cef-interactive-bridge-lifecycle.js's spawn/stderr-log/exit-log pattern), `updateShapeRects(monitorRect, rectsPx)`, stop on shutdown (hook src/bootstrap/shutdown.js like the bridge does). Fed from `applyOperatorGuiLayout` (same cells: convert viewport fractions → monitor pixels using the GUI channel dims — note the channel raster and monitor rect may differ in size; map via monitor rect). Monitor rect: `resolveLayoutRectForOperatorPort` for the destination's resolved port (see config-generator-operator-gui.js for the resolution chain incl. the gpu-map fallback).

**T255.2 — operator_gui destination rework (server)**
- REMOVE the CEF layer: in operator-gui-channel.js delete the `PLAY [HTML]` + CEF_LAYER logic and `ensureOperatorGuiFocus` (auto-arm); `ensureOperatorGuiCefLayer` becomes `ensureOperatorGuiChannel` (kept: re-apply route layers need nothing at boot — but DO re-feed the shape helper + broadcast the rects-wanted nudge on Caspar reconnect). In `src/api/routes-cef-arm-input.js` remove the operator-gui release-fallback (restore plain clear) but KEEP the `syncCefInteractiveBridge` self-heal in the ARM path (mario still needs it). Remove the 'operator_gui' interactive zone from cef-interactive-bridge-zones.js. Grep for `ensureOperatorGuiFocus` consumers (smoke asserts them — update the smoke).
- Generator (`src/config/config-generator-operator-gui.js`): `<always-on-top>true</always-on-top>` for the operator_gui screen consumer (currently false) — the video window must stack above Firefox.
- Firefox launcher: `src/system/operator-gui-launcher.js` — `launchOperatorGuiBrowser(ctx)`: spawn `firefox-esr --kiosk --new-instance --profile <REPO_ROOT>/.operator-firefox-profile <guiUrl>` with `displaySessionEnv()`; after spawn use xdotool (`search --sync --onlyvisible --class firefox`, then `windowmove`/`windowsize` to the monitor rect — kiosk fullscreens on whichever monitor the window lands on; verify and document the actual reliable sequence, xdotool is installed). `raiseOperatorGuiBrowser()`: xdotool windowactivate. Track the child pid; relaunch replaces. Routes `POST /api/operator-gui/launch` and `POST /api/operator-gui/raise` — REGISTER in src/api/router.js (grep-assert in smoke).
- Inspector (client/components/device-view-destinations-inspector-operator-gui-fields.js): add a "Launch / Bring to front" button → POST launch (or raise when already running — server returns which it did; show result as a small status line). Default guiUrl becomes `http://127.0.0.1:4200/?operatorGui=1`.

**T255.3 — client operator mode v2**
- Rename `client/lib/cef-operator-mode.js` → `client/lib/operator-gui-mode.js`; mode active on `?operatorGui` OR legacy `?cefOperator`. Update importers (app.js, scenes-editor.js, preview-canvas-panel.js).
- Rect reporting from THREE surfaces, each tagged `{ surface: 'compose'|'timeline'|'mvedit', id, role?, mainIndex?, rect }`:
  1. compose preview / looks editor — exists (preview-canvas-panel onComposeCellRects); keep.
  2. timeline preview — find the timeline editor's preview canvas (client/components/timeline-editor-preview.js / timeline-compose-preview.js) and report its cell rect(s) the same way.
  3. multiview layout editor — the MV editor dock preview (client/components/multiview-editor.js); report its preview area rect. For v1 the mv-edit surface may map to route://<multiview channel> — resolveCellSourceChannel needs a 'multiview' role addition server-side (route the MV channel into the rect).
  Only VISIBLE surfaces report; a surface hiding withdraws its rects (report the merged remaining set). The server layout endpoint accepts the extended cell shape (role 'multiview' + surface passthrough — keep the endpoint dumb, client sends the merged active set).
- **Interaction suppression** (critical UX): while a modal/dropdown/context-menu is open, or during pointer-drag interactions on a preview surface (layer dragging in the looks editor), SUPPRESS all rects (POST empty set / withdraw) and restore afterward — the video overlay would otherwise hide popups and drag chrome (video stacks ABOVE the GUI). Debounced restore (~300ms after interaction ends).
- Remove the WO-243 transparent-holes CSS (`client/styles/10-cef-operator-mode.css`): replace with a plain dark backing (`#0a0a0a`) on reported cells in operator mode (avoids white flashes while shapes lag rect changes by a frame). Canvas draw-skip in operator mode stays (video covers the cells).

**T255.4 — smokes** (extend smoke-wo243-operator-gui.test.js; rename-tolerant)
- Aspect-fit unit tests (finish WO-254's if incomplete).
- Router registration greps for launch/raise; shape manager fed from applyOperatorGuiLayout (grep-level); generator emits always-on-top true; mode module accepts both query params; arm-input route no longer references ensureOperatorGuiFocus; zones list has no operator_gui.
- Shape helper: pure-python syntax check via `python3 -m py_compile`.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, do NOT launch firefox or the shape helper against the live display (PoC already proven; A255.1 is the owner's live test), no npm, no vite build (orchestrator runs it), curated gate ONLY. node --check + repo eslint --quiet; exact gate counts; <500 lines/file; honest checkboxes. NEVER stage config/*.json or docs/wiki-site.

- [x] T255.0 reconcile uncommitted WO-254 partials (report what you kept/dropped)
- [x] T255.1 shape helper + server manager
- [x] T255.2 CEF retirement + always-on-top + launcher + inspector button (+ routes REGISTERED)
- [x] T255.3 mode v2: three surfaces, interaction suppression, dark backing
- [x] T255.4 smokes in gate
- [ ] A255.1 (owner) apply config → caspar restart → Launch button → GUI on operator monitor, video in compose/timeline/mv-edit rects, clicks land everywhere, popups suppress video, drag suppresses video
