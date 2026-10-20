**Status: IN PROGRESS (2026-10-20) — N7 (Previs: no 2D, no camera spin), N3 (timer icon), N4 (look-card ▶ / cog), N5 (editor alone at the bottom), N2 (look editor px + aspect lock), N6 (Live Standard ↔ 3D switch) DONE, box-verified. Next: N1 preview destination chrome + tile move/resize. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Related: [WO-600](./600_WO_godot_port_live_core.md) (live core: items B/C compose tiles), [WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md) (2D mode — partly reversed here), [WO-607](./607_WO_godot_previs_native_3d.md).**

# WO-621 — Godot client: owner notes 20.10 (`next.md`) — Live preview chrome, look editor, look cards, Previs

Owner notes added to `next.md` (20.10), quoted per item:

| # | Note | Area |
|---|------|------|
| N1 | "the live tab's preview lacks the destination's borders and labels. there is no way to resize and position the windows there." | Live tab top (operator channel) — WO-600 B/C |
| N2 | "in the looks editor there is no aspect lock, and the values for the position and size are 0-1 instead of actual pixel values, that were calculated in the webui." | `look_editor.gd` |
| N3 | "there is a missing icon for the timer button." | `deck_view.gd` |
| N4 | "there should be a cog icon that opens look's editor for that look, and a play button that takes that look to the screen on each looks' card." | `deck_view.gd` / `look_thumb.gd` |
| N5 | "when look's editor is open it should be the only thing in the bottom." | `live_tab.gd` |
| N6 | "in the live tab there should be a switch from the standard to 3d." | Live tab top (web: `previs-pgm-3d.js` + toolbar) |
| N7 | "in the previs i dont need 2d, that was a misunderstanding from the above. also in 3d the camera is always spinning. delete that." | `previs_tab.gd`, `previs_stage.gd` |

## N7 — Previs: drop 2D, stop the idle spin (DONE)

### Investigation
- WO-617 added the "2D front" (default) / "2D plan" views (`stage_2d_view.gd`, 273 lines) and a "Live pictures"
  checkbox, from the 17.10 note "a simple 2d option for preserving resources". The owner now says that note meant
  the Live tab switch (N6), not a Previs mode. The resource half of WO-617 does not depend on the 2D view: the
  surface refcount, and the 3D SubViewport rendering only while shown (`UPDATE_DISABLED` when hidden).
- The spin was `previs_stage.gd` `_process`: after 4 s without mouse input it added `delta * 0.1` to the orbit yaw
  every frame (the WO-607 M0 demo idle orbit).

### What was done
- `previs_tab.gd`: `MODES` is `["3d", "camera"]` and the default is 3D. The toolbar buttons are 3D / Camera /
  Tracking cameras / Fit. The 2D view, its signal wiring, the "Live pictures" checkbox and its `ui.cfg` key are
  removed. A remembered `front` / `plan` pick falls back to 3D. The arrow keys nudge X/Z only (front's X/height
  case is gone).
- `stage_2d_view.gd` is deleted. `stage_panel.gd` drops the 2D-only `move_object()` and `turn(…, absolute)`.
  Comments are updated in `stage_panel.gd` and `stage_objects.gd`. `footprint` / `front_rect` stay; the stage
  panel uses them for placement.
- `previs_stage.gd`: the idle orbit (`_process`, `_idle`) is removed. The camera moves only on drag, wheel, presets
  or Fit.

### What was VERIFIED
- Suite 13012 / 13012 passing, `--check` boots clean. No test referenced the 2D view.
- Box: Previs showed the toolbar 3D · Camera · Tracking cameras · Fit, and Camera mode still worked. In 3D, two
  captures 6 s apart (mouse parked outside the view) had 0 changed pixels over the 870×900 view. The owner's
  remembered Camera mode was restored afterwards.

## N3 / N4 / N5 — timer icon, look-card ▶ and cog, editor alone at the bottom (DONE)

### Investigation
- N3: the deck column's timer button was `text = "⏱"` (`deck_view.gd:87`). U+23F1 is not in Rewir, and the box has
  no fallback font for it: `fc-list ':charset=23f1'` is empty, as is U+23F8 ⏸. The other glyphs in use (▶ ✕ ⟲ ❚)
  fall back to DejaVu and render. ⏸ also appears in the screen-timer transport (`screen_timer_panel.gd:120`) and the
  countdown section (`countdown_section.gd:146`), which were blank the same way. The web uses inline SVG for exactly
  this reason (`client/components/ui-icons.js`, comment: "The box has no emoji/symbol font").
- N4: the web card footer (`client/components/scene-list-column.js:292-330`) is ▶ take (`Take live`), CUT and ⚙
  edit. The Godot card had none of these. Taking needed a double-click, and editing needed right-click → "Edit
  look…".
- N5: `live_tab.gd` put the editor in an HSplit beside the deck, under the action line and the transition toolbar.

### What was done
- New `app/ui_icons.gd` (`texture(name, px)`, `button(name, tip, px)`) rasterises `assets/ui/icons/*.svg` at
  runtime, cached, with no import step, like `assets/devices/`. timer / play / pause / reset are the web's
  `ui-icons.js` paths; cog is a generated 8-tooth gear. There is a README alongside.
- `deck_view.gd`: the timer button is the timer icon. Each card's meta line now shares a footer row with ▶ ("Take
  live — this look to the screen (PGM)" → `request_take(id, main, "program")`, the same server take as a
  double-click) and a cog ("Edit look" → `edit_requested`). CUT is left out: the owner asked for ▶ and cog only.
- `screen_timer_panel.gd`: Start / Pause / Reset are icon buttons with tooltips. `countdown_section.gd`: icon +
  "Start" / "Pause" / "Reset". The `app/main.gd` dev probe matches the new texts.
- `live_tab.gd`: while the editor is visible, the action line, the transition toolbar and the deck are hidden, and
  the editor fills the width. Close brings them back.

### What was VERIFIED
- Suite 13012 / 13012 passing, `--check` boots clean.
- Box (Live tab, config md5 unchanged):
  - the timer icon is visible in the column header and opens "Timers — Main LED (DP-7)" in the Inspector;
  - every card shows ▶ and the cog;
  - the cog on "Background" opened "Edit look: Background" as the only thing under the preview; Close brought
    the deck back;
  - ▶ on "Opening" (already on PGM, so nothing changed on air) → `take-look program look-1 → 200`, status
    "TAKE ok".
- Not exercised on the box: the screen-timer / countdown transport icons. No timer exists, and adding one writes
  the project. They use the same `Icons.button` as the deck.


## N2 — look editor: pixel position / size + aspect lock (DONE)

### Investigation
- `look_editor.gd` edited `layer.fill.{x,y,scaleX,scaleY}` directly in a 0–1 grid. It had no aspect lock setting, and its
  frame edge-drags always locked the ratio unless Shift was held.
- The web Inspector (`client/components/inspector-fill.js:95` `appendSceneLayerFillGroup`, with
  `inspector-scene-layer.js:136-170` `patchFillPx`) shows the layer's VISIBLE rect in canvas px. The visible rect
  is the fill rect minus the crop effect (`client/lib/layer-crop.js:163` `visibleRectForLayer`). It is shown as
  centre offsets when `editorDefaults.coordinateOrigin == "center"` (`client/lib/coordinate-origin.js:27`).
  - An edit maps back through `applyFillPxPatch` (`coordinate-origin.js:62`) and `layerRectFromVisibleRect`
    (`layer-crop.js:145`).
  - `aspectLocked` (default on, `!== false`) makes W↔H follow a ratio. The ratio is the content's media ratio if
    known; otherwise it is the ratio at the first edit, kept for 500 ms (`inspector-scene-layer.js:147-162`);
    otherwise it is the visible rect's ratio.
  - The align buttons use `alignFillForCrop` (`layer-crop.js:186`).

### What was done
- New `features/live/layer_rect_math.gd` ports that maths: fill↔px, visible rect ↔ layer rect with crop, the
  display/centre transform, the lock ratio, `patch_fill`, and `align_fill`. It reuses `compose_math.gd`
  (crop normalisation) and `px_rect_math.gd`.
- New `features/live/layer_geometry_section.gd` contains:
  - the "Position / size (canvas px)" title and the centre-origin subtitle;
  - the align row;
  - X / Y / Width / Height SpinBoxes (step 1, w/h ≥ 1);
  - an "Aspect lock" CheckBox that writes `aspectLocked`.
  It emits `{fill}` patches.
- `look_editor.gd`: the 0–1 grid is replaced by that section plus Opacity. The frame's edge-resize lock now follows
  the layer's `aspectLocked` (Shift still frees it, as on the web); before, every edge-drag locked unless Shift was held.
- `layer_inspector.gd`: exposes `content_known` (the server layer-fit's `contentResolution`) as the lock's ratio.
- Golden test `tests/test_live_layer_rect.gd` + `tests/golden/live_layer_rect.json`: 28 layers (crop / no crop,
  centre / corner origin, locked / unlocked, known / unknown content) × 784 patches. They come from the real web
  modules run under Node (generator `lrect_gen.mjs`, scratchpad), compared to 1e-9 relative. As a mutation check,
  swapping the crop sides made 112 cases fail.

### What was VERIFIED
- Suite 14804 / 14804 passing, `--check` boots clean, 0 files over 500 lines.
- Box (Live tab → cog on "Background" → layer selected; config md5 unchanged):
  - the Inspector shows "Position / size (canvas px)": X 483, Y 422, Width 1386, Height 485, plus the align row;
  - "Aspect lock" is ticked by default;
  - Width 1000 → Height 350 (485 × 1000 / 1386);
  - Width 1386 → back to 485, so the test edit is reverted.
- Owner QA: the align buttons and centre-origin mode on the box (both covered by the golden test only), and frame
  drags with the lock on.

## N6 — Live tab: Standard ↔ 3D switch (DONE)

### Investigation
- The web puts a 2D/3D toggle on the PGM compose cell (`client/components/previs-pgm-3d.js:120-130`). 3D replaces
  the flat PGM video with the Three.js stage with PGM mapped onto its screens, and `onExpand(true)` grows the cell.
  Its toolbar (`previs-pgm-3d-toolbar.js`) is GLB model load / clear / saved models. In Godot those already live in
  the Previs tab.
- In Godot the Live tab's preview is a single TextureRect on the operator surface (`live_tab.gd`). The Previs stage
  (`previs_stage.gd` + `stage_builder.gd`, objects in `project.previs.stage.objects`) can run in any SubViewport.
  The builder holds each object's source surface (WO-617 refcount), so a second instance costs nothing while hidden.
- Found while verifying: this project's only object, "Main LED (DP-7)" on `pgm1`, has `rotation [0,180,0]`, so its
  picture faces −Z. The stage camera's default (and Fit) looks from +Z, so both the Previs 3D view and the new Live
  view first showed the wall's dark cabinet back. The probe confirmed the source was fine: `pgm1` held, 50 frames/s
  arriving, texture 1920×1080, `has_video` true. Orbiting 180° showed the live PGM picture on the wall.

### What was done
- New `features/live/live_stage_3d.gd` is the read-only stage view: its own world, objects reloaded on
  `Store.project_changed` (only when the list changed), and orbit / wheel zoom through
  `PrevisStage.handle_input`. It renders and holds surfaces only while shown. Fit frames the stage from the side
  its pictures face: the sum of the visible objects' facing directions (+Z at rotation 0), with the Previs default's
  0.35 rad offset. It fits once when the objects first arrive.
- `previs_stage.gd`: `frame_box(box, yaw := NAN)` takes an optional yaw; existing callers are unchanged.
- `live_tab.gd`: a Standard / 3D switch (+ Fit in 3D) is overlaid at the preview's top-left.
  - 3D hides the operator picture and releases its surface hold; Standard brings it back.
  - The choice is remembered in `user://ui.cfg [live] view`; `--live-view=3d` is the dev override.
  - "NO SIGNAL" shows only in Standard.
- Not ported: the web's GLB model toolbar on the PGM cell (the Previs tab owns models). Stage editing stays in Previs.

### What was VERIFIED
- Suite 14804 / 14804 passing, `--check` boots clean, 0 files over 500 lines.
- Box (config md5 unchanged):
  - Live shows Standard · 3D at the preview's top-left.
  - 3D → the stage view and journal `ADD 1-741 SHM NAME pgm1`. A drag orbits.
  - After a relaunch with 3D remembered, the view opens facing the wall with the live PGM look ("Opening",
    red) on it.
  - Standard → the operator picture is back and journal `REMOVE 1-741 (pgm1: no leases)` 1 s later.
  - Left on Standard.
- Owner QA: whether the Previs tab's own Fit / default camera should also face the pictures. It still looks from
  +Z and shows this project's wall from behind; that was left unchanged.
