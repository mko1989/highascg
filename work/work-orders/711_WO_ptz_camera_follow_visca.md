# WO-711 — PTZ cameras follow tracked people over VISCA

**Status: DONE offline (23.10.26: server driver + Godot setup section, smoke 27/27, wired to the WO-708 director by the
lead via src/tracking/auto-ptz.js; UDP loopback only — NO real PTZ camera was tested, owner QA needed)**

Owner, 23.10 (verbatim, shared contract for WO-708 … WO-711):
> "… the same for, if there are any cameras that are meant to be tracked by this, send visca and/or other ptz controls.
> after a while with no person detected the fronts should reset to a home position which is lighting the stage evenly."

The old plan (WO-31, `31_WO_STAGE_AUTOFOLLOW_PTZ.md`) fanned PTZ out through Bitfocus Companion; the owner now wants
HighAsCG to send VISCA itself. `src/autofollow/register.js` is an inert skeleton and stays untouched.

## Investigation

- **Who decides the target.** The Auto director (WO-708) owns "camera k points at person n"; the contract gives this
  service `step(now, targetOf)` with `targetOf(camId) -> {x,y,z} | 'home' | null`. The service only has to turn
  that into VISCA. Contract: `/tmp/.../scratchpad/wo708-contract.md`, "PTZ service".
- **Config lives in a client-owned slice.** `src/engine/project-client-slices.js:11` `CLIENT_OWNED_SLICES = ['previs',
  'fixtures']` keeps the whole `previs` object when a web autosave omits it, so `previs.tracking.ptz` survives the web
  export. The Godot twin keeps unknown keys too: `tracking_model.gd:18` `normalize()` starts from `src.duplicate(true)`,
  so a page save does not drop `ptz`.
- **How a service follows the project.** `src/tracking/detect-service.js:197-216` `apply(project)` reads
  `project.previs.tracking`, skips on an unchanged JSON, and subscribes with `onProjectChanged`. `ptz-service.js`
  `configure(project)` has the same shape (the lead calls it from the same place).
- **Frame.** `src/fixtures/follow-ik.js:7-24` and `follow-patch.js`: PSN, X stage left, Y upstage, Z up, yaw 0 faces
  upstage, 90 stage left (`f = (sin yaw, cos yaw)`). Seen from above that is clockwise, i.e. to the camera's right,
  so a person at +X (stage left) of a camera facing upstage is **pan right = positive** in VISCA. Pan = bearing −
  yaw wrapped to ±180, tilt = elevation − pitch; the aim point is the floor point + `aim_z` (as fixtures do).
- **Godot page.** `tracking_page.gd` (modes calibrate / markers / follow / zones / detect / presenters) creates each
  section, owns `project.previs.tracking` and persists on a section's `edit` signal (zones / detect do this).
  `follow_section.gd` and `presenters_section.gd` get live data from `Ws.message` (`tracking:follow` /
  `tracking:presenters`). The page was at **498** lines (limit 500, `tools/ci/check-max-file-lines.js`), so adding the
  section forced an extraction.
- **Byte formats** (checked on the web, 23.10.26; no camera on this box):
  - AbsolutePosition `81 01 06 02 VV WW 0Y 0Y 0Y 0Y 0Z 0Z 0Z 0Z FF`, Home `81 01 06 04 FF`, worked example
    `81 01 06 02 05 05 01 02 03 04 00 00 05 06 FF`, speeds pan 01-18h, tilt 01-14h:
    https://docs.ptzoptics.com/dev/visca-api/movement
  - Preset recall `81 01 04 3F 02 qq FF`, Zoom direct `81 01 04 47 0p 0q 0r 0s FF`, VISCA-over-IP header (type 01 00
    command, 2-byte big-endian payload length, 4-byte sequence), UDP 52381: https://birddog.tv/x4-series-visca-over-ip-commands/
  - Encapsulated vs raw example `01-10-00-05-00-00-00-00-81-09-04-00-FF` / `81-09-04-00-ff`:
    https://codeblog.jonskeet.uk/2023/11/25/variations-in-the-visca-protocol/
  - Sony control message type 02 00, reply 02 01, RESET = payload `01` (sequence back to 0), sequence wraps at its
    limit: Sony VISCA Command List, VISCA over IP chapter (found via search snippets; the PDFs themselves returned
    403 / 404 here, so this part is **second-hand**).
  - Port 52381 is the "default for most cameras": https://visca-over-ip.readthedocs.io/en/latest/camera.html
  - Raw VISCA in UDP on **1259** (PTZOptics / Lumens) is from memory of the camera manuals, not re-fetched.
  - **Not found anywhere:** the units-per-degree of any camera. 14.4 /° (±2448 = 0x0990 for ±170°) is derived, see Done.

## Done

Server (`src/ptz/`, new):
- `visca.js` pure encoders: absolute pan-tilt (signed 16-bit, nibble-packed), home, preset recall, zoom direct; camera
  address 1-7 -> 0x81-0x87; `ipFrame / ipCommand / ipReset` (8-byte header + Sony RESET); `datagram(protocol,…)`.
  Header cites the sources above.
- `ptz-model.js` `normalizeCamera / normalizeList / aimAngles / toUnits`. Config shape and defaults:
  ```
  project.previs.tracking.ptz = [{ id, name, enabled:false, auto:false,
    protocol:"visca-udp"|"visca-ip" (visca-udp), host:"", port (1259 | 52381), address:1,
    pose:{ x:0, y:-8, z:2.5, yaw:0, pitch:0 },            // PSN m, yaw 0 = upstage (fixtures' convention); pitch + up
    pan:{ min:-170, max:170, units_per_deg:14.4, invert:false },
    tilt:{ min:-30, max:90, units_per_deg:14.4, invert:false },
    speed:{ pan:12 (1-24), tilt:10 (1-20) }, aim_z:1.4, home:{ preset:0 }, zoom:null }]
  ```
  Defaults follow a PTZOptics unit (pan ±170°, tilt −30…+90°, 14.4 units/° taken from ±2448 units = ±170°, which is
  arithmetic from a figure I could not re-verify). Sony BRC / EVI use other scales: the operator edits
  `units_per_deg` and the ranges. Positive pan = camera right, positive tilt = up; `invert` flips the sign
  (ceiling mount). `home.preset` 0 = the VISCA Home command, n = recall preset n.
- `ptz-service.js` `createPtzService({ log, send?, now? }) -> { configure, step, status, cameras, close }`:
  10 Hz per camera, 0.3° deadband against the last sent aim, Home (or preset) once on entering 'home' (re-armed by
  following), `null` sends nothing, disabled cameras never touched, `visca-ip` sends the Sony RESET before a
  camera's first command and again after its host / port / protocol / address changes, a fixed `zoom` goes out once
  with the first aim, one lazily created `udp4` socket closed by `close()`. A missing / malformed host, or a
  throwing `send`, is an `error` in `status()`, never an exception. `status()` per camera:
  `{ id, name, enabled, state: disabled|idle|following|home|error, pan, tilt (° last sent), last_sent_ms_ago, error }`.

Godot (`godot/client/features/previs/tracking/`):
- `ptz_model.gd`, twin of `ptz-model.js` (same defaults / clamps; JS `Math.round` half-up and `=== true` mirrored).
- `ptz_section.gd`: "PTZ cameras" list (Add / Delete), name, protocol, host, port (a default port follows a protocol
  change; a custom one stays), address, pose x/y/z/yaw/pitch, pan / tilt ranges + units/° + invert + speeds, aim
  height, home preset, zoom (−1 = leave), Auto and Enabled ticks, and a status line from the server's
  `tracking:auto` WS event (`ptz` array) or `GET /api/tracking/auto` on show; "—" until the director serves it.
  Shown in the Follow mode under the follow patch. Cameras are created **disabled**.
- `tracking_page.gd`: creates the section, persists its `edit` list into `data.ptz`. To stay under 500 lines the
  "3D stage overlay" toggle + opacity row moved verbatim into `ghost_row.gd` (page 498 -> 493 lines, behaviour
  unchanged).
- `tests/test_tracking_ptz.gd` (picked up by `run_tests.gd`'s `test_*.gd` scan).

Why: pure encoders + model + a thin service keep the geometry and the bytes testable without a camera; the director
stays the single decider (this service has no idea who a person is); the section follows the existing pattern
(`zones`/`detect` emit `edit`, the page owns the slice) so a page save can never overwrite the list with a stale copy.

## Verified

- `node --test tools/smoke/smoke-wo711-ptz-visca.test.js`: **25 / 25**. Byte-exact encoders vs the PTZOptics worked
  example, signed negative positions (F670h), preset, zoom, home, the VISCA-over-IP header (Skeet's example, BirdDog's
  length example, Sony RESET); geometry (straight ahead = pan 0, stage left = pan positive, yaw 90, clamps, straight
  up); rate limit, deadband, home-once, null, preset home, zoom-once, disabled never sent, bad host / port / throwing
  send, RESET + sequence, configure() reset; **real UDP round trip** on 127.0.0.1 (random ports) for `visca-udp` and
  `visca-ip`, and `close()`.
- Godot: `tests/run_tests.gd` headless **21313 passed, 0 failed** (includes the 7 new `test_tracking_ptz` tests);
  `run-client.sh --check`: boot OK.
- eslint + prettier clean; `check-max-file-lines` 0 over; `check-unwired-exports`: no new orphans (the module is
  referenced by the smoke; it is still not called from server code, see below).
- Nothing was sent to any non-loopback address. The GUI was not touched.

## Not verified / owner QA (needs a real camera)

- **No real PTZ camera was tested.** Whether a Sony camera needs / accepts the RESET, whether a PTZOptics unit takes
  raw UDP on 1259 (versus 52381 framed, which PTZOptics also speaks), and every camera's units-per-degree, pan /
  tilt ranges and speed feel are assumptions. QA: set the pose by measuring, Enable one camera, walk the stage, check
  the sign (stage left must pan towards stage left; flip Invert pan if the unit is upside down), tune units/°
  (send a known angle, read the camera's `81 09 06 12 FF` position inquiry), then test Auto, a pin slot, and Home.
- The Sony control-message numbers (02 00 / 01) are from search snippets of Sony's command list, not the PDF.
- The Godot section was compile-checked and its model unit-tested; it was not clicked through (the GUI is live).
- Wiring (lead): `createPtzService` + `configure` on project change + `step(now, director.ptzTargetOf)` at ~10 Hz +
  `ptz` in `GET /api/tracking/auto` / `tracking:auto` + `close()` on shutdown. Add the smoke to the curated list in
  `tools/ci/run-offline-tests.js`.

## Wiring (lead, 23.10.26)
- `src/tracking/auto-ptz.js` (new) creates the service at tracking boot. It configures it from the project (at boot and
  on every change), hands it to the director (`setPtz`, so `ptz: [...]` appears in `/api/tracking/auto`), and calls
  `step(now, director.ptzTargetOf)` on every 33 ms tracking tick. The service rate-limits to 10 Hz per camera itself.
- `allowed: () => duties.has('ptz')` is WO-712 R1's "PTZ out" tick.
- register.js: boot, tick and stop, 3 lines.
- smoke-wo711: 27/27 (+2 wiring tests).
- Live: `ptz: []` (no cameras configured on this box). Server restart clean.
- Unverified default: the tilt `units_per_deg` default is 14.4, the same as pan. From PTZOptics' published ranges
  (tilt −30°…90° ≈ 0xFE70…0x04B0) the lead expects ≈ 13.3. Neither figure is confirmed against a camera, so check it in
  camera QA and edit per camera.
