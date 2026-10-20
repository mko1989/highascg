# WO-631 — PosiStageNet output, raw Art-Net as the backup choice

**Status: 🟡 DONE on the box 20.10 (PSN multicast received + decoded, switch to Art-Net and back, smoke 8/8, Godot tests);
owner: map the trackers on the grandMA3 / MagicQ and confirm the axes**

Owner 20.10 (after the WO-630 Q1 answer): "add PosiStageNet output then. with a raw artnet as backup choice."

## Investigation

- The follow engine (WO-616 T11 / WO-615) had one output: this box works out pan/tilt per patched head and sends
  ArtDmx (`src/fixtures/follow-engine.js`, `artdmx.js`). The master is `project.fixtures.output.enabled`
  (Godot-owned slice, `follow_model.gd` twin).
- The marker hub already keeps positions in metres plus velocity and PSN-style validity (`status` 0–1, 0 while
  stale). It was modelled on OpenFollow's PSN markers, so trackers come straight from `hub.list()`.
- Wire format: PSN v2.03 description (VYV / MA Lighting, in github.com/vyv/psn-cpp `doc/`) and psn-cpp's encoder (MIT).
  - Everything is little-endian. Chunk header = id 16 bits · data_len 15 bits · has_subchunks 1 bit.
  - DATA `0x6755` at 60 Hz, INFO `0x6756` at 1 Hz, to multicast 236.10.10.10:56565.
  - Packets are at most 1500 bytes. A frame split over several packets keeps one `frame_id` and puts the count in
    each packet's `frame_packet_count`.
- **Axes.** The spec text says "positive x is right, positive y is up, positive z is depth". OpenFollow, built for
  grandMA3, sends its stage frame as is (X stage left, Y upstage, Z up). Which one a given console expects is
  something to confirm on the console, so both are offered.

## What was done

- `src/fixtures/psn.js`:
  - `encodeData` / `encodeInfo`: tracker id = marker id. Each tracker carries pos, speed, status (0 while stale)
    and a per-tracker timestamp (the marker's age). INFO carries the system name and each tracker's name.
    Frames are split at 1500 bytes.
  - `decode` for tests and sniffing.
  - `PsnSender`: one UDP socket, TTL 1, optional multicast interface, timers for DATA every 1/60 s and INFO
    every 1 s; status counters.
- `follow-patch.js`:
  - `output.protocol` "psn" (default) | "artnet".
  - `output.psn` {group (must be 224–239.x), port, iface (an IPv4 or "" = OS route), system_name, axes "stage" | "y_up"}.
- `follow-engine.js`: sends ArtDmx only while the protocol is "artnet". Aims are still computed for the previs beams.
  Status reports `protocol`.
- `follow-service.js`: drives the `PsnSender` from the same project slice. `GET /api/tracking/follow` adds `psn`
  (state, counters, last error, this box's IPv4 interfaces).
- Godot:
  - `follow_output.gd` (new): protocol choice ("PosiStageNet → console (MA3 / MagicQ aim)" / "Art-Net backup (this
    box aims)"), group, interface (from the server list), system name, axes, plus the live counter line.
  - `follow_section.gd`:
    - the master is now "Output", and its confirmation names the protocol;
    - switching protocol while the output is ON asks first;
    - the hint says calibration jogs heads over Art-Net, so pick the backup while calibrating.
  - `follow_model.gd normalize_psn` is the twin of the server's normalisation (Godot test).
- `tools/smoke/smoke-wo631-psn-output.test.js` (curated, 8 tests), covering:
  - header bits;
  - the packet header (v2.0, frame id, count);
  - tracker fields;
  - stale → status 0;
  - axes;
  - INFO names;
  - an 80-tracker frame split into ≤ 1500-byte packets with a shared frame id;
  - normalisation;
  - the engine sending no Art-Net under PSN;
  - the sender with a fake socket.
  The WO-616/624/630 follow tests now pin `protocol: 'artnet'` where they expect ArtDmx.

## What was VERIFIED (20.10, box)

- Server restarted. `GET /api/tracking/follow` → protocol psn, PSN off, interfaces eno1 192.168.50.64 + tailscale0.
- Godot Previs → Follow: Output toggle → "Start PosiStageNet output? … 236.10.10.10:56565 at 60 Hz" → OK.
  - A separate listener joined 236.10.10.10:56565 for 4 s: 234 DATA (≈ 58/s) + 4 INFO packets from 192.168.50.64.
  - Decoded: version 2.0; tracker 9 pos (1.25, 3.5, 0), status 1; INFO system name "HighAsCG", tracker name "PSN test".
  - Art-Net packets 0 while PSN was on.
- Protocol → "Art-Net backup" while ON → "Switch the live output to Art-Net — this box starts aiming the patched
  heads itself now?" → OK. Result: PSN 0 packets in 2 s; ArtDmx to the test fixture's 127.0.0.1:6455 started.
- Restored: output off, protocol back to PSN. The project slice is `{enabled: false, protocol: "psn", psn: defaults}`
  (the same behaviour as the original `{enabled: false}`). Test marker 9 deleted from the hub. The counter line shows
  "PSN off → 236.10.10.10:56565 · 2546 packets · 0 errors".
- Gates: lines 0 over 500 · lint 217 warnings / 0 errors · prettier · unwired exports · offline suite 2912/0 · Godot 16184/0.

### Open (owner)

- grandMA3: add the PSN input (on the show network interface), map tracker ids to fixtures, and walk a marker
  upstage / stage left. If the console's tracker moves on the wrong axis, switch Axes to "Y up". Same on MagicQ
  (PSN tracking input).
- With a switch that has IGMP snooping, a querier must be active or the multicast never reaches the desk.
- MVR export of the calibrated fixture poses, so the desk's 3D layout matches ours: follow-up with WO-612.
