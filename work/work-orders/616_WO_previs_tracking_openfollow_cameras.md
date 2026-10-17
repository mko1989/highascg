**Status: OPEN (2026-10-17) — investigation + design written (from `next.md`); nothing implemented. Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Supersedes the *approach* of [WO-19](./19_WO_PERSON_TRACKING.md) (browser TF.js detection) and the Companion-only device path of [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) — both keep their goals; implementation moves here. Related: [WO-614](./614_WO_previs_stage_builder.md) (cameras + calibration points are stage objects), [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) (follow → fixtures).**

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

- [ ] T1 WO-597: surface roles `inN` (DeckLink input channel) and `chN`; lease + config; smoke.
- [ ] T2 Port camera math (DLT, homography, k1/k2, project/unproject) to GDScript **and** JS (server hub
      needs project/unproject for fusion) with OpenFollow's test vectors (bundled gallery calibrations
      `video/inputs/assets/*_default.toml` give known camera+grid pairs).
- [ ] T3 Godot: camera stage object, calibration wizard (3D pick ↔ 2D click), reprojection error display.
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
