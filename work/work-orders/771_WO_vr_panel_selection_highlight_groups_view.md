# WO-771 — VR Programmer panel: a stage pick shows in the list; Fixtures | Groups view

**Area:** tracking-vr
**Status: IN PROGRESS (25.10) — offline-verified (Godot 21801/0, boot check OK); owner headset QA pending**

Owner 25.10 (in the headset):
> when in vr the pallete doesnt display (highlight/select) the selected item in 3d scene.
> toggle to change the list view to a groups view.

## Investigation

1. The VR panel is `programmer_section.gd` itself (`mirror = true`) inside a SubViewport on a quad (`xr_panel.gd`). It
   shares `fixture_selection.gd` and re-marks its ItemList on `changed` (`_mark_list`), so the selection *is* applied.
2. Two reasons it did not show: (a) the list is 110 px tall and `_mark_list` never scrolled — a head picked in the stage
   is usually off the visible rows; (b) the panel's theme (`xr_panel.gd`) is the app theme, which sets no ItemList
   styles, so a selected row in an unfocused list is Godot's default faint grey — invisible through the lenses on a
   dark panel rendered unshaded on the quad.
3. Groups existed only as the "Groups ▾" menu (saved groups + WO-680 By position / By address submenus).

## What was done

- `programmer_section.gd`: `_mark_list` scrolls the last-picked fixture into view (`ensure_current_is_visible`). A
  **Fixtures | Groups** switch above the list swaps it for the groups view (both desktop and VR).
- `programmer_groups_view.gd` (new, a Tree): saved groups, then "By position" / "By address", each group folded with its
  fixtures under it. Click a group → its fixtures (grip / ctrl adds), a fixture → pick (adds / removes). The selection
  is drawn as row colour (lit = all selected, dim = some), never the Tree's own selection. Rebuilt only when the
  patch or groups change (folds kept).
- `xr_panel.gd` `_theme()`: the app theme with ItemList `selected` / `selected_focus` in accent.

## What was VERIFIED

- `tests/test_programmer_groups_view.gd`: state none/some/all, fill (unpatched ids dropped, empty sections dropped,
  headers not picks, folded, unchanged content not rebuilt), mark colours, hooks. Godot 21801/0, boot check OK.
- **Pending:** relaunch the VR client; owner: pick a head with the trigger → its row lights in accent and scrolls into
  view; Groups → click a group → its heads are boxed in the stage.
