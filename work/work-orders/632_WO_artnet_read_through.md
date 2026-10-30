# WO-632 — Art-Net read-through: the follow backup starts from the console's values

**Area:** lighting, tracking-vr
**Status: DONE — 🟡 DONE on the box 20.10 (fake console → box → output: pass-through, fade to tracking and back, console
loss held; smoke 9/9, Godot tests); owner: patch a real console's universes to the box and run a handover**

Owner note (next.md): "can the artnet value be read before its changed, so it aligns with the console values until it
starts tracking then the output is turned on and the transition is seemless."

## Investigation

- The Art-Net backup (WO-616 T11, now the WO-631 backup choice) owned every channel of each patched universe.
  Channels no fixture used went out as 0, and a head jumped from wherever the console left it to the tracked aim
  the moment Output went on. The operator had to release the heads on the console first.
- The box already listens for Art-Net on :6454 (the lighting input, `src/artnet/artnet-udp.js`, `reuseAddr`). On
  Linux a second `SO_REUSEADDR` UDP socket on the same port steals unicast datagrams from the first. So the
  read-through cannot open its own :6454 socket while the lighting input runs. It has to tap that socket.
- If the console sent to the same universe the box outputs, the box would read its own frames back. So the console
  sends on another universe (offset), and the box refuses a patch where a fixture's output to itself would land on
  the read universe.

## What was done

- `src/artnet/artnet-tap.js` (new): in-process fan-out of every datagram the lighting input socket receives
  (`publish` / `subscribe`), plus an owner count so a consumer knows whether that socket exists.
  `artnet-udp.js` publishes before parsing and counts itself while bound.
- `src/fixtures/follow-through.js` (new):
  - `normalizeThrough` → `{enabled false, offset 0 (±32767), fade_s 1 (0–30)}` (Godot twin
    `follow_model.normalize_through`).
  - `axisDeg` / `consoleAim`: the console's pan / tilt bytes back to degrees.
  - `blendFixture`: pan / tilt blended in degrees (not bytes, so a 16-bit wrap can't jump); the fixture's fixed
    channels blended in DMX.
  - `ConsoleFrames`: the latest frame per port-address via the tap. It binds its own :6454 only while nothing owns
    it (re-checked every 2 s, released as soon as the lighting input binds). `frame()` is fresh (≤ 2.5 s);
    `last()` is any age.
- `src/fixtures/follow-engine.js`:
  - With read-through on (and protocol Art-Net), each patched universe starts every tick as the console's frame
    for `universe + offset`. Every channel passes through.
  - Per head, a weight `w` moves by `dt / fade_s` toward 1 while it tracks (marker following and status > 0, or
    calibrating) and toward 0 otherwise. Pan / tilt = console + (aim − console) · w.
  - At w 0 the IK starts from the console's aim, so tracking takes the pan solution nearest to where the console
    left the head.
  - **A console that stops sending is held**: its last frame stays the base (no blackout, no snap). Before any
    console frame the aim alone is on the wire (w 1), so a console appearing fades in.
  - The self-read guard: a fixture whose output reaches this box's :6454 on a read universe is "not output".
- `follow-service.js`: starts / stops `ConsoleFrames` with read-through. Status adds `console` (packets, own
  socket, universes seen + age), per fixture `through` (console / fading / tracking) and `console`
  (live / held / none). The WS snapshot carries both.
- Godot `follow_output.gd`: under "Art-Net backup", a "Read the console first" checkbox, "Console universe = out +"
  and "Handover fade s". The status line explains the patch and lists the console universes seen (polled every 2 s
  while the page is open; spinboxes keep focus while typing). `follow_section.gd`: the fixture list shows
  `[console|fading|tracking · console lost, its look held]`, and the Output confirm says the console's values pass
  through.
- `tools/smoke/smoke-wo632-artnet-read-through.test.js` (9 tests, curated); `test_follow_model.gd`
  `test_output_through`.

## What was VERIFIED (20.10, box)

- Godot Previs → Follow: protocol "Art-Net backup" shows the read-through rows; PSN hides them. Ticking "Read the
  console first" and offset 10 reached the server (`through {enabled true, offset 10, fade_s 1}`). The lighting
  input wasn't bound, so the read-through opened its own :6454 (`own_socket true`).
- A fake console (node, `encodeArtDmx`) sent U10 at 30 Hz to 127.0.0.1:6454: ch1–4 = 200,17,90,5 (pan / tilt
  16-bit), ch10 = 123. The test fixture is U0.001 → 127.0.0.1:6455 (listener), Output ON (confirm dialog). The log
  was sampled every 0.5 s (ch1, ch2, ch3, ch4, ch10):
  - 0–1.3 s: first console frame → faded in from the aim to `200,17,90,5,123`.
  - Follows = Marker 1 (detect replace pin, status 0): `200,17,90,5,123`, the console 1:1.
  - Follows → Marker 2 (operator, status 1, at (4,6,0)), engine got it ~3 s later (project sync debounce):
    8.8 s `207,59,70,89` → 9.3 s `222,21,29,144` → 9.8 s `229,77,9,187`, steady. ch10 = 123 throughout.
  - Follows → Marker 1 again: 18.8 s `225,8,21,116` → 19.3 s `210,211,60,121` → 19.8 s `200,17,90,5`, exactly the
    console.
  - Console stopped at 22 s: output stayed `200,17,90,5,123` to 28 s; status `console: held`.
- The status line showed "Console frames: U10 from 127.0.0.1 (0.0 s)"; the list showed `… · out of range [console]`.
- Found and fixed while testing: the first version zeroed the universe once the console went stale (dimmers
  would black out on a network drop), and reset w so the console's return snapped. Both are now covered by the
  "console that stops sending is held" test.
- Restored: Output off, read-through off, offset 0, protocol PSN, Follows none, test markers 1 / 2 deleted (hub
  empty). The project slice is `{enabled false, protocol psn, psn defaults, through defaults}`. Nothing listens on
  :6454 afterwards.

### Open (owner)

- With a real console: patch the follow heads' universes to also go to this box at output + offset (e.g. MA3 Art-Net
  output, second destination, universe +10), tick read-through, then Output ON → nothing should move. Track a
  marker → the head fades to it; lose it → it fades back to the console's look.
- Fade time default 1 s — adjust to taste.
