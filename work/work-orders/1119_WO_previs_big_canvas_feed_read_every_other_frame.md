# WO-1119 — Previs at 36 of 50 fps: the 11520×1536 LED canvas was copied and uploaded on every frame

**Area:** godot-client, video-io
**Status: DONE (17.11.26 — on the box: no client fps incident since the relaunch, was "36 of 50 fps" ongoing)**

Owner 17.11: "try optimizing the rendering of the 3d scene".

## Investigation

- F3 overlay, Previs tab, Quality Ultra, output off: 36 / 50 fps, Frame 41.9 ms, but Render cpu 4.5 ms / gpu 7.7 ms,
  4872 draw calls; main thread 71–80 % of a core. The renderer is not the limit.
- `/dev/shm/highascg-pgm1` is 212 MB = 3 frames of 11520×1536 RGBA (70.8 MB each). `video/video_surfaces.gd`
  `_process` polls every held ring each frame: the native reader (extensions/hshm hshm_source.cpp poll) memcpys the
  frame, then `upload_to` hands the same 70 MB to `texture_update` — 3.5 GB/s each way at 50 fps.
- Test on the box: `REMOVE 2-741` (the pgm1 shm consumer) → client 50 / 50 fps on two reads; `ADD 2-741 SHM NAME pgm1`
  → 37 / 50 again.

## What was done

- `video/feed_roles.gd` `read_every(px)`: 1 up to about UHD, then round(px / UHD), at most 4 (the LED canvas → 2).
  `video_surfaces.gd` skips the poll of a ring on the frames in between: the 17.7 MP canvas is read 25 times a second.
  Applies to every view of that ring on this client (previs walls and the Live tab's monitor).

## What was verified

- Unit suite 30102 passed, 0 failed (new case in test_wo1029_feed_roles.gd); `--check` boot OK.
- Box, client relaunched on the Previs tab at Quality Ultra with the desk lighting the rig: `GET /api/health/keeping-up`
  status ok, no client check failing, no client incident after 18:57 (before: "Operator client at 36 of 50 fps").

## Not verified

- The exact fps (the client reports its rate only while it is behind; the F3 overlay did not open from xdotool on
  this run).
- With the Previs output on as well (WO-1117) — not re-measured after this change.
- A downscaled preview ring from Caspar would remove the copy altogether; not done (needs the shm consumer).
