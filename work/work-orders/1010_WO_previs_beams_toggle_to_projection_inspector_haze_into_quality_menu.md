# WO-1010 — Previs: projector-beams toggle moves into the projection Inspector; Haze moves into the Quality menu
**Area:** godot-client, tracking-vr
**Status: DONE (09.11 — Godot suite 26178/0 incl. test_haze / test_previs_quality, boot check, live toolbar screenshot on the owner's client)**

Owner, 09.11: "the projector beams toggle shouldnt be on the main previs window but rather in the inspector when a
projector/projection is selected. move haze into quality as another menu"

## Investigation

- The Previs toolbar (`features/previs/previs_tab.gd`) held Fit, the Quality picker, a separate Haze picker
  (`haze.gd picker()`), a "Projector beams" check box (`projector_beams.gd checkbox()`) and VR…. The toolbar is crowded,
  and beams only matter when the stage has a projection.
- The stage Inspector (`features/previs/stage_panel.gd _build_inspector`) builds per-object controls by type. A
  `projection` object is the natural home for the beams check box. The setting stays global (all projectors), as before,
  so `projector_beams.gd`'s shared state is unchanged.
- `previs_quality.gd picker()` was an OptionButton; a submenu needs a `PopupMenu`, so it becomes a `MenuButton`.

## What was done

- `features/previs/haze.gd`: `picker()` replaced by `static func menu() -> PopupMenu` (radio items synced with the shared
  haze level) and `nearest(h)`.
- `features/previs/previs_quality.gd`: `picker()` is now a `MenuButton` "Quality: <level>". It has radio Low / Medium /
  High / Ultra, a separator and a "Haze: <level>" submenu (`add_submenu_node_item`), and keeps the GPU-time label
  beside it. An `is_instance_valid` guard protects the sync callback, because the shared Haze state outlives a freed
  picker.
- `features/previs/previs_tab.gd` toolbar: `[Fit, Quality, VR…]`.
- `features/previs/stage_panel.gd:256`: a selected `projection` gets a "Beams" row with the
  `projector_beams.gd checkbox()` ("Show (all projectors)").

## What was verified

- Godot suite 26178/0: `tests/test_haze.gd test_menu_levels` and `tests/test_previs_quality.gd` (MenuButton, 6 items,
  the Haze submenu). `--check` boot OK.
- Live: the Previs toolbar shows `3D · Camera · Tracking cameras · People · Fit · Quality: Ultra · GPU 3.3 ms · VR… ·
  Full screen` with no beams or haze pickers. Opened the Quality menu: the Haze submenu changes the level.
- Not seen live: the Narvil show has no projection object, so the "Beams" row has been checked only by code reading
  and the boot check. It appears when the owner selects a projection.
