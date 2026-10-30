# WO-788 — Live picture in the timeline editor

**Area:** engine
**Status: DEPRECATED (27.10 — owner wanted the Live preview itself, with 2D / 3D; the monitor was removed. Successor: [WO-789](../789_WO_timeline_uses_live_preview.md))**

Owner, 26.10 (after WO-787):
> there is no live preview in timeline editor...

Parents: [WO-602](../602_WO_godot_port_timeline.md) (Godot timeline tab), [WO-600](../600_WO_godot_port_live_core.md) F
(the look editor's compose frame over the live PRV picture), [WO-787](../787_WO_timeline_preview_and_smooth_scrub.md).

## Investigation

- `timeline_tab.gd` was the transport bar, the Dest row and the canvas only. There was no picture: WO-602 ported the
  web editor's canvas and transport, but not the web's compose preview.
- The look editor (`features/live/look_editor.gd:140, 389`) draws the live channel from the `VideoSurfaces` autoload
  (`video/video_surfaces.gd`): `texture("prv1")`, held with `acquire` / `release` while visible. A held runtime role is
  leased on the server (TTL 15 s), so an unseen picture costs nothing.
- The surface texture is created once per role (`video/shm_texture.gd:22-25`), so a TextureRect can keep it.
- Where the timeline plays is its routing (`sendTo {preview, program, screenIdx}`, the Dest row). PRV is the editing
  bus; with program only (after a Take), the picture is on PGM.

## What was done

- **`features/timeline/timeline_monitor.gd`** (new): a black panel with the role's texture, aspect kept and centred,
  and a "PRV 1" / "PGM 2" tag. It follows a routing (`follow(st)`), and holds the role only while the tab is visible.
  It releases everything on exit.
- **`features/timeline/timeline_send_to.gd`** `monitor_role(st)` (pure, testable without autoloads):
  - PRV of the Dest screen;
  - "All screens" → screen 1;
  - PGM when the timeline goes to program only.
- **`timeline_tab.gd`**: the monitor and the canvas share a VSplitContainer. The divider height is stored in `ui.cfg`
  `[timeline] monitor_h` (default 260).
- **`timeline_dest.gd`** `refresh()` ends with `tab.monitor.follow(st)`, so the picture follows Dest / PRV / PGM, a
  Take, the engine's adopted routing and timeline switches.

## Verified

- Godot tests: 21896 passed, 0 failed, including `test_timeline_send_to.gd` `test_monitor_role` (4 routings).
  `run-client.sh --check` boot OK.
  - A first version kept `role_for` on the monitor. The script test runner has no autoloads, so that file (which uses
    VideoSurfaces) cannot compile there, and the test failed. The function now lives in the pure routing model.
- Off-screen render, Timeline tab: `xvfb-run … --tab=2 --screenshot`, after a paused seek of the owner's timeline to
  20 s.
  - The monitor shows "PRV 1" with INTRO.mov's frame at 20 s (the "420 PRODUKTÓW" title), the 3840×1792 picture
    letterboxed.
  - The playhead is at 00:20:00 under it. The canvas is unchanged below.
- Owner QA: relaunch the client; scrub and play while watching the monitor; drag the divider.
