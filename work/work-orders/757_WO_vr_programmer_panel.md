# WO-757 — The full Programmer inside VR: a wrist panel worked by the controller ray (WO-741 step 3)

**Area:** tracking-vr, lighting
**Status: DONE (25.10.26) as part of the detachable VR feature — Godot 21668 / 0; GUI e2e in the sandbox
(`run-gui-e2e.js --e2e=06_xr_walk --xr`) 5 / 5, with a new step: a ray click on the panel opened its Groups menu
inside the panel and its Store answered. The headset itself is untested: no headset is paired (owner).**

Owner, 25.10: *"add a full programmer to the vr lights programming."* Parent: [WO-741](./741_WO_vr_walk_mvr_scene_program_lights.md)
(its "Shape of the work", step 3).

## Investigation

- **What VR could do before.** `features/previs/xr/xr_walk.gd` (WO-741): the right trigger picks a head or aims the
  selection at the floor (`_trigger`, through a non-current Camera3D on the right controller). Nothing else: the
  sliders, wheels, groups, Release and Store lived only on the desktop. WO-741 "Not built" named this step.
- **The Programmer is one Control.** `features/previs/fixtures/programmer_section.gd` (a VBoxContainer, WO-615 T6)
  builds everything itself: the fixture list, All / None / Release / Release all / Delete, Groups (saved, auto by
  position / address), intensity, colour picker, colour wheel, CTO, pan / tilt, Point at, zoom, gobo wheel. Its
  selection is `Sel.shared()`, so a second instance stays in step with the desktop column and the 3D picks.
- **Two instances answer twice.** `programmer_section.gd:85-86` connects `sel.aim_at` (a Point at floor click,
  `fixtures_3d.gd:239`) and `sel.delete_requested` (the Delete key, `previs_tab.gd:308`). A second copy would POST
  `/api/fixtures/program/aim` twice and open two Delete dialogs.
- **Store to look is not in the Programmer.** It is the look card's right-click menu on the Live tab
  (`deck_view.gd` `_card_menu` → `store_fixtures`, recall `POST /api/fixtures/looks/recall`, WO-615 T8). In a headset
  there is no Live tab, so the panel needs it, without a second copy of the code.
- **Godot constraints found while building.**
  - `Panel` is a native class: a `const Panel` fails to parse ("shadows a native class").
  - `Transform3D(Basis.from_euler(…))` is not a constant expression.
  - The test runner (`tests/run_tests.gd`, a SceneTree script) has no autoloads at compile time, so anything that
    preloads a script using `Store` / `Api` fails to compile there. `xr_walk.gd` therefore loads the panel with
    `load()` when the headset starts, as `attach()` already does, and the ray maths sits in the pure model.
  - The runner never enters the tree, so a SubViewport cannot be driven there: the input path is proven in the GUI e2e.
  - A SubViewport stops theme inheritance (`main.gd:25` sets the theme on the root window), so the panel sets it.

## What was done

- **`features/previs/xr/xr_panel.gd`** (new): a Node3D holding a SubViewport (600 × 840 px) on a 0.30 × 0.42 m quad
  (2 px per mm, unshaded, both sides). Inside: the real `programmer_section.gd` (with `mirror = true`) and
  `xr_looks_row.gd`, in a scroll container, themed like the app. `gui_embed_subwindows` is on, so the colour picker,
  the Groups menu and the dialogs draw on the quad. Input:
  - `point(from, dir)`: the ray → a mouse move at the hit pixel; returns whether it is on the panel;
  - `press(pressed, ctrl)`: a left button at that pixel (ctrl = grip, which adds in the list), with the held mask so a
    slider drags; a drag past the edge keeps following, clamped;
  - `scroll(up)`: one wheel notch.
- **`features/previs/xr/xr_looks_row.gd`** (new): a look picker with **Store** and **Recall** under the Programmer.
- **`features/previs/fixtures/look_fixtures_store.gd`** (new): store / recall / clear / count, moved out of
  `deck_view.gd`, which now calls it (same messages). One copy for the look card and the panel; `deck_view.gd`
  497 → 478 lines.
- **`programmer_section.gd`**: `var mirror := false`; a mirror does not connect `aim_at` / `delete_requested`, so
  the desktop column alone answers them.
- **`xr_walk.gd`** (headset path only):
  - the panel on the left controller (`PANEL_UP`, `PANEL_TILT`: above the wrist, tilted to the eyes; a first guess to
    tune in the headset); left **Y** (`by_button`) hides / shows it;
  - a drawn ray from the right controller (to the panel, else 4 m), which the walk did not have: aiming at heads was
    blind;
  - every frame the ray goes to `panel.point`; right stick up / down scrolls the panel while pointed (snap turn stays
    on left / right);
  - `trigger(pressed, add)`: on the panel the trigger clicks there; a release always reaches the panel (it ends a
    drag); otherwise a press picks / aims as before.
- **`xr_walk_model.gd`**: `panel_uv` (the ray / quad maths) and the panel size.
- **`help/vr-walk.md`**: the Programmer on the wrist, its controls, Store / Recall, and "name groups at the desktop"
  (the panel gets no keyboard).

Why the real Programmer in a SubViewport, not a VR-specific UI: WO-741 chose it (one source of truth, minimalism).
Every Programmer change from now on reaches VR without work.

## What was VERIFIED

- **Godot tests 21668 passed, 0 failed.** `test_xr_walk.gd`:
  - `test_panel_ray`: the centre, the top-left origin, misses beside / behind / along the plane, the clamped drag, a
    turned panel, and the pixel aspect;
  - `test_trigger_routing`: on the panel the trigger clicks there with grip as ctrl; a release always reaches it; the
    mirror lines in `programmer_section.gd` and the single Store in `deck_view.gd` pinned.
- **GUI e2e in the sandbox** (Xvfb, real client and server): `run-gui-e2e.js --e2e=06_xr_walk --xr` → **5 passed,
  0 failed**. The new step puts the panel 45 cm in front of the walk camera and clicks through `walk.trigger` along
  a ray from the camera:
  - Groups ▾ → its popup is visible (embedded in the panel's viewport);
  - with a look "E2E look" in the project, Store → the row said "Programmer is empty — set fixtures in Previs →
    Programmer first" (the sandbox patches no typed fixtures), so the click reached the shared store code and the
    server.
  - Screenshot `05_06_xr_walk_the_programmer_panel_works_by_ray.png`: the panel reads at desktop size (buttons, list,
    look row).
- The 4 earlier steps of the scenario still pass. `--check` boot OK. File-size gate OK (`deck_view.gd` 478,
  `programmer_section.gd` 395, `xr_walk.gd` 205).
- **Not verified, owner:** the headset. Whether the wrist placement and the 2 px/mm text are comfortable, the ray
  feel, and Quest controller bindings (`by_button`, `primary` y). A slider drag with a typed fixture was not run in the
  sandbox (no GDTF there); the desktop Programmer it reuses is covered by WO-615.
