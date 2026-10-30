# WO-789 — The timeline's preview is the Live preview (2D / 3D)

**Area:** engine
**Status: DONE (27.10 — smokes + offline suite + Godot tests; off-screen renders of the Timeline tab in 2D and 3D and of the Live tab; owner QA = switch tabs in the running client)**

Owner, 27.10 (after WO-788):
> the preview in timeline should be the same as in live with the option to change to 3d etc.

Parents:
- [WO-788](./deprecated/788_WO_timeline_editor_live_monitor.md) (the timeline monitor this replaces);
- [WO-621](./621_WO_godot_owner_notes_live_looks_previs.md) N1 / N6 (compose windows, the 2D / 3D switch);
- [WO-649](./649_WO_live_preview_2d_3d_toggle_mvr_model.md) (MVR + rig in the Live 3D view);
- [WO-658](./658_WO_live_2d_auto_window_layout.md) (Auto);
- [WO-710](./710_WO_tracking_overlay_live_previs.md) (tracking overlay).

## Investigation

- WO-788's monitor (`features/timeline/timeline_monitor.gd`) is one bare TextureRect on a single bus surface:
  `prv<N>` of the Dest screen, or `pgm<N>`. It has none of the Live preview's controls.
- The Live preview is built inline in `features/live/live_tab.gd` (`_ready` lines 42-78, `_view_switch`, `set_view`,
  `_hold_surface`, `_process`; the ui.cfg reads at 152-162). It is:
  - the operator channel surface (`opgui`), placed on `tiles.image_rect()`;
  - `ComposeTiles`, the PGM / PRV windows of every screen, which can be moved, resized and dropped on;
  - `LiveStage3D`, the Previs stage, MVR scene and patched rig in its own SubViewport world;
  - the 2D / 3D toggle, with Fit and Lights in 3D and Times and Auto in 2D;
  - the Auto tracking overlay (WO-710).
- Why a second instance won't do:
  - **Auto would fight.** `compose_tiles.gd` `_retile` (lines 312-326) tiles the operator windows into its own panel
    size and POSTs `/api/operator-gui/layout`. That layout is the one shared server layout, so two instances of
    different heights would keep re-laying the operator channel for each other.
  - **The 3D view would be built twice.** `live_stage_3d.gd` makes the MVR meshes and the GDTF rig on its first show.
    A second instance doubles the meshes, the rig and the beam rendering.
- Tab switches already drive the preview through `visibility_changed`. Only one workspace tab is visible at a time,
  so a single preview can be moved into whichever tab shows it.
- The box's operator layout is in atlas mode (`GET /api/operator-gui/layout` → `atlas.slots` for pgm_1 / prv_1 /
  pgm_2 / prv_2). A re-tile on a tab switch is a layout POST with no per-move AMCP (WO-597 §D).

## What was done

- **New `godot/client/features/live/live_preview.gd`**: the Live preview, moved out of `live_tab.gd` unchanged. It is
  the operator picture, ComposeTiles, LiveStage3D, the 2D / 3D switch with Fit / Lights / Times / Auto, the Auto
  tracking overlay, the wheel pan, and the ui.cfg `[live]` view / lights / times / auto. New in it:
  - `static var current`: the one instance, made by the Live tab.
  - `host(slot)`: reparents the preview into a tab's black panel. A reparent alone doesn't signal visibility, so it
    then re-holds the operator surface, re-runs the 3D view's show / hide and refreshes the windows. The new size fires
    `resized`, so Auto re-tiles for the panel.
  - `set_osc(osc)`: the Times redraw hook that was inline in the Live tab.
- **`features/live/live_tab.gd`** (361 → 203 lines): makes the preview in its top panel and takes it back on
  `visibility_changed` when shown. The deck, editor and toolbar are unchanged.
- **`features/live/live_stage_3d.gd`**: `_apply` renamed `sync_shown`, so the host can call it after a reparent.
- **`features/timeline/timeline_tab.gd`**:
  - The WO-788 monitor is replaced by `preview_slot`, a black PanelContainer in the same split. The tab borrows
    `LivePreview.current` when shown, and once at start for `--tab=2`.
  - The divider is ui.cfg `[timeline] preview_h`, default 480 (about the Live preview's height). At 260 the
    width-filled canvas was cut through the PRV row. Nothing was stored under the old `monitor_h`.
- **Removed (WO-788)**:
  - `timeline_monitor.gd`;
  - `timeline_send_to.gd` `monitor_role` and its test;
  - the `follow` call in `timeline_dest.gd`.

  The operator picture shows every PGM / PRV window, so the Dest screen's PRV is always in it.
- **Why one moved instance over a second one**: see the Investigation. A second copy would build the 3D stage twice
  and its Auto would re-tile the shared server layout against the first.
- **Smokes**:
  - `smoke-wo710-tracking-overlay` repointed: the overlay pins now read `live_preview.gd`, plus a pin that the Live
    tab makes and hosts it. The 500-line list gained `live_preview.gd`.
  - New `smoke-wo789-timeline-live-preview.test.js` (2 tests, registered in `offline-test-files-2.js`):
    - only the Live tab instantiates the preview, and the Timeline tab hosts `LivePreview.current` when shown;
    - all five controls are in the preview, `host` re-syncs the surface and the 3D view, and the monitor file is gone.

## Verified

- **Offline suite:** 3390 pass, 0 fail, 2 skipped. Lint 215 warnings (unchanged). Prettier OK. No file over 500 lines.
  No new unwired exports.
- **Godot:** 21892 passed / 0 failed (−4: `test_monitor_role` removed with its function). `run-client.sh --check`:
  boot OK, no script errors.
- **Off-screen renders against the box's server** (`xvfb-run … --tab=N --live-view=…`):
  - Timeline tab, 2D: the operator canvas with PGM 1 / Dioda, PRV 1, PGM 2 / Proj and PRV 2,
    the Times rows, and the 2D / Times / Auto buttons. Same layout as the Live tab.
  - Timeline tab, 3D: the Previs stage and MVR model with the LED walls live, plus Fit and Lights.
  - Live tab: unchanged (preview, deck, toolbar).
  - These `--tab=2` launches move the preview Live → Timeline at start.
- **Owner QA:**
  - Switch Live ↔ Timeline a few times; the picture and the 2D / 3D choice should follow.
  - With Auto on, the windows re-fit to each tab's panel. That is one layout POST per switch, cheap in atlas mode.
