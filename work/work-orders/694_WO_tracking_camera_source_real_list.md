# WO-694 — Previs camera Source dropdown: only the sources that exist, named for people

**Status: DONE (2026-10-23, Godot 21131/0; box: the dropdown lists SDI input 1 / 2, Program 1, Preview 1 with their channels)**

Owner, 23.10: *"when choosing a source for camera it seems the drop down is full of placeholders."*
Also, same message: *"no rtsp camera. rtsp has too much latency for that use, sdi is prefered."* — no RTSP camera
source will be built; tracking cameras stay on SDI (DeckLink inputs) and Caspar channels.

## Investigation

- Previs → Camera → Inspector "Source" (`godot/client/features/previs/tracking/tracking_page.gd`) was filled from a
  hard-coded `ROLES := ["in1", "in2", "in3", "in4", "ch1", "ch2", "ch3", "ch4", "pgm1", "prv1", "pgm2", "prv2"]`,
  whatever the box has, with the raw role codes as text.
- The server already knows which exist: `GET /api/video-surfaces` (`src/system/video-surfaces.js`
  `resolveRoleChannel`) gives each role its Caspar channel or `null`. On the box: `pgm1` → 1, `prv1` → 2, `in1` → 4,
  `in2` → 5, `pgm2..prv4` null; `in3`, `in4` and `ch*` are not listed at all — 8 of the 12 entries pointed at nothing.
- The client's `VideoSurfaces.descriptors` (`godot/client/video/video_surfaces.gd`) fills only on the first lease
  renewal (up to 5 s after start). The first box run of the fix showed "SDI input 1 — not available" for a source that
  exists: the page had drawn before the descriptors arrived and nothing redrew it.

## What was done

- `tracking_model.gd`: `source_label(role)` (inN "SDI input N", pgmN / prvN "Program N" / "Preview N", chN
  "Channel N") and `source_options(descriptors, current)` — only roles with a channel, inputs first, each screen's
  PGM before its PRV; the camera's own source stays in the list marked "— not available" when it is gone (a camera
  set up on another box keeps its setting instead of silently switching).
- `tracking_page.gd`: the Source dropdown is built from `source_options`, the role is kept in item metadata (the
  text is now a label); the camera list shows "Camera 1 · SDI input 1". The fixed `ROLES` list is gone.
- `video_surfaces.gd`: `signal sources_changed`, emitted when a role's channel changes; the page redraws on it.

## Verified

- Godot suite 21131 passed / 0 failed; `test_tracking_calibrate.gd` `test_source_options_only_real_surfaces`
  (no placeholders, order, label, missing source kept, empty descriptors).
- Box (second client instance, `--tab=1 --previs-mode=camera`): Source shows "SDI input 1  (channel 4)", the open
  dropdown lists exactly SDI input 1 (4), SDI input 2 (5), Program 1 (1), Preview 1 (2). Screenshot
  `w694d.png` in the session scratchpad. Nothing was picked; the project's cameras are still in1 / in2.
