# WO-630 — owner notes (next.md, round 4): four answers + click-to-place markers / click calibration

**Area:** tracking-vr, lighting
**Status: DONE — 🟡 F1 DONE (20.10 — box: Follow click-calibration point + Undo + Done; Markers click-to-place; detection-pin hint);
Q1 → owner chose PSN out + raw Art-Net fallback (WO-631); F2 Art-Net read-through → WO-632; MVR import stays WO-612**

The owner's `next.md` (read-only) ends with four questions and two notes. This work order holds the written answers and the
first note (F1). The second note (F2) is WO-632.

## Investigation

### F1 — "i cant seem to simply put the markers with mouse to calibrate a moving head light"

- Calibrating a fixture (WO-615/616 Follow → Calibrate) asks for floor points. The server's `point` action only took
  `marker: id` and read that marker's live hub position. So the operator had to drive a marker onto the beam spot with
  the stick/arrows (or a drag), then press Add point. A floor click in the picture did nothing in Follow mode.
- In Markers mode, a press on empty floor only grabbed a marker if it hit the circle. There was no "put it there".
- On the box the project's detection is `pin_mode: replace, pin_marker_id: 1`. `detect-pin.js drives(id)` is true while
  the pin holds the marker, **including status 0 (nobody seen: held, invalid)**. `register.js` drops operator writes to
  a driven marker so the client's heartbeat can't flap its source. Marker 1 therefore can never be placed by hand while
  replace-pin detection is on, and nothing said so. The box's marker 1 sat at (−25.2, 47.3) m, off the stage.

## What was done

### F1

- Server `src/fixtures/calibrate-session.js`: the `point` action also takes `at: [x, y, z]` (metres, |v| ≤ 500, else
  400). The beam spot is a floor position; no marker is needed.
- Godot:
  - `marker_driver.gd`:
    - `floor_at(px, z)` turns a picture pixel into a floor point (through the camera's calibration).
    - `place_at(px)` puts the selected own, non-driven marker at the clicked floor spot at once (no glide) and keeps it
      grabbed, so holding the button drags it on.
  - `previs_tab.gd`: a press that grabs no marker →
    - **Follow while calibrating**: the click is the beam spot (`follow_section.add_calib_point` →
      `calibrate_section.add_floor_point`).
    - **Markers**: `place_at`.
    - **Detect**: picks the person, unchanged.
  - `tracking_view.gd`: hints for each case.
    - "Follow — calibrating: jog the beam onto a floor spot, then click the spot in the picture"
    - "Markers — click the floor: the selected marker goes there …"
    - When the selected marker is replace-pinned: "the selected marker is steered by detection (replace pin): set
      Detect's pin to off or assist to place it".
  - The replace-pin lock is kept on purpose. Letting hand writes through at status 0 would flip the follow output
    between valid (operator) and invalid (held) every heartbeat. The fix for calibration is the floor click, which
    needs no marker at all.
- `tools/smoke/smoke-wo630-calibrate-click.test.js` (curated): `at` accepted / validated / Undo.

## Answers

### Q1 — "best way to relay the desired/calibrated position of the moving heads to a gma3 and chamsys magicq mq500"

**Send positions, not pan/tilt: PosiStageNet (PSN) out.** Both consoles take PSN natively.
- grandMA3: MA Tracking / PSN input drives fixtures in its 3D stage. The console does the pan/tilt maths from its own
  patch, so the operator keeps palettes, timing and busking on the desk.
- MagicQ (MQ500): PSN and OTP (ANSI E1.59) tracking input map trackers to fixtures in its 3D layout.

Both consoles must know where each fixture hangs, the same as our calibrated rig. Export the calibrated fixture poses
as MVR (WO-612 import has the mirror path) so the two 3D layouts agree.

Fallback: our own Art-Net pan/tilt (WO-615 follow) straight to the fixtures, merged or HTP'd at the node. This works
with any desk, but the console loses control of those channels while it runs.

**Owner decision 20.10: "add PosiStageNet output then. with a raw artnet as backup choice." → WO-631.**

### Q2 — "could we integrate somehow dxv alpha compatibility?"

**Decode: it already works. Encode: no.**
- Caspar links the system FFmpeg `libavcodec.so.60`, which has the `dxv` decoder: DXT1/DXT5 (DXV2) → rgba, DXV3 HQ →
  yuva420p.
- Box test 20.10: FFmpeg's FATE samples (`dxv-wa`, `dxv3-nqwa`, `dxv3-hqwa`) LOAD/PLAY in Caspar, and the media
  scanner lists them as `codec: dxv`.
- **The samples carry no real transparency.** Every "with alpha" sample has alpha 255 everywhere, so on this box we
  can't prove keying through Caspar. The decoder outputs the alpha plane, and Caspar's ffmpeg producer keeps
  rgba/yuva, so it should key.
- Owner check: play a real Resolume export with alpha (DXV3 HQ + alpha) over a colour layer and look at the edge. It is
  in the owner checks list.
- No DXV **encoder** exists in FFmpeg, so the box can't make DXV. HAP Alpha (encode + decode in FFmpeg) is the open
  GPU-codec alternative.

### Q3 — "two cameras pointing at the stage at two side angles … overlay of real live stage over the model stage, faking 3d?"

**Possible and medium effort.**
- Both cameras are already calibrated against the previs stage (WO-616: pose + lens). Project each live feed onto the
  3D model (projective texturing from the camera's pose).
- Blend the two by view angle: each surface takes more from the camera that sees it head-on.
- Walking the previs camera then shows the real stage on the model's surfaces:
  - the set, floor and screens look convincing between the two viewpoints;
  - people and anything not in the model smear across the floor and walls, because there is no depth for them.
- Real 3D of performers needs a depth camera or stereo depth: a bigger job.
- Cost: two live textures into Godot (already possible via the WO-607 live-texture path), plus one projector shader.
  Proposal only; tell me if you want it as a WO.

### Q4 — "lower the resolution of the preview channel/s by half … will this improve performance?"

**Barely. The cost is decoding, not mixing.** Box measurement 20.10 (`measure.sh`: Caspar CPU% and GPU average over 10 s,
spare ch7):

| Case | Caspar CPU | GPU avg |
|---|---|---|
| baseline | 243 % | 34 % |
| ch7 decodes the same PGM clip again | 306 % (+63) | 36 % |
| ch7 = `route://1-10` (mix only, no decode) | 245 % (+2) | 34 % |

- A full-res preview mix costs about 2 % CPU. Half-res would save a part of that 2 %.
- The cost is every channel that **decodes** media itself: a PRV look whose clip isn't already on PGM. Half-res
  channels still decode full-size files.
- What would help: a low-res proxy of each clip for preview, or routing PGM layers instead of re-decoding them.
- The geometry part ("calculate at PGM size, show at half") is how the GUI preview already works.
- **Owner, 30.10:** "Not worth the hassle" — no half-res PRV channel and no proxy-clip WO; PRV stays at PGM size.

## What was VERIFIED (20.10, box)

- Follow → Calibrate start → click the floor at screen (2690, 640) → point (0.537, 1.160, 0) stored; Undo → 0 points;
  Done → no sessions left.
- Markers: Add marker (Marker 2, not pinned) → floor click at (2620, 640) → marker at (−0.78, 1.68) m. Server
  `/api/tracking/markers` and the drawn marker agree.
- Marker 1 (replace-pinned, status 0 held) → the bottom hint names the detection pin.
- Test markers deleted; project `previs.tracking.markers` back to `[]`. No DXV test media left in `media/`.
- Smoke `smoke-wo630-calibrate-click` + WO-624 tests 10/10; Godot tests pass.

### Open

- Owner: calibrate a real moving head with floor clicks (Follow → Calibrate). DXV alpha with a real Resolume file.
- F2 (Art-Net read-through, seamless handover) → WO-632. PSN out → WO-631. MVR-Stash import → WO-612.
