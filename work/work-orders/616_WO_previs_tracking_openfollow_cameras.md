**Status: IN PROGRESS (2026-10-19) — T1 surface roles (box-verified) and T2 camera maths (offline, OpenFollow test vectors) done; T3 calibration wizard next. Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Supersedes the *approach* of [WO-19](./19_WO_PERSON_TRACKING.md) (browser TF.js detection) and the Companion-only device path of [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) — both keep their goals; implementation moves here. Related: [WO-614](./614_WO_previs_stage_builder.md) (cameras + calibration points are stage objects), [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) (follow → fixtures).**

# WO-616 — Previs tracking: OpenFollow logic, DeckLink/Caspar camera input, two-camera workflow

Owner (`next.md`, 17.10): "https://github.com/openfollowapp/openfollow — implement open follow logic into
3d previz and enable decklink input/ or casparcg channel to be input for the stage overview camera as well
as create workflow for using 2 cameras for enhanced tracking."

## Investigation

### OpenFollow (github.com/openfollowapp/openfollow, read 2026-10-17 via `gh api`)
- Python + GStreamer, Raspberry Pi 5 / x86 kiosk appliance with a web config UI. 79★, active (pushed 2026-10-17).
- **License AGPL-3.0-or-later; HighAsCG is AGPL-3.0-or-later (`package.json`, `LICENSE`) → compatible.**
  Ported code must keep its copyright/licence headers ("Copyright (C) 2026 The OpenFollow Project – Paul
  Hermann, Michel Honold, Vinzenz Schultz") and say where it came from. The **name and logo are not
  licensed** → our UI calls the feature "Tracking"/"Follow", credits OpenFollow in About + file headers.
- What it does (README + `docs/architecture/*.md`):
  - Video in: RTSP/SRT/RTP, NDI, Pi camera, V4L2 — **no DeckLink**, no Caspar.
  - Live video with a 3D overlay; markers moved by gamepad / mouse (unproject to floor) / keyboard / MIDI /
    3D mouse / OSC `/marker/{id} x y z` / touch remote.
  - Camera model: `scene/solver.py` (setup wizard, reference + corner points, **automatic DLT camera
    solve**), `lens_model.py` / `scene/lens_fit.py` (radial k1/k2 "Lens distortion"), ground grid, edge snap.
  - Detection (optional): YOLO26 via ONNX Runtime (`video/detection.py`, CLAHE, ROI masks, 67 ms
    interval) + pure-NumPy **ByteTrack** with Kalman (`video/tracking.py`); pin modes `replace`
    (auto-pins a marker) / `assist` (refines operator-driven markers within `assist_radius_m`).
  - Zones (`zones/`): world-frame polygons, occupancy state machine (first entry / additional / partial
    exit / final exit), debounce + hysteresis (inward-shrunk exit polygon) → OSC.
  - Paths engine, marker catalog, peer sync between stations (HMAC), **PSN input from other stations**.
  - Outputs: **PSN, OTP (E1.59), OSC, RTTrPM**; freshness rule (`MARKER_STALE_AFTER_S` = 1 s → status 0 /
    filtered) — keep this semantics.
  - Canonical frame: **X = stage left, Y = upstage, Z = up**, PSN-absolute, never offset-adjusted
    (`docs/architecture/outputs.md`) — adopt as the tracking frame; convert once to Godot (Y-up).
  - **No multi-camera fusion**: code search `triangulat` → 0 hits; multiple stations only *share* markers.
    The two-camera workflow below is new work.
- HighAsCG today: [WO-19](./19_WO_PERSON_TRACKING.md) (browser detection, never started),
  [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) (Companion autofollow, never started), `src/tracking/register.js`
  and `src/autofollow/register.js` are stubs.

### Camera input path already exists
- Each DeckLink input owns a **dedicated full-quality Caspar channel** (WO-53, `channelMap.inputChannels`
  kind `decklink`, `src/config/routing-setup-decklink-inputs.js`). Any Caspar channel → shm surface via
  the WO-594 consumer (proven on the box 2026-10-17, WO-594 "Verified") → Godot `Texture2DRD` (WO-596).
- WO-597 runtime roles are `pgm1…4/prv1…4` (indices 741–748); add `in<N>` (DeckLink input N's channel)
  and `ch<N>` (any channel) roles — the "decklink input / or casparcg channel" ask.
- Detection needs CPU-side frames: the shm segment is CPU memory already (Caspar reads frames back), and a
  **Python reader exists** (`tools/hshm-bridge/hshm_abi.py`, `hshm_probe.py`) → a Python sidecar can read
  the same camera surface with zero extra encode.

## Design

```
DeckLink in N ─► Caspar channel (WO-53) ─► shm "inN" (WO-594/597) ─┬─► Godot previs: camera object
                                                                    │     · frustum in 3D stage (solved pose)
                                                                    │     · "Camera view": live video +
                                                                    │       stage/markers/zones overlay (AR)
                                                                    │     · markers: gamepad/mouse/keys
                                                                    └─► tracking sidecar (Python, ported
                                                                          OpenFollow detection + ByteTrack)
                                                                          → detections (per camera, px)
server (Node) tracking hub: cameras {pose, intrinsics, k1,k2}, markers, fusion, zones, outputs
   inputs: Godot (operator markers), sidecar (detections), PSN in (other OpenFollow stations), OSC
   outputs: WS tracking:markers → previs + fixtures follow (WO-615) + Companion vars (WO-31) ;
            PSN out (consoles), OSC ; later OTP/RTTrPM
```

### Calibration (port of OpenFollow's solver, improved by the 3D stage)
- Intrinsics + pose by **DLT** from ≥ 6 3D↔2D correspondences (or homography from ≥ 4 floor points when
  only the floor is known), then radial k1/k2 refinement (port `scene/solver.py`, `lens_model.py`,
  `lens_fit.py`).
- HighAsCG advantage: correspondence points come from the **previs stage itself** — LED wall corners,
  TV corners, downstage edge (WO-614 objects have exact metric geometry). Wizard: pick a point in 3D,
  click it in the camera picture; live reprojection error per point (px) and overall RMS.
- Result stored per camera object (`project.previs.stage` camera: pose, fov, k1, k2, input role).

### Two-camera workflow ("enhanced tracking")
1. **Placement guidance**: cameras ≥ 45–90° apart around the stage (e.g. FOH centre + stage-left wing or
   high side truss); the wizard shows each frustum on the 3D stage and the **coverage overlap** on the floor.
2. **Shared frame**: both calibrated against the same stage points → same world frame by construction.
3. **Association** per tick: each camera's detections → feet point on the floor plane (monocular) +
   head ray; Hungarian assignment across cameras on floor distance (gate 0.75 m).
4. **Fusion**: matched pair → triangulate (midpoint of closest approach of the two head rays → height,
   precise X/Y); unmatched → that camera's floor projection with its depth-dependent uncertainty;
   one Kalman track per person in world space (ByteTrack stays per camera for ID stability, world tracks
   own the stable person ID).
5. **Occlusion handover**: a person hidden in one camera keeps being tracked from the other; marker shows
   its source (`cam1`, `cam2`, `fused`, `predicted`) and goes stale after 1 s with no support (OpenFollow rule).
6. **Verification walk**: operator walks a known path (e.g. the grid/LED-wall line); report per-camera
   reprojection error and fused position error in cm; "accept" stores the calibration.

### Phasing
- **P1 (no AI, high value):** `inN/chN` surface roles; camera object + calibration wizard in Godot;
  camera view with stage overlay; operator markers (gamepad via Godot `Input` joypads — native, no extra
  code); tracking hub on the server; PSN out + OSC out; markers visible in previs.
- **P2:** zones engine port (+ OSC/Companion actions); PSN *in* (use existing OpenFollow Pis as extra
  stations); fixture follow (WO-615 T9).
- **P3:** detection sidecar (port `video/detection.py` + `video/tracking.py`, ONNX Runtime with CUDA EP on
  the RTX — CPU fallback), assist/replace pin modes, ROI masks.
- **P4:** two-camera fusion + verification walk.

## Tasks

- [x] T1 WO-597: surface roles `inN` (DeckLink input channel) and `chN`; lease + config; smoke.
- [x] T2 Port camera math (DLT, homography, k1/k2, project/unproject) to GDScript **and** JS (server hub
      needs project/unproject for fusion) with OpenFollow's test vectors (bundled gallery calibrations
      `video/inputs/assets/*_default.toml` give known camera+grid pairs).
- [ ] T3 (T3a model + solve DONE) Godot: camera stage object, calibration wizard (3D pick ↔ 2D click), reprojection error display.
- [ ] T4 Godot camera view: live surface + overlay (stage edges, grid, markers, zones) using the solved camera.
- [ ] T5 Markers: gamepad/mouse/keyboard input in Godot → server hub; hub state + WS `tracking:markers`.
- [ ] T6 PSN output (spec: posistage.net; 60 Hz, multicast 236.10.10.10:56565, data + info packets) + OSC
      output; freshness/stale semantics; test against a PSN receiver.
- [ ] T7 Zones (port `zones/engine.py` state machine + shrink) → OSC / Companion.
- [ ] T8 PSN input (OpenFollow stations as sources).
- [ ] T9 Detection sidecar from shm (Python, ONNX, ByteTrack), systemd unit, GPU EP; masks.
- [ ] T10 Two-camera fusion + verification walk + coverage view.
- [ ] T11 Follow: markers → WO-615 fixture IK and WO-31 Companion variables.
- [ ] Attribution: header in every ported file + About page credit; `THIRD_PARTY` note.

## Acceptance

- P1: with one DeckLink camera, calibration from previs points reaches RMS < 3 px; a gamepad-driven marker
  appears at the right floor spot in the camera view and in 3D, and a lighting console receives it over PSN.
- P4: a person walking behind an obstacle visible to one camera stays tracked (no ID change), fused
  position error < 20 cm over the verification walk.

## What was done / What was VERIFIED

Desk only (2026-10-17): OpenFollow README + architecture docs (detection, zones, outputs, video, feature
list) and source tree read via `gh api`; licence compatibility checked against our `package.json`/`LICENSE`;
DeckLink input channel layout and shm path confirmed in code (shm proven live in WO-594).

## Addendum (2026-10-17, `next.md` round 2) — how OpenFollow tracks, fixture calibration, camera ↔ 3D overlay

**How OpenFollow tracks** (`openfollow/scene/solver.py`, `docs/architecture/{detection,input,hud,outputs}.md`):
1. *Frame:* PSN-absolute metres, X stage-left, Y upstage, Z up.
2. *Camera calibration:* a floor rectangle of known size (the "grid") — the operator drags its 4 corners onto
   the picture; `solver.py` computes the 3×3 homography by DLT and decomposes it into pos x/y/z, pitch, yaw,
   roll, fov. Optional extra calibration points refine the fit; radial lens k1/k2 from the Lens step.
3. *What is tracked = markers.* An operator drives each marker (gamepad / mouse / keys / MIDI / OSC
   `/marker/{id} x y z`); a mouse click is un-projected onto the floor plane (grid z offset).
4. *Optional AI:* YOLO26 ONNX person detection (~15 Hz) → ByteTrack (Kalman); the feet point of a box is
   un-projected to the floor. `assist` snaps operator markers to a nearby detection, `replace` auto-pins.
5. *Out:* PSN / OTP / OSC / RTTrPM at 60 Hz; a marker not refreshed for 1 s goes stale on every protocol.

**Does it calibrate fixtures?** **No.** The tree has no fixture, pan/tilt or DMX code (searched 2026-10-17);
"followspot" means a console (grandMA3, Eos, Hog…) receiving PSN and aiming its own fixtures with its own
fixture calibration. For HighAsCG (we have fixtures in WO-615) this is new work — and the camera makes it
easy: **camera-assisted fixture calibration** — point the fixture (narrow beam) at 4+ spots, the solved
camera finds each beam spot on the floor (brightest blob in a frame diff, un-projected), giving
(pan, tilt) ↔ world-point pairs; least-squares solve of the fixture's base position + orientation
(+ pan/tilt offsets) against its GDTF axis chain. Manual fallback: click the spot in the camera view.

**Matching the camera view with the 3D view — yes, directly.** The solve gives exactly a pinhole camera
(pose + fov) + k1/k2: set the previs `Camera3D` to it, show the live camera surface (DeckLink input
`inN`, WO-597 role) as the background and the 3D stage on top (wireframe/ghosted LED walls, grid, markers,
zones, fixture beams); k1/k2 applied as a distortion pass so straight 3D edges bend like the lens.
OpenFollow's HUD does the same with Cairo. Uses: (a) verification — LED-wall edges must sit on the real
walls; (b) manual calibration — drag 3D points onto the video; (c) operator view with previs overlay.

### Added tasks
- [ ] T12 "Camera view" overlay mode in previs: background = camera surface, `Camera3D` = solved camera,
      ghosted stage + markers/zones, lens-distortion shader; opacity slider.
- [ ] T13 Camera-assisted fixture calibration (WO-615 fixtures): spot detection + pose solve; manual click fallback.

## T1 — surface roles `inN` / `chN` (2026-10-19) — DONE

### Investigation
- `src/system/video-surfaces.js` knew only `pgm1…4/prv1…4` (`ROLE_SLOTS`, indices 741–748, 749 reserved); every
  other role name was dropped by `lease()`'s filter before AMCP. The Godot side mirrored that as a fixed
  `RUNTIME_ROLES` list (`godot/client/video/video_surfaces.gd:13`), so a camera role would never be leased.
- DeckLink input N's own channel is `channelMap.inputChannels[] {kind:'decklink', slot:N, channel}`
  (`src/config/routing-map.js:302`). Look up by `slot`, not by array position: live-audio / v4l2 / host
  entries share the array.
- `chN` must only name channels Caspar actually runs. The manager's map is the config-only `getChannelMap(cfg)`,
  which has no channel list; `channelResolutionsByChannel` is only added by `buildChannelMap(ctx)`
  (`src/config/channel-map-from-ctx.js:62`) from Caspar's INFO CONFIG. The first box probe returned
  `ch1 → channel: null` for exactly this reason. `buildChannelMap` was not used whole: its `previewChannels`
  follow the switcher's active bus, which would change what `prvN` means today.
- The box has no DeckLink inputs (`decklinkCount: 0`), so `inN` can only be proven offline here; `chN` is live-testable.

### What was done
- `src/system/video-surfaces.js`: `roleIndex(role)` replaces the `ROLE_SLOTS` lookups.
  - `pgm/prv` → 741–748 (unchanged); `in1…in16` → 750+N; `ch1…ch99` → 800+N.
  - `resolveRoleChannel`: `inN` → the DeckLink entry with slot N; `chN` → N only if Caspar's INFO lists it.
  - `list()`: pgm/prv as before, plus `inN` for every configured DeckLink input, plus `chN` only while leased
    (99 idle rows would be noise).
  - The singleton's map is `getChannelMap(cfg)` plus `channelResolutionsByChannel` from `ctx.gatheredInfo.infoConfig`.
- `godot/client/video/surface_holders.gd`: `is_runtime_role()` (the same grammar as `roleIndex`, kept in the pure
  file so the test runner can load it); `video_surfaces.gd` leases by it; the fixed list is gone.
- Tests: `smoke-wo597-video-surfaces.test.js` gains a WO-616 case (slot lookup, unknown channel, index grammar,
  ADD/REMOVE lines, list membership); `test_video_surfaces.gd` gains `test_runtime_roles`.

### What was VERIFIED
- Offline: smoke 9/9; Godot `--check` OK, `--test` 927 passed; offline suite 2676 tests, 2673 pass, 1 fail (the known
  local-only `smoke-wo577-shader-controls`, which reads the gitignored `data/shaders`); 0 files over 500 lines.
- Box, after a node restart: `POST /api/video-surfaces/lease {roles:["ch1","in1"]}` → journal
  `ADD 1-801 SHM NAME ch1`, descriptor `{role:"ch1", channel:1, index:801, active:true}`; `in1` was not listed (no
  DeckLink input). `hshm_probe.py --path /dev/shm/highascg-ch1 --duration 2` → 1920×1080 @ 50.49 fps, 101 frames,
  0 gaps, 0 torn, latency p50 2.05 ms. With no renewal, the journal shows `REMOVE 1-801 (ch1: no leases)` after the TTL.
- Not proven on this box: `inN` against a real DeckLink input (needs a box with capture hardware).

## T2 — camera maths port (2026-10-19) — DONE (offline)

### Investigation
- Source read at OpenFollow `2f8aa257` (`gh api …/contents`):
  - `scene/solver.py` (948 lines) holds all the maths:
    - `project_points` / `unproject_to_plane` (pinhole; the stored fov is horizontal; R = Ry(-yaw)·Rx(pitch)·Rz(roll)
      in a Y-up frame);
    - `apply/invert_overlay_distortion` (radial k1/k2 about the centre, r normalised to the half-diagonal, bracketed
      Newton inverse);
    - `compute_homography` (normalised DLT, exactly 4 points, SVD null vector);
    - `decompose_homography` (square pixels, principal point at the centre → focal length by least squares on the
      two rotation-column constraints, then pose; gimbal case pins yaw);
    - `solve_camera_dlt` (refuses a solve that misses its own input by > 20 px, which also kills the homography's
      mirror branch).
  - `lens_model.py`: the fold rule (`1 + 3k1·s + 5k2·s² > 0` on s ∈ [0,1]) and pull-back.
  - `lens_fit.py` (k1/k2 fitting from extra points) is **not** ported yet; it belongs to the wizard's lens step (T3).
- Their Y-up intermediate frame is exactly Godot's: PSN (x, y, z) → (x, z, -y). HighAsCG stage objects face +Z
  (the audience; `stage_objects.gd:5`), so PSN "upstage" (+Y) is Godot -Z and PSN "stage left" (+X) is Godot +X
  (the audience's right). The solved camera is therefore a `Camera3D` transform as is, with `fov` = the vertical fov.
- Precision: Godot `Vector3`/`Basis` are float32 (≈ 1.2e-4 px ulp at x ≈ 1500); the golden pixels are pinned at
  1e-4, so the port works on plain float64 scalars and Arrays.
- No SVD in GDScript: with h33 = 1, the 4-point DLT is the 8×8 linear solve. For ≥ 4 points the same system is
  solved as least squares (normal equations of the Hartley-normalised points). h33 ≠ 0 whenever the camera sees
  the plane origin in front of it. The SVD "closest rotation" step is a no-op after Gram–Schmidt with r1 = r2 × r0
  (det = +1 by construction), so it was dropped.

### What was done
- `godot/client/features/previs/tracking/camera_model.gd` (pure, static):
  - camera dict (OpenFollow's `CameraConfig` keys);
  - `project` / `unproject` (null for misses);
  - `reprojection` (per-point px + RMS: the wizard display and the P1 acceptance figure);
  - lens fold / validity / pull-back, `apply/invert_distortion`;
  - `solve_floor` (≥ 4 coplanar points, 20 px gate);
  - `psn_to_godot` / `godot_transform` for the previs `Camera3D`.
- `godot/client/features/previs/tracking/homography.gd`: normalised DLT (≥ 4 points), the decomposition, and a
  small Gaussian elimination.
- `src/tracking/camera-model.js`: project / unproject / lens / `pixelToFloor` for the server hub (detections →
  floor, fusion). The calibration solve stays in Godot, where the wizard is.
- Attribution:
  - an OpenFollow header (copyright, licence, commit, source files, list of changes) in every ported file;
  - a new repo-root `THIRD_PARTY_NOTICES` (ported files, commit, copyright, name/logo note).
    `licenses/` is a tracked symlink to the generated `/usr/share/doc/highascg/licenses`, so nothing hand-written
    belongs there. `tools/release/collect-third-party-licenses.sh` copies the notice to
    `third-party/highascg-THIRD_PARTY_NOTICES.txt` and lists an `openfollow` component in the manifest / INDEX.
  - About-page credit: still open (the About page is WO-608).
- Tests:
  - `godot/client/tests/test_tracking_camera.gd`, 67 assertions on OpenFollow's own vectors:
    - golden pixels for the head-on camera at roll 0 / -12 / 25;
    - hfov ↔ vfov;
    - roundtrip, plus the optical-axis reach and bearing;
    - the six-pose recovery set (FOH, upstage, both box booms, oblique canted);
    - 8 noisy points;
    - degenerate / plumb-overhead / mirror-branch refusals;
    - the lens valid / fold tables, inverse roundtrip under five strong lenses, the Newton-creep case, the fold-ring
      corner;
    - the `Camera3D` transform sees the same pixel.
  - `tools/smoke/smoke-wo616-tracking-camera-model.test.js` (curated CI list): the same golden pixels and lens
    cases for the JS port.

### What was VERIFIED
- Godot `--check` OK; `--test` 994 passed, 0 failed. Mutation check: flipping one sign in `rotation()` →
  13 failures, so the vectors bind the maths. JS smoke 2/2.
- Offline suite 2678 tests, 2675 pass, 1 fail (the known local-only `smoke-wo577-shader-controls`); 0 files over
  500 lines.
- The collector's manifest block, run against a temp `licenses/` holding only the copied notice, emits the
  `openfollow` component. The full collector was not run (it rewrites the system licence tree from dpkg state).
- Nothing to prove on the box yet: no camera object consumes this until T3/T4.

## T3a — tracking data model + calibration solve (2026-10-19) — DONE (offline; UI is T3b)

### Investigation
- OpenFollow calibrates from exactly 4 floor-grid corners (`scene/solver.py` homography → pose), with the lens
  fitted separately by a plumb-line tool (`lens_fit.py`). On a real stage the operator often can't see all four
  floor corners, but can see LED-wall and screen edges, and those sit at other heights. A 4-point homography can't
  use them.
- On OpenFollow's own concert render (k1 −0.2, k2 0.03), clicking the 28 grid crossings and solving with no lens
  leaves 6.26 px RMS (12.6 px max), which already fails the 3 px acceptance target. So the solve has to fit the
  lens from the same clicks.
- `stage_objects.gd` keeps objects in the Godot frame with Node3D Euler order YXZ. LED walls bend (`column_edges`),
  so their picture corners are the end column edges, not ±size/2.

### What was done
- `godot/client/features/previs/tracking/tracking_model.gd` (pure). `project.previs.tracking` =
  `{version, grid, cameras[]}`:
  - Grid: OpenFollow's `[grid]` keys.
  - Camera entry: `{id, name, role, raster, cam, points[{id,label,world,screen|null}], rms}`.
  - `normalize*` clamps every field and pulls a folding lens back to valid.
  - `candidate_points` lists the grid corners (DSR/DSL/USL/USR), every grid crossing, and each visible stage
    object's picture corners. `object_corners` converts those to PSN.
- `godot/client/features/previs/tracking/camera_refine.gd` (HighAsCG code). `calibrate` works from any ≥ 4 clicked
  points:
  - Seeding: from the largest same-height group via `solve_floor` (lens undone with the current k1/k2), falling back
    to a raw homography decompose when the 20 px gate refuses noisy clicks. With no 4 coplanar points, it starts
    from the camera as it stands.
  - Then Levenberg–Marquardt over pos/pitch/yaw/roll/fov, plus k1 (and k2 with ≥ 8 points) when `fit_lens` is set.
    The Jacobian is numeric (central differences); fov is clamped and the lens is kept unfolded.
  - Returns `{ok, cam, rms, errors[], method}`.
  - Why: one solver covers both the classic grid workflow and "click whatever you can see", and it fits the lens
    without a separate plumb-line pass.
- `godot/client/tests/test_tracking_calibrate.gd`.

### What was VERIFIED
- Godot `--check` OK; `--test` 1025 passed, 0 failed (5 new tests; the rest are other suites' growth since T2). No
  JS touched, so the offline suite wasn't rerun; 0 files over 500 lines.
- Concert camera, starting from the default front-of-house camera (the wrong end of the stage), 28 exact
  crossings with `fit_lens` → pos (0, 13, 12), pitch −48, yaw ±180, fov 70, k1 −0.2000, k2 0.0300, RMS 2e-13 px,
  7 ms. Without the lens fit: RMS 6.26 px (asserted > 3).
- 12 mixed-height points (a curved LED wall, a TV yawed 30°, grid corners) with ±0.7 px click noise → RMS < 1.2 px,
  position within 25 cm.
- No same-height group (wall + yawed projection screen) → `method: refine` converges from a rough start; 3 points
  are refused.
- Yawed-object corner orientation checked numerically. A 65″ TV at yaw 90° faces stage left, its 1.439 m width runs
  along PSN Y, and the viewer-left corner is downstage. The first test expectation had this backwards; the code was
  right.
