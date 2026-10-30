# WO-640 — Previs opened its own inspector column next to the shared Inspector; sections collapsible

**Area:** godot-client
**Status: DONE (2026-10-21) — Godot --test 20634/0 + --check; box: Previs 3D shows one Inspector column with ▾ sections, folding Stage / MVR scene works and is remembered (ui.cfg), both reopened afterwards. Parent: [WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md) R2 (the one Inspector).**

Owner, 21.10: *"also in previs there is an additional inspector instead of using the already existing
inspector."* Then: *"in the previs inspector make the sections collapsable."*

## Investigation

- `godot/client/features/previs/previs_tab.gd` (an HSplitContainer) added `_build_panel()` as its second child: a
  `PanelContainer` (PANEL_W + 40 wide) with its own scroll, holding Stage (stage_panel.gd with its per-object
  field grid), MVR scene, Fixtures, Models, Live source, Camera and Screens. The shell's Inspector column
  (`app/inspector_panel.gd`) sat to the right of it, empty ("Select an item"). In 3D mode the screen therefore had
  two right-hand columns.
- WO-608 R2 / `inspector_panel.gd:2-5`: "Features never open their own right-hand panels: they hand a page to
  `present()` … and `release()` it". Camera mode already did this (`track_page`); 3D mode did not.

## What was done

- `previs_tab.gd`: the panel is now `_side`, a plain VBox page. It is presented to the Inspector while the tab
  is shown in 3D mode and released otherwise, the same pattern as Camera mode's `track_page`. It is first parked
  hidden in the tab, so `stage_panel._ready` builds its list before `bind()`. Its own scroll is gone, because the
  Inspector scrolls. `split_offset` is gone too.
- `features/previs/fold_section.gd` (new): a "▾ Title" row that folds its content. The open state is kept per
  title in `user://ui.cfg [previs_folds]`, a per-viewer convenience; nothing saved = open. All seven sections use
  it, and the "(WO-6xx)" tags are dropped from the headings.

## What was VERIFIED

- Godot `--test` 20634 passed, 0 failed (`tests/test_previs_fold_section.gd`: holds its parts, open by default,
  folds); `--check` boot OK; line limit 0 over (previs_tab.gd 482).
- Box (client relaunched, Previs tab): the stage view is full width up to the single Inspector. The Inspector shows
  ▾ Stage (the 3 LED walls), ▾ MVR scene (Pabianice Final Patch, 418 objects), ▾ Fixtures (programmer, Art-Net
  universes, Visualise console), then Models / Live source / Camera / Screens. Folding Stage and MVR scene
  collapsed them and wrote `Stage=false`, `"MVR scene"=false` to ui.cfg. Both were reopened afterwards.
