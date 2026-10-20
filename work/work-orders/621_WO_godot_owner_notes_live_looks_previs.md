**Status: IN PROGRESS (2026-10-20) — N7 (Previs: no 2D, no camera spin) DONE, box-verified. Next: N3 timer icon, N4 look-card cog/play, N5 editor alone at the bottom, N2 look editor px + aspect lock, N6 Live standard ↔ 3D switch, N1 preview destination chrome + tile move/resize. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Related: [WO-600](./600_WO_godot_port_live_core.md) (live core: items B/C compose tiles), [WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md) (2D mode — partly reversed here), [WO-607](./607_WO_godot_previs_native_3d.md).**

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
