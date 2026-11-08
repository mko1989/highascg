# WO-1002 — Previs: a "Tracking stage" fold that puts the tracking grid on the MVR's stage; picking by triangles
**Area:** godot-client, tracking-vr
**Status: DONE (08.11 — Godot suite + boot check; real mouse on the owner's GUI: Narvil's stage deck clicked, Fit to selection put the grid on it, saved in the project)**

Owner, 08.11: "I couldn't find in the gui a way to move or set the stage (for tracking) to the previs stage."

## Investigation

- **The tracking stage is the floor grid,** `project.previs.tracking.grid`: width, depth, spacing, `x_offset`,
  `y_offset`, `z_offset` (PSN metres). See `tracking/tracking_model.gd` `GRID_DEFAULT`, 10 × 6 m centred at (0, 3).
  - Tracking cameras calibrate on it (grid corners and crossings are the click points).
  - Follow, zones, walk-the-lines (`walk_model.gd`) and the coverage view (`coverage_3d.gd`) all use its frame.
- **Its only editor was hidden.** The Camera page's "Floor grid" (`tracking_page.gd:184`) sits in `_body`, and
  `_body.visible = not ce.is_empty() and mode == "calibrate"` (`tracking_page.gd:406`).
  - With no tracking camera, no grid field shows anywhere. Narvil has none ("No tracking cameras — add one in the
    Camera view").
  - Nothing ever placed the grid relative to an MVR. Narvil's scene sits where Fit put it (place X -13.16, Y -30.9),
    so its stage deck is about 23 m upstage of the default grid, which was out among the tables.
- **Going through the Camera page would be unsafe.** Until the Inspector adopts it, the page holds no project data
  (`previs_tab.gd` `_on_tracking_changed`, "before the Inspector adopts it the page holds no project data"). A grid
  write through it from 3D mode would have persisted empty tracking data. The new fold writes the project slice
  itself and emits `Store.project_changed`, as `mvr_screens.gd` does. Both the coverage view
  (`previs_tab.gd:183` → `_refresh_coverage`) and an adopted Camera page (`_maybe_reload`) reload from it.
- **Clicking the stage deck selected the venue shell instead** (found in the mouse test): "Selected:
  27.99 × 45.08 m — layer Layer 22".
  - `mvr_scene.gd` `pick` tested each mesh's world AABB. The camera stood inside the shell's box, and Godot's
    `AABB.intersects_ray` gives the start point for a ray that starts inside, so the shell was always nearest.
  - Godot 4.7.2 exposes `TriangleMesh.intersect_ray`, checked with a headless probe: from inside a box it returns the
    far face; for a miss it returns `{}`.

## What was done

- **`tracking/tracking_stage.gd`** (new): the "Tracking stage" fold in the 3D-mode Inspector, under MVR scene.
  - Width, depth, centre X (stage left +), centre Y (upstage +), floor Z and grid spacing, always shown.
  - Each edit merges into `previs.tracking.grid` (normalised) and leaves the rest of the tracking slice alone. Then
    `ProjectSync.mark_dirty()` and `Store.project_changed`.
  - **Fit to selection:** the grid takes the PSN footprint of the selected MVR objects (`mvr_section.selected_uuids()`
    → `scene.wall_boxes`), and its floor is their highest point. The note under it says what was set, and that a
    turned deck gets its bounding rectangle (the grid has no yaw).
- **`tracking/tracking_model.gd` `grid_for(objects)`:** the pure maths, so the test runner can load it
  (`tracking_stage.gd` uses the Store autoload).
- **`previs_tab.gd`:** one line adds the fold after "MVR scene" (the file is now at 500).
- **`mvr_screen_model.gd` `ray_distance(mi, from, dir, cache)`:** box test first, then the mesh's triangles in local
  space. The TriangleMesh is cached per mesh instance id.
- **`mvr_scene.gd` `pick`** uses it; the cache is cleared when another scene is shown. This also fixes the 3D click for
  WO-634 walls and WO-682 moves (`move_targets.gd:83`) inside a shell.

## What was VERIFIED

- **Godot:** `--test` **26136 passed, 0 failed**.
  - `test_tracking_stage_fits_the_selection`: two halves of a 6 × 4 m deck, 1 m high, 25 m upstage give
    `{width 6, depth 4, x 2, y 25, z 1}`; nothing selected gives `{}`.
  - `test_pick_hits_triangles_not_boxes`: from inside a 40 m box, the deck in front is nearer than the shell's far
    side; a miss gives INF; one TriangleMesh is built per mesh.
- `--check` boot OK. The smokes that read the changed files (WO-665/700/706/709/710/713) pass 42/0. No file is over
  500 lines.
- **Real mouse on the owner's GUI** (Previs, narvil):
  - Before the pick fix, a click on the deck selected "27.99 × 45.08 m — layer Layer 22" (the shell). After it, the
    whole deck lit yellow (screenshot).
  - **Tracking stage ▸ Fit to selection:** "Tracking stage = the selection: 18.00 × 10.00 m, centre X 2.53 / Y
    23.24 m, floor 2.30 m". The fields followed.
  - `projects/narvil.json` `previs.tracking` = `{"grid": {"width": 18, "depth": 10, "spacing": 1, "x_offset": 2.53,
    "y_offset": 23.24, "z_offset": 2.3}}`. That is the only tracking key, so nothing else was written.
  - With the selection cleared, the grid outline sits on the deck's front edge.
  - Risery, tried first, holds only the two small risers on the deck, not the deck itself.
- The pointer was put back where it started. `projects/_trash` was unchanged (1).

## Limits

- The grid stays square to the stage. Fit on a deck turned in the venue covers its bounding rectangle.
- PSN positions stay in the previs frame (origin = our stage origin, not the MVR file's). A console that uses the same
  MVR expects the file's frame. Matching that would mean placing the scene at 0 / 0 / 0 or adding an offset to PSN
  output; not done here.
