# WO-960 — Look editor: layers snap to the canvas centre / edges and to other layers, with guide lines

**Area:** godot-client
**Status: DONE (05.11.26 — Godot suite 25992/0, boot check OK, GUI e2e 19 6/6 + 03/17 regression 16/16 in the sandbox, guide line seen in the screenshots; owner QA on the box)**

Owner 05.11: *"in looks editor a guide line should appear and layers should stick when for instance center of the
layer is on center of the screen, or edge, etc."*

Related: [WO-600](./600_WO_godot_port_live_core.md) (F — the Godot look editor and its compose math),
[WO-611](./611_WO_web_client_bugs_found_in_godot_inventory.md) (#4 snap by either edge), [WO-635](./635_WO_look_editor_rotated_layer_chrome.md)
(rotated layer chrome / drag axes), [WO-654](./654_WO_look_editor_scroll_zoom.md) (zoom / pan → `_box()`),
[WO-653](./653_WO_look_editor_box_matches_caspar_fit.md) (boxes = Caspar's fit), [WO-388](./388_WO_CROP_COUNTS_INTO_LAYER_SIZE_FOR_ALIGN.md)
(crop counts into the effective size), [WO-918](./918_WO_gui_project_and_destination_test_sweep.md) (F12 stale editor close).

## 1. Investigation

- **Some snapping already existed, invisibly and edges only.** `godot/client/features/live/look_editor.gd:273` (before
  this WO) moved a layer with `C.move_fill(start, d.x, d.y, _others_fills(_sel), 10.0 / b.size.x, 10.0 / b.size.y)`;
  `compose_math.gd:33-49` `move_fill` snaps the layer's left/right (top/bottom) edge to `[0, 1]` and the other layers'
  edges (`snap_move_axis`, WO-611 #4). No centre on either side: neither the layer's centre nor the canvas centre was
  a target, which is exactly the owner's example. Nothing was drawn, so the operator could not tell a snap from a stop.
- **Resize** (`look_editor.gd:276-282` before) passed `C.snap_value` callables into `C.edge_resize` with
  `_snap_candidates` (`look_editor.gd:324-329`: `[0, 1]` + others' edges), threshold 10 px. It snapped even on a turned
  layer, where the dragged edge is not an axis line (WO-635 rotates resize deltas into the layer's axes).
- **Threshold.** `10.0 / b.size.x` with `b = _box()` (WO-654 `look_editor_view.gd:17-21`: fit × zoom) is already
  10 *screen* px at any zoom — the right model, kept.
- **What the boxes are.** Other layers' snap lines came from `_shown(l)` (WO-653 fit) but ignored crop and rotation, so a
  cropped layer snapped by its invisible uncropped outline.
- **Modifiers in use on the frame:** Shift = aspect unlock while resizing (`look_editor.gd:280`), middle button = pan,
  wheel = zoom (`look_editor_view.gd:43-62`). Ctrl / Alt / Meta were free. Alt-drag is a window-manager move on many
  Linux desktops, so Ctrl (⌘ on macOS) is the snap-off key.
- **`look_editor.gd` was at 500 lines** (the CI cap): the drag code had to leave the file.
- **Found by the e2e (separate bug, same files):** on a sandbox show, an editor opened after a screen add closed itself
  at the first autosave. Diagnostic from the scenario: `visible false … slug '' / 'untitled_4'`. The client's
  `Store.project` had lost its `slug` after the screen add (a project re-pull / `project_sync` payload carries none;
  `core/project_sync.gd:187-190` `adopt_slug` only puts it back when a save answers, without `project_changed`), so
  `look_editor_stale.gd:10` (WO-918 F12) compared the editor's `''` with the first slug learned and treated it as
  "another show was loaded". Waiting for the slug in the scenario showed it stayed `''` for 10 s after the screen add.
  Which re-pull drops the slug was not pinned down (the stale check was the cheap, local fix).

## 2. What was done

- **`godot/client/features/live/layer_snap_math.gd` (new, pure, autoload-free):**
  - `bounds(fill, crop, deg, canvas)` — a layer's snap box = its visible picture: crop applied, then turned about the
    fill centre (`C.layer_xform`, WO-635) in canvas px, axis-aligned bounds back in canvas fractions.
  - `targets(others, x_axis)` — canvas `0 / 0.5 / 1` plus every other box's start / centre / end.
  - `best_shift(points, targets, thr)` — the nearest of the moving box's start / centre / end to the nearest target,
    strictly inside `thr` (ties: start before centre before end).
  - `move(...)` — move + snap of the snap box (its offset from the fill is fixed under a move, so the fill follows),
    clamped to ±5 like `move_fill`; returns the fill and `guides {x: [], y: []}` = every target the box now lies on
    (`hits`, so a box whose left edge and right edge both meet lines shows both).
  - `resize(...)` — `C.edge_resize` with snapping callables over the same targets; guides only for the dragged edges.
  - `guide_line(v, x_axis, box, area)` — the on-screen segment.
  - `THRESHOLD_PX = 8.0` (was 10): with centres added there are more lines, 8 px keeps the drag from feeling sticky.
- **`godot/client/features/live/look_editor_drag.gd` (new):** the frame's drag motion moved out of `look_editor.gd`
  (move / resize / crop as before) on top of the snap math; holds `guides`, `clear()` on release, `draw()` paints one
  1 px `ThemeBuilder.ACCENT` line per guide across the whole frame, only while a drag is armed. `snap_off(e)` =
  `ctrl_pressed or meta_pressed`. Other layers that are empty or audio-only (not drawn, WO-817) are not targets.
  Resize on a turned layer does not snap (its edge is not an axis line). Crop drags stay unsnapped.
- **`godot/client/features/live/look_editor.gd`** (500 → 465 lines): `_frame_input` delegates motion to
  `_snap.motion(self, mm)` and clears on release; `_draw_frame` ends with `_snap.draw(self, _overlay)`;
  `_others_fills` / `_snap_candidates` removed (now in the drag helper). `compose_math.move_fill` is left untouched — it
  is golden-tested 1:1 against the web's `scenes-compose-handlers.js`.
- **`godot/client/features/live/look_editor_stale.gd`:** `opened_slug(opened, now)` — an editor opened while the client
  did not know the show's slug adopts the first one it learns; a real switch still closes it (the look is gone from the
  other show; `stale()` itself unchanged, WO-918 tests untouched).
- **Tests:** `godot/client/tests/test_wo960_snap.gd` (12 tests: centre → centre with guides, edges → canvas edges,
  outside the threshold, screen-px threshold vs zoom, Ctrl off, neighbour edge / centre targets, nearest wins +
  coinciding guides, crop and 90° rotation via `bounds`, resize edge snap + guide, guide segment, the stale slug fix).
  `godot/client/e2e/scenarios/19_wo960_snap_guides.gd` (GUI).

## 3. Verified

- `godot/client/run-client.sh --test`: **25992 passed, 0 failed**; `--check`: boot OK (no script errors).
  `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- GUI e2e in the sandbox (`node tools/e2e/run-gui-e2e.js --e2e=19_wo960_snap_guides`): **6/6**. A 0.3 × 0.3 layer at
  (0.08, 0.1) dragged with the button held to the canvas centre + (5, −4) px: centre exactly (0.5, 0.5), guides
  `x [0.5] y [0.5]`, and the rendered frame has the accent line at the centre x (> 20 accent samples down the frame);
  after release the guides are gone and the server's look holds the centred fill (X 672 Y 378 576 × 324 on 1920 × 1080);
  the same nudge with Ctrl held lands at ~(0.510, 0.486) with no guide. Screenshots:
  `04_…drag_near_the_centre` shows the vertical + horizontal guide crossing the layer's centre handles,
  `05_…release` the same layer with no guide.
- Regression run `--e2e=03_looks_layers,17_wo918_drag_and_stale,19_wo960_snap_guides`: **22/22** (17's "New project
  closes the editor" still closes it with the slug fix).
- Not done here: the owner's box (live server) — no second client against :4200. Owner QA: feel of the 8 px threshold,
  guide colour over real PRV video, a rotated / cropped layer snapping by its visible picture.
