# WO-1059 — Show LTC out in the timeline's control section

**Area:** godot-client
**Status: OPEN (13.11 — owner request, not started)**

Owner, 13.11: *"the ltc should appear in the control section of the timeline somehow."*

## Investigation

- LTC state is already published: `GET /api/ltc` and WS `ltc.status` (`src/timecode/ltc-service.js`): `output.running`,
  `output.tc`, `output.where`, `output.error`, `output.source`.
- The timeline transport has no LTC read-out; the only place LTC shows is Settings ▸ LTC.

## Proposal

A small read-out next to the transport: the outgoing timecode while it runs, dim when silent, red with the error text when
the device is gone. Click opens Settings ▸ LTC. Open point: also an on / off toggle there?
