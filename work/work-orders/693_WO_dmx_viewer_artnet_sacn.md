# WO-693 — DMX viewer: Art-Net nodes / sACN sources + a live 512-slot grid

**Status: DONE (23.10; smoke 5/5, Godot tests 21126/0, box: loopback Art-Net + sACN shown live, ArtPoll found 3 real nodes)**

Owner, 23.10: *"An artnet/scan viewer window would be great."*

## Investigation (23.10)

- Before this, there was nothing to see. The lighting input (WO-632, `src/artnet/`) only reports the channels it
  maps. The fixture engine's `GET /api/fixtures/dmx/frame` (`src/api/routes-fixture-dmx.js:104`) shows only what
  *this* box sends. No code sends ArtPoll or reads ArtPollReply or sACN universe discovery.
- **The :6454 contract (WO-632).** A second `SO_REUSEADDR` socket on :6454 steals unicast from the lighting input, so
  readers must subscribe to `src/artnet/artnet-tap.js` instead of binding again. The tap had no way to say how many
  owners exist. A viewer that opened its own socket while the input is off must step aside when the input opens.
- **Loop hazard** (memory *artnet-out-loops-into-own-input*): never send ArtDmx to broadcast / U0 while testing. The
  viewer must only *listen* and send ArtPoll; tests use loopback and test ports.
- **Interfaces on the box:**
  - `eno1` 192.168.0.23/24 and the 2.x Art-Net NIC are polled at their directed broadcast;
  - `tailscale0` is a /32, where broadcast == address, so it is skipped (the first live poll hit 100.101.245.97 itself).

## What was done

### Server

- `src/artnet/dmx-monitor-codec.js` (new):
  - `encodeArtPoll` (opcode 0x2000, protocol 14);
  - `decodeArtPollReply`: IP, short / long name, node report, MAC, BindIndex, and port-addresses per port from
    Net / Sub / SwIn / SwOut, with PortTypes 0x80 = output and 0x40 = input;
  - `decodeSacnDiscovery`: E1.31 universe discovery (CID, source name, page, universe list).
- `src/artnet/dmx-monitor.js` (new) `DmxMonitor`, started by the first `touch()` and stopped 15 s after the last one:
  - **Art-Net** subscribes to the tap. A 2 s check opens the viewer's own :6454 socket only while `tap.count() == 0`
    and closes it when another owner appears. The own socket publishes to the tap and counts as an owner, so
    `listening` reads `own` or `shared`.
  - **sACN** opens its own 5568 socket and joins the watched universe's group plus discovery (239.255.250.214) on
    every interface.
  - Keeps ArtDmx senders (per IP), ArtPollReply nodes (`ip#bindIndex`), sACN sources (per CID) and the watched
    universe's latest 512 slots, with source, priority and age. Entries are forgotten after 60 s. The box's own
    IPs and 127.* are marked `self`.
  - `poll()` sends ArtPoll to each interface's directed broadcast, skipping /32s. It **never sends ArtDmx**.
- `src/api/routes-dmx-monitor.js` (new; one `register` line in `src/api/router.js`):
  - `GET /api/dmx-monitor?protocol=&universe=` touches the monitor and returns the snapshot;
  - `POST /api/dmx-monitor/poll` returns `{sent}`.
- `src/artnet/artnet-tap.js`: exports `count()`.
- `docs/wiki/api/contract/http.md` regenerated (`node tools/dev/gen-api-contract.js`). It also picked up WO-692's
  Wi-Fi routes.
- `tools/smoke/smoke-wo693-dmx-monitor.test.js` (in the curated CI list), 5 tests:
  - the codec;
  - `ipv4Interfaces`;
  - the ownership hand-off with a fake tap and dgram (ArtPoll only, never ArtDmx);
  - with the input already owning :6454, no own socket and the right sACN joins;
  - real datagrams on loopback test ports 46454 / 45568.

### Godot (Previs → Fixtures → "DMX viewer…")

- `features/previs/fixtures/dmx_monitor_window.gd` (new). The toolbar holds:
  - protocol;
  - universe (Art-Net 15-bit port-address / sACN 1–63999);
  - view: **Network input** or **This box sends** (the fixture engine's frame);
  - **Scan (ArtPoll)** and a status line.
  On the left is a node / source list; clicking a row jumps to its first universe. It polls every 0.25 s while
  visible, and the server listens only while the window is open.
- `features/previs/fixtures/dmx_grid.gd` (new): a 32 × 16 grid with level fills and values, and the tooltip
  "Ch n = v (p %)".
- `features/previs/fixtures/dmx_monitor_model.gd` (new, pure) builds the labels ("7:15:15 (2047)"), the rows and
  the status text. A 404 from the box-output frame reads "this box outputs nothing on this universe"; patched heads
  that are not routed to an output universe give that too.
- `features/previs/fixtures/fixtures_section.gd`: the "DMX viewer…" button (`:111`, `_open_viewer` `:330`).
- `tests/test_dmx_monitor_model.gd` (new): labels / clamps, rows, status / values.

## What was VERIFIED

- Smoke `smoke-wo693-dmx-monitor` **5/5**.
- Godot suite **21126 / 0**.
- `check-max-file-lines` 0 over; `format:check` OK.
- Live API, with a loopback sender (`scratchpad/dmx-send.js`: ArtDmx PA 2047 and sACN U999 → 127.0.0.1 only):
  - frame `[255, 128, 104, …]` from 127.0.0.1, `listening: own`;
  - the sACN source "WO-693 test" seen;
  - `ss` showed the viewer on :6454 / 5568, because no lighting input owned :6454.
- GUI on Xvfb `:77`, screenshots in `/tmp/claude-1000/-home-casparcg/daed53bd-d6cf-409c-8b5b-90a4cc140fc5/scratchpad/`:
  - `x5.png`: viewer open, "▸ 127.0.0.1 (this box) → 2047" listed;
  - `x6.png`: row click → U 2047 "Art-Net 7:15:15 (2047) ← 127.0.0.1", live grid, tooltip "Ch 2 = 128 (50 %)";
  - `x7.png`: **Scan** → "ArtPoll sent to 192.168.0.255, 2.255.255.255". Real replies were listed:
    - ◆ Focus Profile · 2.0.0.198 and · 2.0.0.197 (out 0, in 0);
    - ◆ Capture · 192.168.0.61 (out 0–3);
  - `x9.png`: sACN U999 ← 127.0.0.1 "WO-693 test", live grid;
  - `x10.png`: "This box sends" on Art-Net 0 → the 404 status (the MVR heads are patched but not output).

## Open

- Owner QA with a real console feeding the box. The flows not yet seen live are the lighting-input hand-off and
  multicast sACN from another host.
- While the viewer is open, its own 5568 socket can share unicast sACN with the sACN lighting input. Multicast is
  unaffected. If the owner runs a unicast sACN input, the next step is a tap for sACN like WO-632's.
