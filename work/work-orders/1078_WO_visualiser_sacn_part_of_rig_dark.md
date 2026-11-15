# WO-1078 — visualiser: the sACN-driven part of the rig stays dark

**Area:** lighting
**Status: IN PROGRESS (15.11.26 — box side fixed and verified with injected sACN; no sACN from the console reaches the box, so not seen with the real rig)**

Owner 15.11: "part of fixtures are driven by artnet and part by sacn it seems only the artnet input is working now".

## Investigation (15.11.26 09:00, show off, console 2.0.0.11 live)

- `GET /api/fixtures/dmx`: `visualise: true`; all 90 patched fixtures are `protocol: "artnet"` (universes 1–5, 10–18,
  from the MVR import — an MVR carries no protocol, `src/stage/mvr-patch.js:171` gives every fixture the one chosen at
  import). `input.sacn` was `{ port: null, listening: [] }`: `follow-service.js` opened the sACN socket only for
  fixtures patched "sacn", so with this patch the box did not listen for sACN at all.
- Art-Net arrives from 2.0.0.11 for universes 10, 11, 13, 14 (and 30–63, not patched). Patched Art-Net 1–5, 12, 15–18
  (movers, strobes, washes) get no Art-Net: that is the dark part.
- Second fault found on the way: `SacnFrames._join` joined every universe on every IPv4 address including loopback and
  swallowed all errors. Linux allows 20 memberships per socket (`/proc/sys/net/ipv4/igmp_max_memberships` = 20); with
  the box's addresses a patch of more than 5 sACN universes lost the rest silently.
- **On the wire:** a 5 s listen on :5568 with memberships for sACN universes 1–640 on eno1 and eno2 (self-tested: one
  zero packet on universe 150 was received) saw no sACN data and no universe-discovery packet. So right now the
  console's sACN does not reach this box (not sent, sent unicast to another address, or filtered by a switch).

## What was done

- `src/fixtures/dmx-input.js`: `twinUniverse` (console universe N = Art-Net N-1 = sACN N, the convention of the MVR
  import and of the consoles), `sacnUniversesFor`, and `inputFrame` now falls back to the other protocol's twin
  universe when the fixture's own protocol has no fresh frame. Own protocol always wins, so a correctly marked patch
  behaves as before ("Art-Net 2 is not sACN 2" still holds). Chosen over "re-mark the fixtures by hand" because the
  MVR path cannot know the split and the owner would have to edit dozens of fixtures per show.
- Memberships: loopback is skipped; each socket holds at most 20, further ones go to extra sockets that only hold
  memberships (the bound socket receives their groups, Linux IP_MULTICAST_ALL). Unexpected join errors are logged and
  counted (`input.sacn.join_failures`, `memberships` in the status).
- `src/fixtures/follow-service.js`: in visualiser mode the Art-Net tap and the sACN socket run for every visualised
  fixture.

## Verified

- `tools/smoke/smoke-wo1078-visualiser-sacn-fallback.test.js` (4 tests, curated list): mapping, fallback order, 30
  universes joined on every card with 0 failures and released again, wiring. `smoke-wo615-visualise.test.js` unchanged
  and passing.
- Box, after a node restart (09:22): journal `[fixtures] visualiser: sACN input on :5568`; status `listening` = 14
  universes (2–6, 11–19), `memberships: 42`, `join_failures: 0`. A local unicast test stream on sACN universe 2
  (127.0.0.1, 31 packets) appeared in `input.sacn.universes` — that is the frame the fixtures patched Art-Net 1 now use.
- NOT verified: the real rig. After the restart `input.sacn.packets` stayed 0 apart from the test stream.

## Open

- Why no sACN from the console arrives (console output setting / unicast target / switch multicast filtering).
- The global-border lighting input and the pixel-map console path were not touched.
