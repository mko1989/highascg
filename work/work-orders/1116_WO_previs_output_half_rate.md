# WO-1116 — Previs output (stream / record source) runs at half the program rate

**Area:** godot-client, video-io
**Status: IN PROGRESS (17.11.26 — built, unit-tested; ring not started on the box after the change)**

Owner 17.11: "lets make the stream/rec previs output half so 25fps for 50p (30 for 60)". Follows [WO-1108](./1108_WO_previs_view_as_live_source.md)
(the output cost: 39 fps against a 100 fps publishing target on the gutmanny 26 scene).

## Investigation

- `features/previs/camera/previs_cinema.gd` passed `previs_output_model.gd` `fps_of(channelMap)` (the program rate) to
  the publisher; `app/render_pacer.gd` then drives the client at twice the ring rate (WO-907) — 100 fps for 50p.

## What was done

- `previs_output_model.gd` `out_fps()`: half the program rate from 48 fps up (50 → 25, 60 and 59.94 → 30), a 25 / 30
  show keeps its rate. `previs_cinema.gd` opens the ring with it; the pacer target becomes 50 for a 50p show.

## What was verified

- Unit test (test_previs_output_wo1108.gd): 50 → 25, 60 → 30, 59.94 → 30, 25 → 25. Suite 30098 passed, 0 failed.

## Not verified

- On the box: "Send as a source" on, ring rate in Caspar, client fps with the output on.
