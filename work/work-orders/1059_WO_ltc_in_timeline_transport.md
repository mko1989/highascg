# WO-1059 — Show LTC out in the timeline's control section

**Area:** godot-client
**Status: IN PROGRESS (13.11 — built; Godot suite + compile boot green; owner look after a GUI restart pending)**

Owner, 13.11: *"the ltc should appear in the control section of the timeline somehow."*

## Investigation

- LTC state is already published: `GET /api/ltc` and WS `ltc.status` (`src/timecode/ltc-service.js`): `output.running`,
  `output.tc`, `output.where`, `output.error`, `output.source`.
- The timeline transport has no LTC read-out; the only place LTC shows is Settings ▸ LTC.

## Proposal

A small read-out next to the transport: the outgoing timecode while it runs, dim when silent, red with the error text when
the device is gone. Click opens Settings ▸ LTC. Open point: also an on / off toggle there?

## What was done

- `godot/client/features/settings/ltc_model.gd` `readout(status)` → `{text, state, tip}`: "LTC 00:01:02:03" (`run`),
  "LTC --:--:--:--" (`silent`, tooltip says why: the timeline is not playing), "LTC off" (`off`), "LTC error" (`error`,
  the device / libltc error in the tooltip). The tooltip names the output device.
- `godot/client/features/timeline/timeline_ltc.gd` (new): a flat button at the right end of the transport row. Green while
  timecode goes out, dim while silent or off, red on an error. WS `ltc.status` (5 Hz) + `GET /api/ltc` at start. Click
  turns LTC out on / off (`POST /api/ltc/config {output:{enabled}}`; the reply is the new status). No focus (Space stays play).
- `timeline_transport.gd`: separator + the read-out after Follow (383 lines).
- Owner did not answer the on / off question; the toggle is in because the read-out needed a click action anyway.

## What was verified

- `tests/test_ltc_pane.gd` `test_transport_readout` (12 assertions): off, run, silent (with the reason), device error,
  missing libltc, tooltip names the device.
- Full Godot suite: **[tests] 28380 passed, 0 failed**; `run-client.sh --check`: boot OK.
- `POST /api/ltc/config {"output":{"enabled":true}}` on the box returns the status object the read-out consumes
  (`config`, `input`, `libltc`, `output`).
- **Not verified:** on the owner's screen (needs a GUI restart; no second GUI is started on this box).
