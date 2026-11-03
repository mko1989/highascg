# WO-957 — VR headset black while the GUI mirror shows the scene: WO-892's SMAA on the multiview viewport

**Area:** tracking-vr, godot-client
**Status: DONE (03.11.26 — offline stereo probe: SMAA alone reproduces the headset's error set, debanding / MSAA 4x / glow clean; Godot suite 25772/0, the new test fails 4/4 without the fix; live: the restarted XR client logs 0 framebuffer errors where the old run logged 5203 from its first frame. Seeing the picture in the Quest 3 needs the headset on)**

Owner, 03.11.26: "somethings wrong with vr. on the screen in gui i can see the scene but in the gogles its black."

## Investigation

- WiVRn (`journalctl --user -u wivrn`) was healthy: the Quest 3 connected and the session reached FOCUSED, with the
  encoder at 72/90 Hz. The runtime was not the problem.
- The XR client log (`~/.highascg/log/godot-xr.log`, run 18 of 18) logged 5203 copies of
  `Layers of our texture doesn't match view count for this framebuffer`, followed by `framebuffer is null`, the
  `fragment shader output mask` mismatch and `!draw_list.active`. These start right after start-up, before the
  client is even connected to the server. The eye framebuffer is never created, so the headset gets nothing.
- The GUI shows the scene because WO-770's mirror is a separate, non-XR SubViewport (`xr_walk.gd _make_mirror`).
- Runs 14–17 in the same log were XR runs without the WO-892 code (its `apply_globals` prints a
  `ssr_roughness_quality deprecated` warning) and had 0 of these errors. Run 18 is the first with WO-892 code.
- WO-892 (31.10, `previs_quality.gd`) applies the quality level to the previs SubViewport in
  `previs_stage._on_quality`. That runs in `_ready`, before `xr_walk._start_xr` sets `use_xr = true` on the same
  viewport. The default Medium level turns on `SCREEN_SPACE_AA_SMAA`. `apply_viewport` did exempt XR from Ultra's
  1.5x supersampling (`vp.use_xr`), but the flag wasn't set yet when it ran.
- Offline repro (scratch project, a GDScript `XRInterfaceExtension` with 2 views, SubViewport `use_xr`, Godot
  4.7.2, Forward+, `xr/shaders/enabled`):
  - SMAA off + debanding: 0 errors.
  - SMAA on: 600 errors over 40 frames, the same set as the headset log.
  - MSAA 4x, glow, debanding: 0 errors.
  So Godot 4.7.2's SMAA has no multiview path.

## What was done

- `previs_quality.gd apply_viewport`: SMAA only when `not vp.use_xr`.
- `xr_walk.gd _start_xr`: right after `use_xr = true`, the stage SubViewport gets `apply_viewport` again. That drops
  SMAA and also makes the existing no-supersampling rule for XR actually apply. Level changes later go through
  `_on_quality` → `apply_viewport` with `use_xr` already set, so they stay safe.
- MSAA is left on: it is multiview-safe (High/Ultra keep 4x in the headset). Medium has no anti-aliasing in the
  headset now. That is a possible later choice (MSAA 2x for XR), not part of this fix.

## What was VERIFIED

- `godot/client/tests/test_previs_quality.gd test_headset_view_never_gets_smaa_or_supersampling`: on a `use_xr`
  SubViewport, Medium/High/Ultra apply no SMAA and scale 1.0, MSAA follows the level, and `xr_walk` re-applies after
  setting `use_xr`. On the old code it fails 4/4. Godot suite 25772 passed / 0 failed; `run-client.sh --check` OK.
- Live: the old XR client (pid 191567) was ended and `POST /api/vr/start` launched the fixed one (pid 204261) on the
  running WiVRn. The headset stayed paired and WiVRn shows "1 active app session". 0 framebuffer errors and no
  `ERROR` lines through `[client] ws connected`. The old run had them from frame one, regardless of headset presence.
- The headset reported no one wearing it (presence false, IDLE), so the eye picture itself was not seen from here.
