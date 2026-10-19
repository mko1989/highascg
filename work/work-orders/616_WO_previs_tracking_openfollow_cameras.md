**Status: IN PROGRESS (2026-10-19) — T1 surface roles (box-verified), T2 camera maths (offline), T3 calibration (box-verified, RMS 0.71 px) done; T5 markers done (hub + Godot driver, box-verified; gamepad = owner QA); T11 follow → Art-Net done (generic moving-head profile, loopback-verified; real fixture = owner QA); T7 trigger zones done (server engine + Godot Zones mode, box-verified; actions = look take / Companion press); T4 + T12 camera view with lens-correct 3D stage ghost done (box-verified); T9a detection sidecar + server service done (box-verified, CPU yolo26n ~17 ms); T9b pinning (replace / assist) + Godot Detect mode done (box-verified through the GUI); T9c ROI mask editor done (box-verified through the GUI); T10a fusion engine done (offline, synthetic two-camera stage); T10b fusion wiring done (pin on world persons, WS `world` block, Godot P-tags + unseen rings; box-verified with a twin camera); T10c coverage view done (3D frustums + floor coverage + placement verdict, box-verified in the GUI); T10d verification walk done (server measure + Inspector walk + `verified` stamp, box-verified through the GUI; a real walk with two cameras = owner QA) — T10 complete; next: T8 PSN input, attribution. T6 PSN/OSC out DROPPED by the owner (Art-Net instead, via WO-615). Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Supersedes the *approach* of [WO-19](./19_WO_PERSON_TRACKING.md) (browser TF.js detection) and the Companion-only device path of [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) — both keep their goals; implementation moves here. Related: [WO-614](./614_WO_previs_stage_builder.md) (cameras + calibration points are stage objects), [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) (follow → fixtures).**

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
- [x] T3 (T3a model + solve, T3b Camera mode + Inspector page) Godot: camera stage object, calibration wizard (3D pick ↔ 2D click), reprojection error display.
- [x] T4 Godot camera view: live surface + overlay (stage edges, grid, markers, zones) using the solved camera. (Delivered by T3b/T5b/T7; closed with T12.)
- [x] T5 Markers: gamepad/mouse/keyboard input in Godot → server hub; hub state + WS `tracking:markers`. (T5a hub ✔, T5b driver ✔)
- [ ] ~~T6 PSN output + OSC output~~ — **DROPPED (owner, 2026-10-19: "No need for the PSN osc output. We will
      relay it directly to artnet")**. Markers leave the box as Art-Net through the WO-615 fixture engine
      (server-side, `src/sampling/dmx-output.js` senders): marker → follow IK (WO-615 T9 / T11 here) → DMX.
      The 1 s freshness rule stays in the hub, so follow can hold or release a fixture on a stale marker.
- [x] T7 Zones (port `zones/engine.py` state machine + shrink) → ~~OSC~~ look take / Companion press (no outbound OSC on this box).
- [ ] T8 PSN input (OpenFollow stations as sources).
- [x] T9 Detection sidecar from shm (Python, ONNX, ByteTrack), ~~systemd unit~~ server-owned child, GPU EP; masks.
      T9a sidecar + server service + WS ✔ (box-verified). T9b pin modes replace / assist → hub, Godot boxes +
      Inspector detection controls ✔ (box-verified). T9c mask editor in the camera view ✔ (box-verified).
- [x] T10 Two-camera fusion + verification walk + coverage view.
      T10a fusion engine (server, pure) ✔ (offline). T10b pin + WS + Godot world persons ✔ (box, twin camera). T10c coverage view ✔ (box GUI).
      T10d verification walk ✔ (box GUI; real two-camera walk = owner QA).
- [x] T11 Follow: markers → fixture IK → Art-Net (generic profile; WO-615 T3/T4/T9 slice). WO-31 Companion variables not done (owner route = Art-Net).
- [ ] Attribution: header in every ported file + About page credit; `THIRD_PARTY` note.

## Acceptance

- P1: with one DeckLink camera, calibration from previs points reaches RMS < 3 px; a gamepad-driven marker
  appears at the right floor spot in the camera view and in 3D, and reaches the server hub
  (`tracking:markers`) for WO-615 follow → Art-Net. (Was "a console receives it over PSN" — PSN dropped
  by the owner 2026-10-19.)
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
- [x] T12 "Camera view" overlay mode in previs: background = camera surface, `Camera3D` = solved camera,
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

## T3b — Camera view mode + Inspector calibration page (2026-10-19) — DONE (box-verified)

### Investigation
- The previs tab (`previs_tab.gd`) already switches modes 2D front / 2D plan / 3D over a shared `stack`, and holds
  surfaces only while something visible needs them (WO-617). A 4th mode can follow the same pattern.
- R2 says per-selection settings go on the one Inspector (`InspectorPanel.current.present/release`, see
  `look_editor.gd:305` and `timeline_tab.gd:127`). The previs tab still has its own right column (stage objects,
  models). That is a pre-existing R2 violation and is left as is; the tracking UI does NOT add to it.
- Clicks have to be stored in camera raster pixels, not view pixels, so they survive zoom, pan and window size.
  The raster has to match the real surface size.

### What was done
- `features/previs/tracking/tracking_overlay.gd` (pure). What the view draws, in the camera's lens pixels:
  - grid lines and stage-object outlines, each edge cut into 24 pieces so the lens bends it like the real picture,
    and split where the edge goes behind the camera;
  - every candidate point with `shown` / `click` / `err`;
  - `nearest` for ctrl+click picking (ties go to the earlier point, so a grid corner beats the crossing at the same
    spot).
- `features/previs/tracking/tracking_view.gd`, the Camera mode view:
  - It draws the camera's surface, letterboxed to the raster, and holds it only while shown. Over it go the green
    grid, amber object outlines with names, dots where the camera shows each point, a blue ring for each click, and
    a red line from click to dot (the error).
  - A click sets the active point. Ctrl+click picks a point; the wheel zooms about the cursor (×40); right-drag
    pans; F fits.
  - It emits `source_size` when the surface's real size differs from the raster.
- `features/previs/tracking/tracking_page.gd`, the Inspector page, owns `project.previs.tracking`:
  - camera picker with Add / Delete (with a confirm), name, Source role (inN / chN / pgm / prv), raster;
  - the pose and lens as editable fields;
  - the point list (● clicked / ○ not, with each point's error in px), Clear click / Clear all;
  - Fit lens + Solve, showing RMS, worst error and method;
  - the floor grid fields.
  - A click auto-advances to the next unclicked visible point, so a grid can be clicked through without touching
    the list.
  - The raster follows the surface size while nothing is clicked; after that it shows a warning instead.
  - Persists like `stage_panel` (`_canon` echo guard, `ProjectSync.mark_dirty`).
- `features/previs/previs_tab.gd`: the "Camera" mode button. `_apply_mode` shows the view, `set_on` holds the
  surface, and the page is presented on the Inspector (released in every other mode or when the tab is hidden).
  Stage-object edits reach the page.
- `godot/client/tests/test_tracking_overlay.gd`.

### What was VERIFIED
- Godot `--check` OK; `--test` 1040 passed, 0 failed. 0 files over 500 lines. No JS touched.
- On the box (GUI on DP-3, `--tab=1 --previs-mode=camera`), with OpenFollow's `concert_default.jpg` (1920×1080)
  PLAYed on ch1 layer 90:
  - Add → "Camera 1" on `pgm1` (the first mapped role, no DeckLink here) showed the picture and the default
    overlay.
  - Source → `ch1`: `/api/video-surfaces` showed `ch1` channel 1 active and `pgm1` inactive, so the old role's
    lease was released.
  - Grid set to 12 × 6 m at 2 m spacing in the Inspector.
  - Client restart: the camera, role and grid reloaded from the project.
  - Ctrl+click picked "Grid corner DSR". Four corner clicks (auto-advancing DSR → DSL → USL → USR → X0/Y0) were
    made at the truth-camera pixels; the screen clicks quantise to about ±1.1 raster px at 0.451 view scale, and
    they land on the picture's corner brackets. Solve → floor+refine: Y 14.57, Z 13.76, pitch −48.1, yaw 180,
    fov 65.3.
  - All 28 crossings clicked through (auto-advance), 32 points:
    - Solve without the lens: RMS 6.48 px, worst 9.91 px.
    - Solve with Fit lens: **RMS 0.71 px, worst 1.52 px**, pos (−0.003, 13.09, 12.10), pitch −47.99, yaw 179.99,
      roll −0.01, fov 69.53, k1 −0.1967, k2 0.0319. Truth: (0, 13, 12), −48, 180, 0, 70, −0.2, 0.03. The P1
      calibration target (RMS < 3 px) is met; what is left is click quantisation.
  - `GET /api/project` returns `previs.tracking` with the same solved camera, `rms` 0.7103, 32 clicked points.
  - Screenshots: the overlay sits on the clicked marks after the lens solve; before the solve the error lines are
    visible.
- Test layer cleared afterwards (`CLEAR 1-90`). The "Camera 1" tracking entry stays in the live project as dev data.
- Owner QA: calibrate a real camera (DeckLink `inN` once a capture card is fitted), and check the click precision
  with wheel zoom.

## T5a — server marker hub (2026-10-19) — DONE (box-verified)

### Investigation
- The `tracking` module was a WO-19 skeleton: `src/tracking/register.js` (HEAD) only stubbed `GET /api/tracking/stats`
  (`status: 'skeleton'`). Its `webBundles` entry pointed at `web/assets/modules/tracking/…`, which does not exist,
  so a web client would have imported a 404 once the module was on. No smoke test references the stub.
- Modules had no inbound WS path. `src/server/ws-server.js` handled core message types and then the catalog
  handlers. `src/module-registry.js` only knew `wsNamespaces` as *outbound* prefixes (`getWebManifest`). A Godot
  client could therefore not send a marker over the socket it already holds.
- OpenFollow's freshness rule (`openfollow/psn/marker.py`): `MARKER_STALE_AFTER_S = 1.0`, a never-written marker is
  stale, and a stale marker is still reported but flagged. This is the contract the WO-615 follow needs: hold on
  stale, never jump.
- Owner, mid-T5: "No need for the PSN osc output. We will relay it directly to artnet". The hub's consumers are the
  previs on every client and the WO-615 DMX engine (`src/sampling/dmx-output.js` Art-Net/sACN). There are no
  network protocols out of the hub.

### What was done
- `src/tracking/marker-hub.js` (new, pure, injectable clock): `MarkerHub.set / remove / view / list / staleKey`.
  - Positions are in the PSN frame (m; X stage left, Y upstage, Z up).
  - Ids are integers 1..65535 (16-bit, like PSN / follow ids). x/y/z must be finite and within 500 m of the origin.
    A refused write leaves no trace.
  - Speed comes from the last two writes when they are ≤ 1 s apart (0 across a stale gap).
  - Name and source carry over from the previous write.
  - `rev` bumps on every accepted change.
  - The header carries the AGPL OpenFollow credit and lists the changes.
- `src/tracking/register.js` (rewritten):
  - One hub per process, exposed as `ctx.trackingHub` (withdrawn on shutdown).
  - A 33 ms tick broadcasts `tracking:markers {markers, stale_after_ms}` when `rev` moves, when the stale set
    changes, or as a 1 Hz heartbeat while the hub is non-empty. An empty, idle hub sends nothing.
  - HTTP: `GET/POST /api/tracking/markers` (one marker or `{markers:[…]}`), `DELETE /api/tracking/markers/<id>`,
    and `GET /api/tracking/stats` (now real counts).
  - WS intake: `tracking:marker` (source `operator`). Refused entries go back to the sender only, as
    `tracking:error`.
  - The phantom `webBundles` entry was removed.
- `src/module-registry.js`: new `handleWs(ws, ctx, msg)`. It routes an inbound message to the loaded module whose
  `wsNamespaces` prefix matches `msg.type` and calls `m.handleWs(msg, {ws, ctx})`. If the handler throws, the error
  is logged and the message counts as taken, so it never falls through to core handlers.
- `src/server/ws-server.js`: calls `moduleRegistry.handleWs` right after the catalog dispatch, before core's
  remaining `else if` chain. A module only sees types in its own namespace.
- Why WS intake and not HTTP only: the Godot driver (T5b) streams at ≤ 30 Hz on the socket it already has.
  Per-sample HTTP would add connection churn on the box serving playout.

### What was VERIFIED
- New smoke `tools/smoke/smoke-wo616-tracking-marker-hub.test.js` (2 tests, in the curated FILES list):
  - live just under 1 s, stale at exactly 1 s, still listed;
  - 2 m/s from 1 m in 0.5 s; no speed across a stale gap;
  - six invalid writes refused, no trace left;
  - registry WS routing (a `tracking:` type is taken, `amcp` is not);
  - `tracking:error` reply goes to the sender;
  - HTTP GET/POST/DELETE, including 400 on bad JSON and 404 on a second delete;
  - immediate broadcast on write;
  - `ctx.trackingHub` set on boot and withdrawn on shutdown.
- Offline suite: 2680 tests, 2677 pass, 2 skipped, 1 fail = the known local `smoke-wo577-shader-controls`
  (corrected in T5b; first written as "2679 pass"). 0 files over 500 lines.
- On the box:
  - Server restarted. `POST /api/plugins/tracking/enable` → `{"ok":true,"requiresRestart":false}`. Journal:
    `[modules] loaded "tracking"`, `[tracking] marker hub up (WO-616) — tracking:markers`.
  - A WS probe ran two real clients on `ws://127.0.0.1:4200/api/ws`. The sender wrote id 42 (1, 3), 250 ms later
    (1.5, 3), then an invalid id 0. The watcher saw:
    - `32ms 42:Probe:1,3:live`
    - `263ms …1.5,3:live:vx2.1645` (0.5 m over the real ~231 ms gap)
    - `1255ms …STALE` (1 s after the last write)
    - `2277ms …STALE` (heartbeat)
  - Only the sender got `tracking:error {id:0, "id must be an integer 1..65535"}`.
  - `GET /api/tracking/markers` showed the stale marker with `source: operator`. `DELETE …/42` → `{"ok":true}`.
    Stats: `markers 0, writes 2`.
- The Tracking plugin is left enabled on the box; the change is persisted in `config/` (live state, not committed).
- Not yet: the Godot driver and the markers drawn in previs (T5b), and the WO-615 follow consumer (T11).

## T5b — operator markers in Godot: driver, camera view, Inspector (2026-10-19) — DONE (box-verified; gamepad = owner QA)

### Investigation
- OpenFollow input, read from the source:
  - `input/shaping.py`: deadzone rescale + linear / logarithmic / quadratic / s-law curves. The gamepad default
    deadzone is 0.15.
  - `input/control_frame.py`: the "camera" frame. Directions latch while the input is non-zero, and the output keeps
    the input's magnitude.
  - `docs/architecture/input.md`:
    - speed steps 0.1 m/s (0.5 above 4), clamped 0.1–3.0;
    - LB/RB = speed, D-pad ◀▶ = marker;
    - mouse grab on the ground circle glides with alpha = 1 − smoothing (floored); a grab never yanks the marker to
      the click.
- `Ws.on()` keeps handlers forever and calls them without a validity check (`core/ws.gd` `_dispatch`). A freed
  previs would leave a dead callable, so the driver uses the `Ws.message` signal, which disconnects on free.
- First box run: held arrows did nothing.
  - A probe showed the GUI focus walking View → Button → OptionButton. Godot's `ui_right` focus navigation
    consumed the arrows, so the driver's "view has focus" check failed.
  - Fix: the view accepts arrow keys in Markers mode.
- Second box run: after a client restart on another tab, markers stayed stale.
  - Probe: `defs=0`. A stage change calls `track_page.set_objects` → `changed`, and previs_tab pushed the
    *unadopted* page's empty default list into the driver. The page only reads the project after the Inspector
    adopts it.
  - Fix: the driver reads `project.previs.tracking.markers` itself (`Store.project_changed`). The page feeds it
    only while in the tree.
- Idle cost: four writes a second per client would broadcast four times a second. The hub now bumps `rev` only on
  a real change (`src/tracking/marker-hub.js` `PUBLIC` fields), so a heartbeat refreshes freshness silently.

### What was done
- `features/previs/tracking/marker_input.gd` (new, pure, AGPL credit + change list):
  - `apply_curve` / `shape_axis` ported from OpenFollow.
  - `ground_axes(cam)`: the camera's right axis from this repo's `camera_model.rotation`, flattened onto the floor;
    forward = right turned 90° left; stage axes when degenerate.
  - `orient`, which keeps the input magnitude.
  - `step_speed`, `glide`.
  - `floor_point`: `invert_distortion` then `unproject` at the marker's z.
  - `ground_ring` and `grab_target` (inside the ring, else a centre radius; nearest centre wins).
- `tracking_model.gd`:
  - `markers: [{id 1..65535, name, color}]` in `normalize`; ids are unique, a bad colour falls back to the palette.
  - `new_marker` takes the lowest free id.
  - Positions are not stored in the project: the hub is their single owner.
- `features/previs/tracking/marker_driver.gd` (new Node under previs_tab):
  - Gamepad: left stick and arrows (Markers mode, view focused), camera-relative and latched; LB/RB speed; D-pad
    marker.
  - Mouse grab and drag, gliding at smoothing 0.6.
  - Sends WS `tracking:marker` at ≤ 30 Hz while moving.
  - Every 250 ms it re-sends parked markers. It skips one that another client changed within 400 ms, so two
    clients never fight over a marker being driven.
  - Our own echoes are ignored for 400 ms after we move a marker.
  - `GET /api/tracking/markers` on start and on WS reconnect. A defined marker missing on the server starts at the
    grid centre on the floor.
  - Delete → `DELETE /api/tracking/markers/<id>`.
- `tracking_view.gd`:
  - Markers are drawn as ground circle + 1.7 m body line + name; stale ones are dimmed and marked "· stale"; the
    selected one is drawn bolder.
  - In Markers mode, press / drag / release go to the driver, calibration clicks are off and the calibration dots
    are hidden.
  - The view takes focus on click, so the arrows are its own.
- `features/previs/tracking/markers_section.gd` (new; keeps tracking_page under 500 lines):
  - Marker list with live / stale state, Add / Delete (with confirm) / Home, name, speed (m/s), stick curve.
- `tracking_page.gd`: a Calibrate | Markers switch. Markers mode swaps the calibration fields for the section;
  the camera picker stays, because it is the control frame.
- `previs_tab.gd`:
  - Creates and wires the driver.
  - Arrows go to the driver instead of the stage nudge while driving.
  - Driving is on only in Camera mode + Markers + previs shown; leaving it releases any grab.

### What was VERIFIED
- Godot `--check` OK; `--test` 1080 passed, 0 failed (+40 assertions in `tests/test_tracking_markers.gd`):
  - OpenFollow shaping values;
  - camera axes for FOH / upstage / yaw 90;
  - "stick right = right in the picture" through a projected camera;
  - speed clamps and the glide floor;
  - floor_point round trips through a k1 −0.2 / k2 0.03 lens to < 0.1 mm;
  - ring and grab;
  - marker definition normalising.
- Hub smoke extended: an identical heartbeat does not bump `rev`, and a heartbeat revives a stale marker. Offline
  suite 2680 / 2677 pass / 2 skipped / 1 known `wo577` fail. 0 files over 500 lines.
- On the box (server restarted for the hub change; GUI on DP-3, Camera mode, calibrated Camera 1 on `ch1` with the
  concert picture):
  - Add marker ×2 → the hub showed ids 1 and 2 at the grid centre (0, 3), live, `source: operator`. The project
    holds the two definitions.
  - Drag: the ring was dragged to the grid crossing the solved camera shows at (−4, 4). Hub: **(−3.99, 3.98)**.
  - Arrows (this camera looks downstage):
    - Right held about 1.02 s → x −3.99 → −5.01 with `vx −1` m/s while moving and 0 after. Camera-right = −X.
    - Up held 0.5 s → y 3.98 → 3.46. Camera-forward = −Y.
  - Client killed → both markers `stale: true` at 1.4 s.
  - Client relaunched on the **Live** tab → both live again within the first heartbeats, at the same positions.
  - Idle: a WS watcher saw 5 `tracking:markers` in 5 s (the hub's 1 Hz) while the client wrote at 4 Hz (stats
    `writes` rising); no stale entries.
  - Delete (confirm) → the hub lists only id 1; the project's `markers` holds only Marker 1.
  - Screenshots: the markers stand on the stage floor of the live picture, and the calibration dots are hidden in
    Markers mode.
- Not verified: no gamepad is attached to this box. The stick, LB/RB and D-pad paths are the same code as the
  arrows plus `Input.get_joy_axis` → owner QA with a controller. Test layer cleared (`CLEAR 1-90`); Marker 1 stays
  in the dev project.
- Next: T11, follow → WO-615 DMX engine (`ctx.trackingHub` → pan/tilt → Art-Net); T7 zones.

## T11 — follow: markers → moving-head pan / tilt → Art-Net (2026-10-19) — DONE (box-verified on loopback; real fixture = owner QA)

Scope: a vertical slice of WO-615 T3 (patch), T4 (engine + Art-Net) and T9 (follow IK). It uses a **manual
generic moving-head profile** (pan / tilt channels, 8- or 16-bit, ranges, inverts) instead of GDTF; WO-615 T1/T2
replace the profile later. Art-Net only; sACN waits for WO-615 T4. WO-31 Companion variables were not done
(the owner's route is Art-Net).

### Investigation
- **dmxnet 0.9.0 is the wrong sender for this** (`node_modules/dmxnet/lib.js`):
  - Its constructor binds a UDP listener on **:6454** (reuseAddr) and throws on a socket error. That port is
    already the box's lighting input (`src/artnet/lighting-input-receiver.js`).
  - `setChannel` transmits one packet per call. `src/sampling/dmx-output.js` `send()` calls it per channel, so a
    16-bit pan/tilt frame would be 4+ packets.
  - It clamps the universe to 0–15.
  - The follow engine needs one full-universe ArtDmx per frame to a 15-bit port-address, so a ~40-line encoder
    over a send-only ephemeral socket is simpler and safer.
- **Self-loop hazard.** The box listens for Art-Net on :6454 at port-address `net/subnet/universe` (default 0/0/0
  — `resolveArtnetPatch`, `src/artnet/artnet-slot-config.js:68`); that input drives the global border. A follow
  fixture on universe 0 broadcast to 255.255.255.255 would feed our own pan/tilt bytes into that input.
  Confirmed on the box: the first fixture added with the defaults was refused for exactly this.
- **Project → server engine.** Every project write path calls `scheduleProjectSyncBroadcast(ctx, project)`
  (`src/api/routes-data-project-sync.js`):
  - autosave (`routes-data-project-handlers.js:470`, on a changed save only);
  - save, activate, replication, media links, mixer inspector, global border.
  
  That makes it the one place to tell a server consumer about the stamped project. Before this, nothing
  server-side could observe a project change without re-reading the disk.
- **Slice ownership.** The web client rebuilds its save payload from a fixed key list, so a Godot-only top-level
  key is erased by the next web autosave unless it is in `CLIENT_OWNED_SLICES`
  (`src/engine/project-client-slices.js`, WO-614). WO-615 planned `project.fixtures.patch[]`, so the slice is
  `project.fixtures`.
- **Moving-head IK.** Every target has two solutions per turn: (pan₀ + 360k, t) and (pan₀ + 180 + 360k, −t).
  With a 540° pan, picking the wrong one whips the head the long way round, so the engine keeps the previous aim
  and picks the in-range solution nearest to it.

### What was done
- `src/fixtures/artdmx.js` (new):
  - `encodeArtDmx` / `decodeArtDmx`: Art-Net 4, OpCode 0x5000, ProtVer 14, SubUni/Net from the 15-bit
    port-address, even length.
  - `parseDest`: `ip[:port]`.
  - `ArtnetSender`: one ephemeral, broadcast-enabled socket that never binds :6454; send errors are counted and
    rate-limited in the log.
- `src/fixtures/follow-patch.js` (new): normalizes `project.fixtures`:
  - `{output: {enabled: false}, patch: [{id, name, enabled, universe, address, dest, pan/tilt {ch, fine, range,
    invert}, pose {x, y, z, hang truss|floor, yaw}, fixed "ch=value, …", follow, aim_z}]}`.
  - A fixture with a **problem** is never output: bad destination, footprint past channel 512, or a channel
    already used by an earlier fixture on the same destination+universe (WO-615 "collisions are refused").
- `src/fixtures/follow-ik.js` (new, pure):
  - Base axis u (+Z standing, −Z hung).
  - f = yaw direction (same convention as the camera: 0 upstage, 90 stage left).
  - g = positive pan, clockwise from above when standing, mirrored when hung.
  - `aim()` = nearest in-range solution; `null` if unreachable.
  - `axisBytes()` handles 16-bit coarse/fine and invert; `writeFixture()` writes pan/tilt plus the fixed
    channels.
- `src/fixtures/follow-engine.js` (new), 23 ms tick (≈ 43.5 Hz, under the Art-Net 44 Hz ceiling):
  - live marker → aim at (x, y, z + aim_z);
  - stale or missing → **hold** the last aim (the hub's 1 s rule);
  - never aimed → pan/tilt centre;
  - unreachable → hold.
  - One packet per destination+universe, only when its bytes change, plus a 1 s refresh.
  - **Master off = nothing transmitted** (the default). Re-patching keeps each fixture's aim, so heads do not snap.
- `src/fixtures/follow-service.js` (new): wires the engine to the hub, the sender and the project.
  - Loads `project.fixtures` at boot (`loadFullProject`), then on every project write via project-events.
  - Refuses any destination that would reach this box's own Art-Net input: loopback, 255.255.255.255, own
    addresses and directed broadcasts on :6454, at the input's port-address.
  - Logs `[follow] patch: N fixture(s), M outputtable, output ON|off` plus one warning per problem.
- `src/engine/project-events.js` (new) is an in-process bus. `scheduleProjectSyncBroadcast` emits the unmasked
  project on it before the WS debounce, and listener errors are contained.
- `src/engine/project-client-slices.js`: `CLIENT_OWNED_SLICES = ['previs', 'fixtures']`.
- `src/tracking/register.js` starts and stops the follow service with the module.
  - New route `GET /api/tracking/follow`: output state, per-fixture state / pan / tilt / problem, per-universe
    packet counts, send errors.
  - New WS message `tracking:follow {output_enabled, fixtures:[{id, state, pan, tilt, problem}]}`, at most
    10 Hz and only on change.
- Godot:
  - `features/previs/tracking/follow_model.gd` (new): the twin of follow-patch normalization. It also has
    `new_fixture` (next free address after the last fixture, same profile, +2 m in X), `beam()` (same frame as
    the server), `beam_end` (to the marker's aim point, else the floor) and `beams()`.
  - `follow_section.gd` (new): the Follow section of the tracking Inspector page (R2: same page, no new panel).
    - "Art-Net output" master, with a confirm dialog before it transmits; it saves immediately
      (`ProjectSync.mark_dirty(true)`) instead of after the 3 s debounce.
    - Fixture list showing U.addr → marker · state · pan/tilt; problems in red.
    - Add / Delete (with confirm).
    - Fields: name, follows (the project's markers), destination, universe, address, pan/tilt ch / fine /
      range / invert, pose X/Y/Z, hung, yaw, aim height, fixed channels, enabled.
    - Status line.
  - `tracking_page.gd`: Calibrate | Markers | **Follow**.
  - `marker_driver.gd`: keeps the server's `follow` aims (WS `tracking:follow`, plus a GET on resync).
  - `previs_tab.gd`: Follow mode drives markers like Markers mode and feeds `track_view.set_beams`.
  - `tracking_view.gd`: draws each fixture as a square plus a lens-curved beam from the server's pan/tilt.
    The beam is bright while following and dim while holding.

### What was VERIFIED
- Offline: `smoke-wo616-follow-artnet.test.js`, 8 tests, added to the curated CI list.
  - ArtDmx header bytes are exact, and decode round-trips.
  - IK: a hung head at tilt 0 points straight down; an upstage target gives tilt +45°; 4 targets round-trip
    through `beam()` to 1e-9; the 540° pan keeps to the side nearest the last aim; ±45° tilt reports
    unreachable; for a standing head, positive pan is clockwise from above.
  - DMX: 16-bit centre = 128/0, invert and clamp.
  - Patch: an overlap is refused ("channel 12 already used by Spot A"), as are a bad destination and a
    footprint past 512; fixed-channel parsing works.
  - Engine:
    - master off → 0 packets;
    - on → exact pan/tilt/fixed bytes, with unpatched channels at 0;
    - unchanged → no packet; stale → hold; 1 s refresh;
    - the self-loop is refused.
  - A real UDP loopback send/receive works.
  - The hook fires on `scheduleProjectSyncBroadcast`, and `fixtures` is client-owned.
- Offline suite: 2688 / 2685 pass / 2 skipped / 1 known `wo577` fail. Godot `--check` OK; `--test` 1102 passed
  (+22 in `tests/test_follow_model.gd`). 0 files over 500 lines; eslint clean on the new files.
- On the box (server restarted; GUI on DP-3, previs Camera mode, Camera 1 calibrated; Marker 1 live at
  (−5.0086, 3.4609)):
  - Follow → Add fixture: Fixture 1 at U0.001, broadcast, hung at (0, 0, 6). The journal and the list said
    **not output — "would loop into this box's Art-Net input (universe 0)"**, and nothing was sent.
  - Destination set to `127.0.0.1:6455` → state "following", **pan 55.36° / tilt 50.60°**. Hand check: d =
    (−5.0086, 3.4609, −5); tilt = acos(5/7.878) = 50.6°; pan = atan2(5.0086, 3.4609) = 55.36°. With output
    still off, 0 packets.
  - Art-Net output → confirm → OK. A Python listener on :6455 captured **36 packets**, all op 0x5000, ver 14,
    port-address 0, length 512, with nothing non-zero beyond channel 4.
    - The first packet decodes to exactly 55.36° / 50.60°.
    - Right arrow held 1 s → marker x −5.01 → −6.03. The engine reported 60.14° / 54.27°, which matches the
      hand IK, and the last packet decodes to the same.
    - 26 packets during the move, min gap 22 ms (≈ 44 Hz); 1.013–1.017 s gaps while idle.
    - The sequence number cycled 1…36 without a gap.
  - The camera view drew the beam from the fixture to the marker's 1 m aim point, following the marker
    (screenshot).
  - GUI killed (the marker goes stale) → `holding (stale)` 60.14 / 54.27. Six packets, 1 s apart, all with the
    same bytes (40066 / 45941).
  - GUI relaunched → marker live again → "following". Output toggled **off** → journal `output off`, and a 4 s
    capture saw **0 packets**.
  - Server restarted → `[follow] patch: 1 fixture(s), 1 outputtable, output off` (loaded from the project at boot).
- Not verified (owner QA): a real moving head on the owner's Art-Net node. That needs the fixture's pan/tilt
  channels, ranges, invert and pose (yaw, hang) set to match the rig — check each axis by moving the marker.
  sACN and per-universe enables are WO-615 T4. Test layer cleared. The dev project keeps Fixture 1 (loopback
  127.0.0.1:6455, output off).

## T7 — trigger zones (2026-10-19) — DONE (box-verified)

Each zone is a floor polygon. When markers cross it, the zone fires an action per transition. This is the OpenFollow zones
state machine, evaluated on the server so it runs with no client open.

### Investigation
- **OpenFollow source** (`openfollow/zones/{engine,geometry}.py`, `docs/architecture/zones.md`, `tests/test_zone_*.py`
  @ 2f8aa257):
  - Per-zone occupant set. Transitions run entries first (sorted): count 0 → 1 = `first_entry`, otherwise
    `additional_entry`. Exits follow: → 0 = `final_exit`, otherwise `partial_exit`.
  - Entry tests the drawn polygon; an occupant's exit tests the polygon shrunk inward by `hysteresis` (0.05 m).
  - Shrink guards: a miter clamp (cos ≥ 0.2), a half-shorter-edge bound, and a fallback to the original polygon on a
    winding flip or < 5 % of the area.
  - A change inside `debounce_ms` (200) of the zone's last event is **held**: occupancy is not advanced, and the change is
    re-evaluated next tick (engine.py:238 `return False`).
  - Reload carries occupancy by signature (vertices, trigger, enabled, triggered_by), FIFO. Nothing is carried when the
    master is off. A disabled zone clears its occupancy. A zone with fewer than 3 vertices is skipped.
  - `last_event_time` is stamped only when an address was actually sent (engine.py:273).
- **What a zone can fire on this box.** Haiku survey; I re-checked the load-bearing claims myself.
  - There is **no outbound OSC sender**. `osc` is used only by the receiver `src/osc/osc-listener.js:52`, and T6 OSC out
    was dropped by the owner.
  - Two server-side paths can fire:
    - `handleTakeLook(body, ctx)` (`src/api/routes-scene-take-look.js:24`, WO-598: take a stored look by id; `target:
      'preview'` stages it).
    - The Companion HTTP press (`src/engine/timeline-playback.js:194-245`): `POST
      http://<companion.host>:<port>/api/location/p/r/c/press`, with host and port from `resolveCompanionConfig`. This
      is HTTP only by design (WO-547).
  - On the box, Companion listens on :8000, and pressing an empty location answers 404.
- **Storage.** `previs` is already a client-owned slice (WO-607), and tracking_model `normalize` keeps unknown keys.
  `project.previs.tracking.zones` therefore needs no new slice registration. The server reads it through
  `project-events` like the follow patch.

### What was done
- **Server**:
  - `src/tracking/zone-geometry.js`: a line-for-line port of geometry.py (point in polygon, signed area, shrink).
  - `src/tracking/zone-engine.js`: the `ZoneEngine` port (`normalizeZones`, `reload` with signature carry, `update`,
    `states`). AGPL header with the changes listed:
    - Markers only. Detection is T9.
    - A marker the hub calls **stale keeps its membership**, so an operator client dropping does not fire an exit cue. A
      marker removed from the hub exits.
    - Every transition fires the sink, so debounce stamps on every transition. OpenFollow stamps only sent addresses.
  - `src/tracking/zone-actions.js`: what a zone's four slots name instead of an OSC address:
    - `look:<sceneId>[@preview]` → `handleTakeLook` (no second take path);
    - `companion:<page>/<row>/<col>` → the HTTP press;
    - blank = nothing;
    - anything else → `invalid`, logged.
  - `src/tracking/zone-service.js`: 10 Hz evaluation (OpenFollow's default) of `hub.list()`. The project slice is loaded
    at boot and on every project write. It keeps the last 20 transitions and their results.
  - `register.js`: starts and stops the service. Adds `GET /api/tracking/zones` and WS `tracking:zones` (on change).
  - **The master defaults off.**
- **Godot**:
  - `zone_model.gd`: the client mirror of `normalizeZones` and the action grammar.
  - `zones_section.gd`: the Zones mode of the tracking Inspector page:
    - master, which asks before arming: "Arm the zone engine? … take looks, press Companion buttons";
    - debounce and exit margin;
    - zone list with live occupancy;
    - name, enabled, triggered-by marker ids, and the 4 actions (invalid ones turn red, with the reason);
    - Draw shape / Undo point / Clear shape.
  - `tracking_page.gd`: the 4th mode, Zones, persisted through the page. The page owns the whole `previs.tracking`
    dict, so a sibling write would be overwritten by its next save. While drawing, the view's click adds a floor corner
    (`marker_input.floor_point` at the grid floor height).
  - `tracking_view.gd`: zones drawn on the floor through the solved camera and lens in Markers / Follow / Zones mode.
    A zone is filled while the server says it is occupied; the selected zone is thicker; corners are shown while
    drawing. Zones mode drags markers, except while drawing.
  - `marker_driver.gd`: adopts `tracking:zones` and GETs it on resync.
  - `previs_tab.gd`: `_push_zones()`.
- **Credit**: the zone files and `marker_input.gd` (missing until now) were added to `THIRD_PARTY_NOTICES`.

### What was VERIFIED
- **Offline**:
  - `smoke-wo616-tracking-zones.test.js`: 11 tests, added to the curated list.
    - All of OpenFollow's geometry vectors pass: square, L-shape notch, winding, shrink 0/negative, the 0.5 m square,
      clockwise, coincident, hairpin, acute miter clamp, narrow strip, needle → original, equilateral → original.
    - Normalize.
    - Transition kinds and order (entry counted before a simultaneous exit).
    - Hysteresis.
    - Debounce hold: a held exit fires at 250 ms, and a bounce that returns inside the hold fires nothing.
    - `triggered_by`; disabled zone; degenerate zone.
    - Reload carry: a renamed zone is carried, a reshaped zone re-enters, and master off → re-arm fires `first_entry`.
    - Stale hold vs removal.
    - Action parse/run through seams. The Companion URL comes from config.
    - Service via project-events.
  - Offline suite: 2699 tests, 2696 pass, 2 skipped, 1 failure: the known `wo577` library test.
  - Godot `--check` OK. `--test` 1125 passed (+23 assertions in `tests/test_zone_model.gd`, written by a Haiku agent and
    reviewed).
  - eslint clean on the new files; 0 files over 500 lines.
- **On the box, server only** (GUI stopped):
  - A zone "Downstage centre" (−1…1 × 2…4 m) was written via `/api/project/autosave`. Journal: `[zones] 1 zone(s), engine
    ON`, with no restart (project-events).
  - Two markers were driven over HTTP: m1 in, m2 in, m2 out, m1 out. `/api/tracking/zones` `recent`:
    - `first_entry` m1 → `look look-1 → preview`;
    - `additional_entry` m2 → `companion 99/0/0 → 404` (warn; the failure path);
    - `partial_exit` → none;
    - `final_exit` → `look look-2 → preview`.
  - The journal shows the real take path ran (`[scene-take] preview-only path prv=2`). AMCP `INFO 2-10` showed the look's
    clips on preview.
  - A marker parked inside with writes stopped went **stale and stayed inside**. `DELETE` → `final_exit`.
- **On the box, GUI** (DP-3, previs Camera mode, Camera 1 calibrated):
  - Zones mode showed the server-written zone on the floor, filled with "inside: Marker 1" (screenshot).
  - Add zone → Draw → four clicks on the floor drew "Zone 1" corner by corner. After the autosave the server had it, at
    (−2.51, 2.39) … (−2.02, 4.9).
  - Dragging Marker 1 from Downstage centre into Zone 1: the server fired `final_exit` (look-2 → preview) then
    `first_entry` (Zone 1, no action). The view refilled the new zone, and the list read "Zone 1 · 4 pts · inside:
    Marker 1" (screenshot).
  - Typing `bogus` as First entry turned the field red and showed "First entry: unknown action "bogus"". The server
    logged the same warning on reload. The field was then cleared.
  - Master toggled off from the GUI → `[zones] 2 zone(s), engine off`.
- **Not verified (owner QA)**:
  - Zones driven by real tracking (gamepad / detection T9).
  - A Companion press on a real button.
  - Taking a look to **program** from a zone. The same `handleTakeLook` path ran for preview.
- **Left in the dev project**: zones "Downstage centre" (look-1 / companion 99/0/0 / look-2 @preview) and "Zone 1"
  (no actions), engine off.

## T12 — 3D stage ghost in the camera view (+ T4 closed) (2026-10-19) — DONE (box-verified)

### Investigation
- **T4 was already delivered piecewise.** The Camera mode view (T3b, `tracking_view.gd`) draws the camera's live
  surface letterboxed to the raster. On it go the stage-object outlines and grid (T3b, `tracking_overlay.gd`, edges
  cut into 24 pieces so the lens bends them), the markers (T5b) and the zones (T7), all through the solved camera
  (`camera_model.project` + `apply_distortion`). What it lacked is T12's part: the stage itself (the wall
  *pictures*, curved surfaces, occlusion), which 2D outlines cannot show.
- A Godot `Camera3D` is a pinhole and has no radial distortion. The solved camera has k1/k2 (Camera 1: −0.197 /
  0.032), and drawing the 3D render without them would put the ghost a few px off the 2D outlines and off the real
  walls near the frame edges. That is exactly where an operator checks calibration.
- The lens model is `camera_model._radial`: coordinates are normalised by the half-diagonal, and
  rd = ru·(1 + k1·ru² + k2·ru⁴). Doing it per *pixel* needs the inverse (for each output pixel at rd, which pinhole
  pixel at ru?). There is no closed form, but Newton converges in a few steps below the fold radius
  (`lens_fold_radius`).
- With barrel distortion (k1 < 0), the picture corner (rd = 1) comes from ru = `invert_radius(1)` > 1, which is
  outside a raster-sized pinhole render. So the render must be **overscanned** by that factor, or the corners go
  blank.
- The previs stage (`previs_stage.gd`) is one World3D. A second SubViewport can share it (`world_3d`) and render it
  from another Camera3D with no copy of the scene. The live wall textures come from `stage_builder.set_live`, which
  the 3D tab only switched on in 3D mode.
- The stage floor is a dark plane. Through the camera it would cover the real floor in the picture, so it has to go
  from the ghost and only from the ghost (the 3D tab keeps it).

### What was done
- `features/previs/tracking/camera_overlay.gd` (new, a SubViewport):
  - It shares the stage World3D. Its Camera3D gets `camera_model.godot_transform` and
    fov = 2·atan(overscan·tan(vfov/2)) with KEEP_HEIGHT. Its environment is the stage's, duplicated, with a clear
    colour (`transparent_bg`) and no glow, so only geometry lands on the picture.
  - `cull_mask` drops `PrevisStage.FLOOR_LAYER`.
  - The render size is raster × overscan, capped at 2048 px wide. The overscan is clamped to 1…2 (pincushion needs
    none).
  - `material`, a canvas shader: for each output pixel at distorted radius rd, a 12-step Newton solve finds the
    pinhole radius (capped at the fold radius) and samples the overscanned render there. Anything outside the render
    is transparent. Alpha is × opacity.
  - It renders only while active (`UPDATE_DISABLED` otherwise).
- `previs_stage.gd`: `FLOOR_LAYER` (bit 19) on the floor mesh. `environment` is exposed.
- `tracking_view.gd`:
  - The background and picture moved from `_draw` into a child Control `_back` (`show_behind_parent`), and a
    `TextureRect` `_ghost` sits between it and the parent's 2D lines. Order back to front: picture, ghost, outlines /
    grid / markers / zones.
  - `_ghost` follows the letterboxed image rect, so zoom and pan carry it.
  - `set_ghost(on, opacity)`. `_sync_ghost` runs on every state / visibility change. It turns the viewport on only
    when the view is shown, the ghost is on and the camera is valid.
- `tracking_page.gd`: a row under the mode buttons with a "3D stage overlay" check box and an opacity slider
  (0.05–1). Signal `ghost_changed`.
- `previs_tab.gd`:
  - It builds the overlay, attaches it to the stage world and wires `ghost_changed`.
  - `builder.set_live` also runs in Camera mode while the ghost is on, so the walls carry their live pictures.
  - `ghost_on` / `ghost_opacity` persist in `ui.cfg` with the mode (`_save_ui`, factored out of `set_mode`). They
    are operator view state, not project data.
- `tests/test_camera_overlay.gd` (written by a Haiku agent, reviewed): 6 tests (empty entry rejected; no lens = pinhole fov and raster size; barrel k1 −0.2 overscan = clamped
  `invert_radius(1)`, fov widened to 2·atan(overscan·tan(vfov/2)), width ≤ 2048 with aspect kept; pincushion clamps to 1;
  pose = `godot_transform`; active ⇄ UPDATE_ALWAYS/DISABLED, opacity clamped).

### What was VERIFIED
- Godot `--check` OK. `--test` 1145 passed, 0 failed (+20 assertions). 0 files over 500 lines. No JS touched.
- **On the box** (GUI on DP-3, previs Camera mode, Camera 1 = the T3b lens solve, k1 −0.197, k2 0.032):
  - Ticking "3D stage overlay": the ghost filled the amber 2D outlines of Main LED, DSM TV and Side L, and Main LED
    (DP-7), which runs off the left edge, was cut at the same place. In a 2× zoom crop, Main LED's ghost edge sits
    on the barrel-bent outline along its whole top edge. Side L (curved) shows the true curved surface, where the 2D
    outline is straight corner-to-corner segments, as expected.
  - Camera 1 sits upstage (y +13 m) looking downstage, so it sees the walls' *backs*, which are black. That matches
    the 3D tab, where the same walls only show green on their edges from behind and the full picture from Front.
  - With `PLAY 1-90 #FF00C040` on ch1 (the camera's source), the picture went green and the ghost stayed on top of
    it at 60 %. The floor was not ghosted (the real floor stays visible). Order check: picture, ghost, lines.
  - A temporary **Camera 2** (default pose, downstage y −11 m facing the walls) showed the walls' **live pictures**
    in the ghost: the opgui content on Main LED and the left wall. It was clipped at the picture's top edge where
    the outline runs above it. Lens k1 +0.3 (pincushion): the ghost edges followed the re-bent outlines. Camera 2
    was then deleted (confirm dialog), and the project is back to Camera 1 only.
  - Opacity slider: 0.6, then 0.15 (visibly fainter), then 0.85. `ui.cfg` read `ghost_on=true`,
    `ghost_opacity=0.15…`, then `0.85…`, and `mode="camera"`.
- **Not verified**:
  - A barrel lens with k1 below −0.2 on the box (xdotool cannot type a minus into the SpinBox here). The T3b
    camera's −0.197 is the barrel case shown, and the test covers the overscan maths.
  - Real DeckLink input. Owner QA: on a calibrated real camera, check that the ghost walls sit on the real walls.
- Test colour cleared (`CLEAR 1-90`).

## T9a — person detection: sidecar + server service (2026-10-19) — DONE (box-verified; real camera = owner QA)

Scope: OpenFollow's detection path (YOLO + ByteTrack), ending in floor points on the server and a WS feed.
Pinning detections to markers (`replace` / `assist`), the Godot boxes and controls are T9b; the mask editor is T9c.

### Investigation
- OpenFollow `openfollow/video/detection.py` + `tracking.py` @ 2f8aa257, read in full:
  - Pre-processing: CLAHE on LAB L (clip 2.0, 8×8 tiles), then letterbox to the model square (pad 114), /255, NCHW RGB.
  - Two heads:
    - 6-column end-to-end head `[x1,y1,x2,y2,conf,cls]`: person class only, no NMS.
    - 84-column `[cx,cy,w,h,80 class scores]` head: column 4 = person, greedy NMS keeps IoU ≤ 0.45.
  - Raw boxes are pulled down to `min(0.1, confidence)` (the ByteTrack low band), capped at `max(3·max_persons, 60)`.
  - ROI masks test the **feet point** (bottom-centre) in normalised polygons.
  - ByteTrack:
    - Kalman on `[cx,cy,w/h,h]`, noise h/20 (position) and h/160 (velocity).
    - First pass: the high band, gated at IoU 0.2 with a centre-distance rescue at 1.5× the predicted width.
    - Second pass: the low band at IoU 0.5.
    - Only high boxes spawn tracks.
  - Track lifetime:
    - Allowance = max(interval, longest of the last 8 step gaps).
    - Coast = max(grace 500 ms, allowance).
    - A lost track is kept for allowance + coast.
  - Defaults: confidence 0.2, interval 67 ms, max 10 persons, model `yolo26n.onnx`.
  - Execution providers: CoreML → CPU.
- Models: OpenFollow downloads YOLO26 (Ultralytics, AGPL-3.0) at runtime; nothing is vendored. Exported here, once:
  - Ultralytics 8.4.182, `v8.4.0/yolo26{n,s}.pt`, exported to `~/.local/share/highascg/models/`.
  - `yolo26n.onnx`: 9,930,306 B, sha256 b95b0fb6….
  - `yolo26s.onnx`: 38,279,479 B, sha256 8eb5c37a….
  - Both: input `images [1,3,640,640]`, output `output0 [1,84,8400]`, i.e. the 84-column head, so NMS applies.
  - CPU, 4 threads: n 13.7 ms, s 41.7 ms per inference.
  - The box has no CUDA onnxruntime. The ~3 GB CUDA pip stack is deferred; CPU is enough at 15 Hz.
- Input: the WO-597 shm surfaces (`/dev/shm/highascg-<role>`, BGRA, `tools/hshm-bridge/hshm_abi.Reader`). They
  exist only while some client holds a lease (15 s TTL), so the detector must lease its own roles; a headless
  server with detection on must not depend on a Godot client being open.
- Sudo is limited to an allowlist, so a systemd unit cannot be installed from a session. A child process of
  the server needs no root, dies with the server (stdin EOF), and is already how the shape helper runs.
- First pipeline run gave `tracks: []`. That was correct: the frame was the idle slate (`led_grid_test.html` on
  layer 999 covers layer 90), and `of_concert_default.jpg` has no people on stage anyway. Testing then used
  frame 150 of `testowe/pedestrian_area.yuv` (the classic 1080p pedestrian sequence), saved as
  `testowe/t9_pedestrians.png` and played on `1-1000`.

### What was done
- **`tools/tracking-detect/`** (Python; runtime outside the repo, since Syncthing syncs the repo and the weights are AGPL):
  - `bytetrack.py`: a reviewed port of `tracking.py`. Boxes are `(x1,y1,x2,y2,score)` tuples; same constants,
    noise, gates, ranking and lifecycle.
  - `detector.py`: a port of `detection.py`:
    - `Backend`: the input size is read from the ONNX shape, both heads are handled, NMS.
    - `to_rgb`: BGRA → RGB, downscaled to the model size *before* CLAHE (OpenFollow's appsink pre-scales; this
      keeps CLAHE off a 1080p frame).
    - `filter_masks`: the feet-point test.
    - `CameraDetector.step`: the allowance / coast timing and the high / low split.
    - Providers: CUDA when the onnxruntime build has it, otherwise CPU.
  - `sidecar.py`: the JSON-lines protocol (config on stdin; `ready` / `tracks` / 1 Hz `status` / `error` on
    stdout). One shm `Reader` per camera, reopened on a geometry change. The model reloads when the config names
    a new one. The sidecar exits on stdin EOF.
  - `setup-venv.sh` + `requirements.txt` (numpy 2.5.4, onnxruntime 1.31.0, opencv-python-headless 5.0.0.93)
    create `~/.local/share/highascg/tracking-venv`. They cope with this box's python3 having no ensurepip
    (`--without-pip` + get-pip.py).
  - `export-models.sh`: a one-off ultralytics export in a throwaway venv (several GB; run by hand).
- **`src/tracking/detect-model.js`** (pure):
  - `normalizeDetection`: the `project.previs.tracking.detection` slice. Every field is clamped. `model` must be a
    bare `*.onnx` file name (no paths, no `..`). Per-camera `{enabled, masks}`.
  - `detectCameras`: tracking cameras with a valid surface role that are not switched off.
  - `boxToFloor` / `personsFrom`: feet pixel at the camera's calibration raster → `pixelToFloor` on z = `grid.z_offset`.
  - The Godot `tracking_model.normalize` deep-copies the slice and keeps unknown keys, so `detection` survives
    client writes. No client change was needed.
- **`src/tracking/detect-service.js`**:
  - Runs the sidecar while detection is enabled and ≥ 1 camera qualifies. Config comes from the active project at
    boot, then from `project-events` on every write. A config change goes to the running child as a new stdin
    line; there is no respawn.
  - Leases the roles under client id `tracking-detect` every 5 s, and leases `[]` (immediate REMOVE) when detection
    is off.
  - Respawns with backoff (1 s doubling to 30 s, reset on `ready`).
  - A missing venv or model is a status error naming the setup script, retried every 5 s.
  - Keeps the latest persons per camera; they go stale after 1 s.
  - Overridable through `HIGHASCG_TRACKING_PYTHON` / `HIGHASCG_TRACKING_MODELS`.
- **`src/tracking/register.js`**:
  - `GET /api/tracking/detections`: sidecar state, providers, error, pid, per-camera fps / ms, latest persons.
  - WS `tracking:detections` `{enabled, running, cameras:[{id, role, frame, stale, persons:[{tid, box, score, age_s, floor}]}]}`,
    sent at ≤ 15 Hz when it changes.
- **`THIRD_PARTY_NOTICES`**: `bytetrack.py` / `detector.py` added to the OpenFollow port list. A new block names
  the runtime components that are installed per machine and not shipped in the repo (YOLO26 AGPL-3.0, ONNX
  Runtime MIT, OpenCV Apache-2.0, NumPy BSD-3).
- `tools/smoke/smoke-wo616-tracking-detect.test.js` (9 tests; written by a Haiku subagent, reviewed): slice
  clamps and model-name rejection, camera selection, a box → floor round trip against `project`, and the service
  against a fake child: config line, line buffering across chunks, staleness, unknown camera, reconfigure without
  respawn, disable → SIGTERM + lease `[]`, crash → respawn after 1 s, missing venv.

### What was VERIFIED
- Offline suite: 2705 / 2708 pass. The 9 new tests pass. The single failure is the known `wo577` one, plus 2 skips.
  ESLint clean. `format:check` clean. 0 files over 500 lines.
  - `setup-venv.sh` was run end to end into a fresh scratch venv: `ok 1.31.0 [... 'CPUExecutionProvider']`. The
    scratch venv was then removed.
- **Sidecar alone, on the box** (ch1 leased by hand, `t9_pedestrians` on 1-1000):
  - `ready` on CPUExecutionProvider, input 640. Status `ok` at 14 fps, ~17 ms per step (decode + CLAHE + yolo26n + track).
  - 10 people found (scores 0.24–0.86). Drawing the boxes on the frame: each box is on a person, and each feet
    point is at that person's feet.
  - The same 10 track ids for all 86 steps (no churn on a still frame).
- **Through the server** (server restarted; detection switched on via `POST /api/project/autosave` with
  `previs.tracking.detection = {enabled: true}`, Godot closed so it could not autosave over it):
  - Journal: `sidecar started`, `[video-surfaces] ADD 1-801 SHM NAME ch1`, then `sidecar ready: yolo26n.onnx on
    CPUExecutionProvider`.
  - `GET /api/tracking/detections`: running, `cam_1` fresh, 10 persons with floor points. Camera 1 (the T3b solve)
    sits upstage and faces downstage, so feet near the bottom of the frame map near it (person 0: y 7.98 m) and a
    far figure maps downstage (person 9: y 1.80 m); image-left maps to +X. (The pedestrian picture is not the
    stage the camera was calibrated on, so the metres are geometry only.)
  - Reprojecting person 0's floor point through `project` + `applyDistortion` gave pixel (917.1, 1001.4), the
    feet pixel exactly.
  - WS `/api/ws`: 39 `tracking:detections` messages in 3 s (~13 Hz). The payload was as above.
  - `kill -9` on the sidecar: journal `sidecar exited (SIGKILL) — restart in 1000 ms`. A new pid, ready, and the
    same 10 persons within 4 s.
  - Detection off (autosave `{enabled: false}`): `sidecar stopped`, `[video-surfaces] REMOVE 1-801 (ch1: no
    leases)`. `/dev/shm/highascg-ch1` gone, no sidecar process. The project is left with detection off.
- **Not verified**:
  - A real camera / moving people. Owner QA, once T9b shows boxes in the camera view.
  - The CUDA provider (no CUDA onnxruntime installed).
  - Masks on the box. The feet-point filter is unit-covered only; there is no editor until T9c.
  - Two cameras at once: the code path is per-camera, but the box has one solved camera.

## T9b — detection pinning (replace / assist) + Godot Detect mode (2026-10-19) — DONE (box-verified; real camera = owner QA)

### Investigation
- **OpenFollow's pin** (`runtime/services_detection_pin.py`, `runtime/frame_timing.py`, `video/detection.py`
  `tracked_detection` @ 2f8aa257, read in full):
  - Two modes. `replace`: the selected marker is written from one tracked person. `assist`: the operator keeps
    steering, and the marker is pulled toward the nearest person inside `assist_radius_m`, eased by
    `assist_strength`.
  - Smoothing is dt-corrected: `dt_steps` = dt / (1/60), clamped to [1 ms, 0.2 s], and `ema_factor(a, n)` =
    1 − (1 − a)^n. Velocity EMA α 0.3. Lookahead is `prediction` frames (8). Position EMA `smoothing` (0.15).
  - Validity: 0.5 at the confidence threshold, 1 at score 1, fading linearly over the coast window.
  - Re-acquire in replace: sticky by track id, else the nearest box centre within 0.15 of the frame, else the
    largest box.
  - `pin_point` top casts the head onto the marker's own height; bottom casts the feet onto the floor.
- **Assist needs an anchor.** The Godot marker driver (`marker_driver.gd`) adopts hub positions and heartbeats
  every 250 ms. If assist wrote the AI-corrected position into the hub, the driver would adopt it and send it back,
  and the marker would creep toward the person with no one steering. So the operator's position (the ANCHOR) and the
  output have to be two different things on the wire.
- **Found on the box while verifying** (each fixed below):
  1. `driven` inferred from `source: 'detect'` deadlocks. A dead assist anchor leaves `source: 'detect'` on a
     marker nobody drives. The client then stopped heartbeating it, so it stayed stale for good (screenshot: "Marker
     1 · stale" in Detect mode). The same happened after a server restart: the client kept its last copy of a marker
     the hub had lost, still flagged driven, so it never re-created it and replace had nothing to drive.
  2. **`/dev/shm/highascg-ch1` vanished at boot** ("no picture from ch1" in the camera view) while the sidecar
     kept detecting. The journal had two `ADD 1-801 SHM NAME ch1` 200 ms apart: the detection service leases at
     boot, then `onCasparReady` clears `active` and re-ADDs. AMCP probe on a spare index (`1-899`):
     - ADD over a live consumer → name gone.
     - REMOVE then an immediate ADD → name gone.
     - REMOVE, wait 20 / 60 / 120 / 250 ms, ADD → name present.
     - REMOVE on an empty index → `404 REMOVE FAILED`.

     So Caspar tears the old shm consumer down on a later channel tick, and that teardown unlinks the NAME the new
     consumer just created. Readers that had already mapped it carry on; anything opening it afterwards finds
     nothing. A concurrent-lease variant exists too (`lease()` only marks `active` after the ADD reply).
  3. **The sidecar can hold a dead segment.** Started before the boot ADD, it maps the previous process's segment.
     The REMOVE + ADD then gives the name a new segment, and the sidecar reports `stale` with 0 fps forever. The
     Godot reader re-opens the path on every read (`shm_reader.gd` `_read`), so it never has this problem.

### What was done
- **`src/tracking/detect-pin.js`** (new; OpenFollow port, attributed) `DetectPin.step()`, every 33 ms tick:
  - **replace**: drives `pin_marker_id`, which must exist in the hub (OpenFollow's −1 "controller-selected" has no
    server equivalent):
    - `status` per `detectionStatus`.
    - Nobody tracked → held in place at status 0, still written so it stays fresh.
    - Sidecar down → released to status 1.
    - `drives(id)` says the pin owns the marker.
  - **assist**: operator writes become anchors (dropped after 1 s with no refresh).
    - Each anchored marker glides toward the nearest matched person within the radius, else back home to the
      anchor.
    - The outer glide is seeded once, so the marker never snaps.
  - Mode switch or off: releases everything.
- **`src/tracking/marker-hub.js`**: a `status` field (0–1, default 1), plus `setStatus()`.
- **`src/tracking/detect-model.js`**: pin fields with OpenFollow defaults, a per-camera `masks_enabled`
  master (default off), and `boxPoint()` (unrounded, head or feet).
- **`src/tracking/register.js`**:
  - Assist: operator writes go to the anchor.
  - Replace: operator writes to a driven marker are dropped (otherwise the client heartbeat flips `source`).
  - Markers carry `anchor` (assist) or `driven: true` (replace), as the server's own statement. **Never inferred
    from `source`** (fix 1).
  - Persons in `tracking:detections` and in `GET /api/tracking/detections` carry `marker` when pinned.
- **`src/tracking/detect-service.js`**:
  - Snapshot gains `error`; status gains `models` (the `.onnx` files on the box).
  - Getters `config` / `available` / `planeZ` and `persons()` for the pin.
- **`src/system/video-surfaces.js`** (fix 2):
  - `ensure()` makes concurrent leases of one role share one in-flight ADD.
  - A role whose Caspar state the manager has not set itself since the last (re)connect gets a quiet REMOVE first.
    If that REMOVE found a consumer, the ADD waits `SETTLE_MS` (200 ms) for its teardown.
- **`tools/tracking-detect/sidecar.py`** (fix 3): once a camera has been stale for 1 s, it compares the segment's
  inode with the one it opened, and re-opens when the name now points elsewhere (or nowhere).
- **Godot**:
  - **`detect_model.gd`** (new): the slice's client mirror (defaults, clamps, unknown keys kept), `camera_on` /
    `with_camera`, `status_line`, and `position_of` (hub item → driver position; anchor → `out`, `driven` from the
    server).
  - **`detect_section.gd`** (new): the Detect Inspector section, with:
    - a master switch with a confirm;
    - Detect on <camera>;
    - the model (from the box's list), confidence, interval, max persons, keep-lost;
    - pin mode, marker (replace only), pin point, smoothing, lookahead, assist radius / strength (assist only).

    Detection broadcasts refresh the status line only, so an open dropdown stays open at 15 Hz.
  - **`tracking_page.gd`**: a fifth mode, Detect.
  - **`previs_tab.gd`**: Detect drags and drives markers like Markers mode, and the boxes go to the view.
  - **`marker_driver.gd`**:
    - Assisted markers are steered at their anchor.
    - Driven markers get no heartbeat and no moves.
    - A marker the hub lost is never driven.
    - `tracking:detections` is kept and emitted on its own `detected` signal (not `updated`).
  - **`tracking_view.gd`**:
    - Detected persons of the camera on screen are boxed, with `#tid score%`. The pinned one is drawn thick in its
      marker's colour; coasting boxes are faded.
    - An assisted marker's ring is the anchor, with a thin line to the body at the output.
    - Marker labels gain `· assist` / `· AI` / `· AI lost`.
- **Tests**:
  - `tools/smoke/smoke-wo616-tracking-pin.test.js`: 20 tests. 19 were written by a Haiku subagent and reviewed;
    its one flagged "discrepancy" was arithmetic in my spec, not the code. They include OpenFollow's
    `detectionStatus` vectors. The drives / freshness test was added after fix 1.
  - `smoke-wo616-tracking-detect.test.js`: the new fields.
  - `smoke-wo597-video-surfaces.test.js`: +2 tests (concurrent leases share one ADD; a role removed by the manager
    re-ADDs without cleanup). Its exact AMCP sequences now include the pre-ADD cleanup; where that cleanup is
    incidental, `lines` is reset after setup so the REMOVE assertions stay meaningful.
  - `godot/client/tests/test_tracking_detect.gd`: 9 tests (normalize / camera / status_line written by Haiku;
    `position_of` mine). The driver can't be loaded in the test runner (autoload `Ws`), which is why
    `position_of` was extracted.
- **Notices**: `THIRD_PARTY_NOTICES` lists `detect-pin.js` and the pin test vectors.

### What was VERIFIED
- **Gates**:
  - Offline suite: 2727 / 2730 pass. The one failure is the known `wo577` library-panel test, plus 2 skips.
  - Godot `--check` boot OK; `--test` 1191 passed, 0 failed.
  - ESLint clean. `format:check` clean. 0 files over 500 lines.
- **Server, over WS** (probe script; it drives marker 1 as `operator` every 250 ms, like the Godot driver;
  `t9_pedestrians` on 1-1000):
  - Replace, head (`top`): marker 1 → `source: 'detect'`, status 0.8125 (score ~0.8 at threshold 0.2), and person
    tid 4 pinned. Broadcasts: 1 `operator`, then 11 `detect`, so no source flapping. The head point lands far from
    the feet: the photo doesn't match the stage the camera was calibrated on (people look like giants), so this is
    expected.
  - Replace, feet (`bottom`): the marker converged on tid 4's feet floor point (7.866, 9.049) within ~1 s and held
    there.
  - Assist, anchor (7.5, 9.0), strength 0.5: output (7.6831, 9.0245) = anchor + 0.5 × (person − anchor), exactly.
    With the anchor at (0, 5), nobody is within 1 m, so output = anchor and nothing is pinned. After the probe
    closed, the anchor dropped and the marker went stale.
- **Through the Godot GUI** (screenshots):
  - Detect mode shows the section, "Running — 10 persons", and 10 boxes on the people.
  - Dragging marker 1's ring next to person 6 (assist): anchor (−2.8847, 4.2685), output (−2.9569, 4.3355),
    halfway to their feet at (−3.029, 4.403). The anchor stayed bit-identical for 6 s (no creep). Box #6 is drawn
    in marker 1's red, "1 pinned" shows, and Fixture 1's beam follows the output.
  - Pin → Replace in the Inspector: persisted (server `pin_mode: replace`). Marker 1 jumped to the largest person
    (#4), tagged `AI`, `driven: true`, status 0.81. The Marker row appeared and the assist rows hid. The dropdown
    stayed open while detections streamed.
  - Server restarted under the running GUI: marker 1 re-created by the client heartbeat, re-pinned to #4, and the
    camera picture kept.
- **Fix 2**:
  - Boot journal after the fix: one `ADD 1-801 SHM NAME ch1`.
  - `/dev/shm/highascg-ch1` present; the camera view shows the picture again.
- **Fix 3**:
  - The sidecar started 0.6 s before the boot ADD (the dead-segment case).
  - With the fix it re-opened and ran at 15 fps with 10 persons.
  - Before the fix the same sequence gave `state: stale`, 0 fps.
- **Not verified**:
  - Moving people / a real camera. Pin smoothing, prediction and re-acquire under motion are unit-covered only.
    Owner QA.
  - Two cameras pinning at once (one solved camera on the box).
  - The project is left with detection ON, in replace on marker 1 (feet), against the test still on 1-1000.

## T9c — ROI mask editor in the camera view — DONE (2026-10-19, box-verified through the GUI)

### Investigation

- The server and the sidecar already handled masks since T9a; only the editor was missing.
  - `src/tracking/detect-model.js` `normalizeMasks` stores `cameras.<id>.masks` as `[{enabled, vertices: [[x, y]
    0–1]}]`, keeping a mask only when it has 3+ corners, plus `masks_enabled` (OpenFollow's master switch, default
    off). `detectCameras` hands the sidecar the masks only when `masks_enabled` is set.
  - `tools/tracking-detect/detector.py` `filter_masks` keeps a raw box only when its feet point (bottom-centre)
    is inside an enabled 3+-corner polygon. If no mask is usable, every box passes. Filtering runs before
    ByteTrack, so a masked-out person never gets a track id.
- Masks are picture coordinates (0–1 of the frame), not floor coordinates. Unlike the Zones editor, a click is not
  projected to the floor: it is the raster px divided by the camera raster, the same space the boxes are drawn in.
- `detect_section.gd` was at 168 lines and `tracking_page.gd` at 476, so the editor went into its own file rather
  than growing either.

### What was done

- **`godot/client/features/previs/tracking/detect_model.gd`**:
  - `masks_of(d, cam)` returns copies of one camera's masks.
  - `with_masks(d, cam, on, masks)` replaces them. It keeps the camera's `enabled`; a camera with no entry yet is
    created watched.
  - `masks_active(mk)` mirrors the sidecar's "does this set filter at all" rule.
- **`mask_section.gd`** (new, inside the Detect section):
  - Controls: "Use masks", a mask list, Add / Delete (with confirm), Enabled, Draw shape / Undo point / Clear
    shape, and a status line that says whether the set filters and why not.
  - It owns no data. `detect_section` hands it `masks_of(...)` and writes its `edit` back through `with_masks`.
  - The first mask turns "Use masks" on, since it is drawn to be used.
- **`detect_section.gd`**: adds the mask section. A camera switch stops drawing.
- **`tracking_page.gd`**:
  - In Detect mode, `click` adds a 0–1 picture corner while a mask is being drawn.
  - Leaving Detect stops drawing.
  - The mask section's `view_changed` triggers a redraw.
- **`tracking_view.gd`**:
  - Detect mode draws the masks: green, filled while the set filters, outline only while it is off; the selected
    mask is thicker and shows corner dots while drawing.
  - While masks filter, a dot marks each box's feet point (the point the sidecar tests).
  - While drawing, a left click is a corner (`clicked`) rather than a marker grab.
  - The hint line changes while drawing.
- **`previs_tab.gd`**: `_push_masks()` on every tracking change.
- **Tests**: `godot/client/tests/test_tracking_detect.gd` gets 6 tests (Haiku-written, reviewed) for
  `masks_of` / `with_masks` / `masks_active`: copies, kept `enabled`, other cameras untouched, the filtering
  rule, and the round trip.

### What was VERIFIED

- Godot `--check` boots clean. `--test`: 1209 passed, 0 failed. Line limits: 0 files over 500.
- **Through the Godot GUI** on the box (screenshots), test still on 1-1000, detection on, replace on marker 1 (feet):
  - Before: "Running — 10 persons · 1 pinned", marker 1 on the largest person at the left edge.
  - Add mask, then four clicks over the right half of the pavement. The polygon drew with corner dots, and "Use
    masks" switched on.
  - The server stored `cam_1: {enabled: true, masks_enabled: true, masks: [{enabled: true, vertices:
    [[0.507, 0.598], [0.998, 0.598], [0.998, 0.988], [0.507, 0.988]]}]}`.
  - Within ~3 s the sidecar reported 5 persons, all with feet inside the polygon (x 0.64–0.97, y 0.64–0.84). The
    boxes on the left were gone, and the status read "5 persons · 1 pinned".
  - The Replace pin re-acquired: marker 1 moved onto a person inside the mask.
  - Unticking "Use masks" brought back 10 persons, with the polygon kept (`masks_enabled: false`).
- **Not verified**: masks on a real moving camera, and several masks per camera, which are covered only by the
  `filter_masks` "any polygon" rule. Owner QA.
- Left on the box: `cam_1` keeps one mask with "Use masks" off.

## T10a — multi-camera fusion engine (server) — DONE (2026-10-19, offline on a synthetic two-camera stage)

### Investigation

- OpenFollow has no fusion. A code search for `triangulat` finds nothing, and its stations only share markers. The
  design below is new work, following this WO's "Two-camera workflow" steps 3–5. OpenFollow supplies only the
  per-camera inputs: its detector and ByteTrack (T9a).
- Inputs already on the server:
  - `detect-service` keeps the latest `{at, frame, persons}` per watched camera.
  - `detect-model.boxPoint` casts a box's feet or head onto a plane.
  - `camera-model.js` has the lens-correct project / unproject.
- What was missing was a viewing ray for a pixel, so that two cameras' head rays can be intersected without
  guessing the plane they cross.
- The cameras are not frame-locked (each sidecar step arrives independently, about 15 fps). Fusing each camera's
  latest frame while it is under 250 ms old costs at most one interval of skew: 67 ms at walking pace (1.4 m/s) is
  about 9 cm, inside the 20 cm acceptance. Stepping only when some camera brings a new frame stops the Kalman filter
  from being fed the same frame repeatedly at the 60 Hz tick.
- **Gating:** the Hungarian solver (Haiku-written) originally dropped pairs over the gate only after solving. For
  gate 1, `[[0.1, 0.9], [0.9, 1.5]]` then gave one match (0.1 + 1.5, with 1.5 dropped) instead of two in-gate
  matches (0.9 + 0.9). Over-gate pairs are now forbidden before solving.

### What was done

- **`src/tracking/camera-model.js`**: `pixelRay(cam, px, w, h)` returns `{o, d}`, the camera centre and a unit
  direction in PSN metres, with the lens inverted.
- **`src/tracking/hungarian.js`** (new; Haiku-written, then reviewed and fixed): `assign(cost, gate)` is an e-maxx
  Kuhn–Munkres O(n³) solver for rectangular matrices. Infinity and over-gate costs are forbidden, so the result
  maximises in-gate pairs first and then minimises cost.
- **`src/tracking/fusion.js`** (new): the `Fusion` class plus pure helpers.
  - `observe`: turns a box into its feet point, head ray and distance from the camera.
  - `associate`: goes through the cameras in id order, Hungarian-matching each camera's feet points to the
    clusters built so far (gate 0.75 m, at most one box per camera per cluster).
  - `measure`: for two or more cameras, takes the least-squares point nearest all head rays as x/y and height. It
    refuses that point if the rays are under 8° apart, miss each other by more than 0.35 m, or put the head
    outside 0.9–2.5 m; it then uses an inverse-variance mean of the feet points instead. For one camera, it uses
    the feet point with sigma = 5 cm + 2 cm per metre of distance.
  - Tracks: one constant-velocity Kalman filter per world person. Clusters are matched to tracks by Hungarian on
    distance to the prediction (gate 1 m). A `camera:tid` key the track carried on its last step makes the match
    free (up to 2 m), which keeps ByteTrack's id continuity.
  - An unsupported track shows `predicted` and is dropped after 1 s (the OpenFollow rule).
  - Only boxes matched in the current sidecar step count as measurements; the sidecar's coasted boxes do not.
- **Tests**:
  - `tools/smoke/smoke-wo616-hungarian.test.js`: 7 tests (Haiku-written, plus the gate-before-solve test), checked
    against brute force on 200 seeded matrices.
  - `tools/smoke/smoke-wo616-tracking-fusion.test.js`: 12 tests.
  - Both registered in `run-offline-tests.js`.

### What was VERIFIED

- **Offline, synthetic stage** (`smoke-wo616-tracking-fusion`): a FOH camera at (0.3, −9, 4) with k1 −0.12 and a
  stage-right camera at (−9, 3, 5) with yaw 90 and k1 −0.05, 90° apart. Boxes are made by projecting each person's
  head top (1.75 m) and feet through the same camera model.
  - `pixelRay` matches `pixelToFloor` through the lens to 1e-9.
  - Three people at once are associated as the correct tid pairs.
  - One fused measurement is within 5 cm, with height 1.75 ± 0.05 m. The few-cm residual is the box-centre bias:
    the head and feet are 10 px apart in the side camera, the same as a real detector box.
  - Three walkers over 4 s at 15 fps: every fused position is under 20 cm off (the P4 acceptance number), with
    stable world ids.
  - Hidden from FOH for 1 s: tracked as `cam_2` with the same id and under 20 cm off, then `fused` again.
  - A ByteTrack id switch in one camera keeps the world id.
  - With no support the track goes `predicted`, is dropped after 1 s, and stale frames are not re-stepped.
  - Near-parallel cameras do not triangulate.
- Offline suite: 2746 passed, 1 failed (the known wo577), 2 skipped. Lint, Prettier and line limits are clean.
- **Not verified**: anything live. The engine is not wired yet (T10b), and the box has one physical camera.


## T10b — fusion wired: world persons drive the pin, WS `world` block, Godot P-tags (2026-10-19) — DONE (box-verified with a twin camera; two real cameras = owner QA)

### Investigation

- Before T10b, the pin (`detect-pin.js`) worked on camera persons: keys are `camera:tid` and positions come from
  `boxPoint`. With two cameras, the same person showed up as two candidates, and a ByteTrack id switch in either
  camera dropped the pin. The world id from T10a is the key that survives both.
- `detect-service` exposed only the fresh persons, with no `at` / `frame` / entry, so the fusion step had nothing
  to judge freshness or solve rays with. It needed a `frames()` view of the latest frame per watched, solved
  camera.
- Pin semantics that depend on the person shape:
  - "Matched this step" is `age_s <= 0`. Fusion's `age_s` was time since last support, so it read as coasting even
    in the step that measured it. It is now 0 for every track supported in the latest step.
  - A fresh pick takes the largest box. A world person has no box, so it carries `area`, the largest member box
    area.
  - Re-acquire uses picture distance ≤ 0.15. A world person is in metres, so it needs its own floor threshold.
- The box has one physical camera. For a live end-to-end run, a second tracking camera (`cam_2`) was added as an
  exact copy of `cam_1` on the same ch1 surface. Its rays are parallel to `cam_1`'s, so `measure` correctly uses the
  feet mean (`triangulated: false`), and the whole path (two sidecar feeds → association → tracks → pin → WS →
  Godot) runs live.

### What was done

- **`src/tracking/fusion.js`**: `measure` adds `area` (the largest member box area), carried through
  `_update` / `_spawn` / `persons()`. In `persons()`, `age_s` is 0 for tracks supported in the latest step.
- **`src/tracking/detect-service.js`**:
  - `frames()` returns `[{id, entry, at, frame, persons}]` for watched cameras with a solved `cam`.
  - The `solvedCameras` getter counts those cameras.
- **`src/tracking/detect-pin.js`**: accepts world persons `{key: 'w:<id>', camera: 'world', world: [x, y], area, age_s}`.
  - `centreOf` / `sizeOf` / `pointOf` pick world x/y (the marker z is kept for `top`, `planeZ` for feet) or the old
    box path.
  - Re-acquire after a world person is lost uses `REACQUIRE_MAX_FLOOR_M` = 0.75 m (the association gate) instead
    of the picture 0.15.
- **`src/tracking/register.js`**:
  - One `Fusion` instance, reset on boot and while detection is off.
  - The pin tick steps it with `_detect.frames()`. The pin is then fed world persons when two or more cameras are
    solved, and camera persons otherwise, so the one-camera behaviour is unchanged.
  - The `tracking:detections` snapshot gains `world: {fused, plane_z, persons}`. Persons keep their `marker`, and
    each camera person gains `world: <id>`. A camera person's `marker` is set either directly or through the
    pinned world person that owns its key.
- **Godot `tracking_view.gd`**:
  - Boxes of fused persons get a `P<id> · ` tag.
  - In a fused world, a world person that this camera does not currently see is drawn as a hollow ring at its
    floor point, through the camera's own lens-correct projection. It is tagged `P<id> · <source>`, and the pinned
    one is in its marker's colour, so the operator sees where the other camera has the person.
- **`detect_model.gd`**: the Detect status line appends `world: N (k seen by 2+ cameras)` when fused.
- **Tests**: `smoke-wo616-tracking-pin.test.js` gains 7 world-person tests (Haiku-written, reviewed):
  - the largest pick and stickiness;
  - re-acquire at 0.5 m accepted and at 1.0 m rejected;
  - `top` keeps z;
  - assist pull;
  - a coasting world person is not freshly picked.

### What was VERIFIED

- **Gates**:
  - Offline suite: 2753 passed, 1 failed (the known wo577), 2 skipped.
  - Godot `--test`: 1209 passed, 0 failed.
  - eslint, Prettier and the 500-line check are clean.
- **Box, live, twin camera** (`t9_pedestrians.png` still on 1-1000, replace pin on marker 1, feet):
  - **Fusion**: `GET /api/tracking/detections` gave `world.fused: true` and 10 world persons, every one `source:
    fused` with keys `cam_1:n + cam_2:n`.
  - **Pin**: on `w:5`, the largest area (0.156). World ids and positions held identical over 4 samples, about 6 s
    apart (the source is a still image, so v = 0).
  - **GUI**: boxes tagged `P1 · #0 86%` and so on. The status line read "Running — 10 persons 1 pinned world: 10
    (10 seen by 2+ cameras)".
- **Occlusion in one camera** (`cam_1` mask over the right half, `cam_2` unmasked):
  - **Fusion**: `cam_1` dropped to 5 persons. The other 5 kept their world ids and switched to `source: cam_2`.
    The pin stayed on P5, now seen only by `cam_2`.
  - **GUI**: hollow rings `P4 · cam_2`, `P5 · cam_2` (red, pinned) and others at their floor points. The status
    line read "world: 10 (5 seen by 2+ cameras)".
- **Restored**: mask off, `cam_2` removed. The snapshot went back to `world.fused: false`, and the pin went back to
  a direct `cam_1` person. The box is left with one camera.
- **Not verified**: triangulated height from two real, separated cameras. The box has one camera, so this is
  owner QA, or the T10d walk once a second camera is rigged.

## T10c — coverage view: tracking cameras + floor coverage on the 3D stage (2026-10-19) — DONE (box-verified in the GUI)

### Investigation

- The "Two-camera workflow" step 1 asks for each frustum on the 3D stage and the coverage overlap on the floor.
  Before T10c, the 3D stage (`previs_stage.gd`) had no tracking cameras at all. They existed only in the Camera view
  (`tracking_page.gd`), whose data loads only while the Inspector holds the page. The 3D mode therefore reads
  `Store.project.previs.tracking` itself, through `tracking_model.normalize`, and refreshes on
  `Store.project_changed`.
- Normalised cameras always carry a `cam`, so coverage includes uncalibrated cameras too. Typing a planned pose shows
  its coverage before the camera is rigged. This is the placement use.
- "Covered" has to mean what fusion needs: the person's feet (floor point) and head top (head ray), both inside the
  picture after the lens. A point past a barrel lens's fold radius is mapped back inside the frame by
  `apply_distortion`, so those points are refused before the raster test.
- A 1 cm lift made the footprint lines z-fight the floor plane from across the stage, so they drew dashed. 4 cm
  draws them solid.
- Fit framed only the stage objects, which left the cameras off-screen. While the coverage view is shown, Fit now
  includes the cameras and the grid.

### What was done

- **`godot/client/features/previs/tracking/coverage_model.gd`** (new, pure, PSN metres):
  - `seen` / `sees`: in front, before the lens fold, inside the raster after the lens. `seen` handles one camera's
    points in one projection pass.
  - `coverage(cams, grid)`: cells of 0.25 m, growing if a cell count would pass 40 000. Each cell gets a camera bit
    mask for "feet and head at 1.75 m seen", plus the m² seen by one camera and by 2+.
  - `separation` / `pairs`: the horizontal angle between cameras seen from the grid centre. 45° or more is
    advised; fusion triangulates only at 8° or more.
  - `ray` / `reach` / `frustum`: a lens-correct pixel ray, its floor hit or a 30 m reach, and the 4 picture corners.
  - `footprint`: the picture border on the floor, 16 samples per edge, split above the horizon.
- **`coverage_3d.gd`** (new, Node3D under the stage):
  - Per camera: the frustum and footprint lines in the camera's colour, plus a name label.
  - The grid outline, and cells tinted by the mask: one camera in its colour at α 0.22, two or more in green.
  - `summary` is a one-line verdict, for example "Grid 12 × 6 m — a standing person is seen by 2+ cameras on
    63 %, one camera on 37 %, none on 0 % · cam_1 ↔ cam_2 90° apart". Under 45° it adds the advice; with one camera
    it suggests adding a second. Percentages use cumulative rounding so they always sum to 100.
  - Rebuilt only when the cameras or grid change.
- **`previs_tab.gd`**:
  - A 3D-only toolbar toggle, "Tracking cameras", remembered in `ui.cfg`.
  - The verdict line sits under the 3D view.
  - It refreshes on `Store.project_changed` and on tracking page changes.
  - Fit / F frame the cameras and the grid as well while the view is shown.
- **Tests**: `godot/client/tests/test_tracking_coverage.gd`, 10 tests (Haiku-written, reviewed). They cover:
  - seen and unseen points;
  - single-camera, two-camera and twin coverage;
  - separation of 90° and of 0°;
  - `ray` against `unproject`, with and without the lens;
  - the floor reach and the far clamp;
  - the frustum, the straight-down footprint ring (65 points) and the horizon footprint;
  - the 200 m grid cap.
  
  Three tolerances are 1e-4 or 1e-6 because Godot's `Vector2`/`Vector3` are float32. This only affects drawing.

### What was VERIFIED

- Godot `--test`: 1250 passed, 0 failed. `--check` boots clean. Line limits are clean.
- **Box GUI** (3D mode, toggle on), with real `cam_1` (calibrated, upstage-high looking downstage) and a planning
  `cam_2` at (−12, 3, 6), yaw 90, pitch −25:
  - At FOV 70: both frustums are drawn and the whole grid is green. The verdict read "2+ cameras on 100 % … cam_1 ↔
    cam_2 90° apart".
  - At FOV 35: green overlap plus a `cam_1`-only blue band. The verdict read "63 %, one camera on 37 %, none on
    0 %".
  - Cross-check: an independent count with the server's JS camera model (`camera-model.js` `project` +
    `applyDistortion`, same 1152 cells) gave 62.5 % / 37.5 %.
  - Fit framed both cameras and the grid, the labels were readable, and the `cam_1` footprint was lens-bent.
- **Restored**: `cam_2` removed. The project holds `cam_1` only again, and the GUI is back in Camera mode.
- **Owner QA**: whether the verdict line and colours read well on the show stage, and a real second camera's
  placement.

## T10d — verification walk: walk a grid line, measure tracking against it, stamp the cameras (2026-10-19) — DONE (box-verified through the GUI; a real two-camera walk = owner QA)

### Investigation

- Workflow step 6 is "walk a known line and see how far tracking puts you off it". The two numbers worth having are
  the world position (fused when 2+ cameras see the walker) and each camera's own feet point. A gap between the two
  shows which camera's calibration is off.
- The walker has to be one person, followed by an id that survives ByteTrack id switches and occlusion. That is the
  T10a world id. The walker is picked as the first fresh world person within 1 m of the line, between its ends, and
  is then kept by id.
- Only persons measured in the latest fusion step (`age_s` 0) count. Coasting predictions are not measurements.
  Sampling is driven from `pinTick` after a fusion step that brought a new frame, so the rate is the detection
  rate. On the box that was about 15 samples/s.
- Box test source: layer 1-1000 plays `media/testowe/t9_pedestrians.png`, a still. Its world person P2 stands at
  (−3.599, 6.243), 24.3 cm off the grid's upstage edge (y = 6). That gives a known non-zero answer.
- **Found while verifying** (not T10d's to fix): Rewir-Light maps "·" (U+00B7) and "•" (U+2022) to **empty glyphs**.
  A Godot probe (`TextServer.font_get_glyph_contours`) gave 0 points for both, while "." has 12. Every " · "
  separator in the Godot client (about 20 files) therefore renders as a blank gap. A font fallback cannot help,
  because Rewir claims the codepoint. ↔ / → are truly absent from Rewir (`has_char` false). This is a follow-up unit.

### What was done

- **`src/tracking/verify-walk.js`** (new, pure):
  - `VerifyWalk.start({a, b, person?})` refuses lines shorter than 0.5 m and non-points.
  - `sample(snap)` records the walker's distance from segment a–b, each camera's own `floor` distance (camera
    persons whose `world` is the walker), the world source per sample, and which of 20 stretches of the line were
    walked.
  - `stop()` returns `{samples, duration_s, world: {n, mean_cm, rms_cm, max_cm}, cameras: {id: stats}, sources,
    covered, ok}`. The walk counts as `ok` from 10 samples. It auto-stops after 120 s.
  - Also exported: `segDist`, `stats`.
- **`src/tracking/register.js`**:
  - `pinTick` feeds the walk the `withPins` snapshot after a fusion step that stepped.
  - `GET /api/tracking/verify` returns `{running, live, result}`.
  - `POST` takes `{action: start | stop | reset}`. Stop stops first, then replies with the status, so the reply
    already says `running: false`.
- **Godot**:
  - `walk_model.gd` (new, pure — no autoloads, so the headless test runner can load it):
    - `lines(grid)`: the grid's 4 edges and 2 centre lines, walkable end to end.
    - `describe(status)`: the live line and the result text.
  - `walk_section.gd` (new): "Verification walk" in the Detect section under the masks, with a line picker,
    Start walk / Stop, Accept (enabled only for an `ok` result), and a 0.5 s poll while running.
  - `tracking_view.gd`: draws the chosen line in the camera picture in Detect mode, labelled "Walk: <name>".
  - `tracking_page.gd`: Accept stamps every tracking camera with
    `verified: {at, line, samples, world_rms_cm, rms_cm (that camera alone), covered}` and persists it. The
    calibration then carries when and how well it was proven.
  - `previs_tab.gd` pushes the line to the view.
- **Tests**:
  - `tools/smoke/smoke-wo616-verify-walk.test.js`: 11 tests (Haiku, reviewed), registered in
    `run-offline-tests.js`. They cover `segDist`, `stats`, start validation, the pick gate, keeping the walker by
    id, `age_s` filtering, per-camera stats, coverage bins, `ok` / too few samples, and auto-stop.
  - `godot/client/tests/test_tracking_walk.gd`: 10 tests (Haiku, reviewed), covering lines and offsets, and
    describe for idle, waiting, live, too few samples, the full result and null cm.

### What was VERIFIED

- **Gates**:
  - Offline: 2767 tests, 2764 pass, 1 fail. The failure is the known wo577 "library: main panel stays small…".
  - Godot `--test`: 1297 passed, 0 failed. `--check` boots clean.
  - Line limits are clean. eslint is clean. Prettier is clean on the CI scope (`tools/ci`) and on the new
    `verify-walk.js`.
- **Server, live on the box**:
  - A 0.2 m line returned 400 "the line must be at least 0.5 m long".
  - On the upstage edge [−6, 6]–[6, 6] it picked P2 at 24.3 cm. Stop replied with `running: false` and the
    result. Reset cleared it.
- **Box GUI**, Camera view → Detect, Inspector "Verification walk":
  - The line picker listed the 6 lines, and "Walk: Upstage edge" was drawn in the camera picture.
  - Start walk turned the button into Stop, disabled the picker, and showed the live line "Walking — P2 · 58 samples
    · 4.0 s · off the line: mean 24.3 cm · 5 % of the line walked".
  - Stop gave 304 samples in 20.8 s, `world` mean / RMS / max of 24.3 cm, `cam_1` alone 24.3 cm, source `cam_1`
    100 %, and `ok`.
  - Accept wrote `cameras[0].verified = {line: "Upstage edge", samples: 304, world_rms_cm: 24.3, rms_cm: 24.3,
    covered: 0.05}`, read back via `GET /api/project`. Accept then disables itself.
  - On the downstage edge, with nobody within 1 m, the GUI showed "step onto the line: waiting…", and Stop gave
    `ok: false`.
  - After the `walk_model` split and the `_toggle` fix (a ternary lambda had called the coroutines without
    `await`), Start and Stop logged no SCRIPT ERROR.
- **Restored**: the test `verified` stamp was removed from `cam_1`, because a still image is not a calibration proof.
  The walk state was reset.
- **Not verified / owner QA**:
  - A real walk, by a person, along a taped line, with two rigged cameras. The fused-vs-per-camera split only shows
    there.
  - The " · " separators in the status text render blank (Rewir glyph). That is a follow-up.
