# WO-741 — VR: walk into the MVR scene and program lights from inside it (future)

**Status: DONE (24.10.26) as detachable future development — steps 1–2 built: the client flag `-- --xr` walks the
Previs at 1:1 and programs through the walk camera / a controller ray. Proven without a headset: Godot tests and a GUI
e2e in the sandbox (`run-gui-e2e.js --e2e=06_xr_walk --xr`: 4/4). The OpenXR (headset) path is built but untested:
no headset or runtime on any box. Step 3 (the Programmer panel inside VR) and step 4 are not built. See "How to
remove".**

Owner, 24.10: *"write it down for future. allow walking into the mvr scene and programing from vr. mostly for lights
preprogramming."*

## Investigation (what already exists)

- **The scene.** The Godot previs is native 3D: Forward+ renderer (`project.godot:32`, WO-607), with an orbit camera
  in `features/previs/previs_stage.gd`. It holds:
  - the MVR import: geometry, layers, and fixtures with their GDTF types (WO-612 / 636 / 643);
  - LED screens carrying the live channel texture (WO-634);
  - beams drawn from the fixtures' live values (WS `tracking:fixtures`, `gdtf-visual.js`).

  Standing inside the venue is "only" a different camera and different input.
- **Programming.**
  - The Programmer (`programmer_section.gd`, WO-615 T6) selects typed fixtures and sets intensity, colour, CTO,
    pan / tilt, zoom and gobo through `POST /api/fixtures/program`, coalesced to 20 Hz.
  - **Point at** aims the selected heads at a floor point through the server's follow IK. In VR that becomes
    "point the controller at the floor, pull the trigger".
  - **Looks** store the programmer's state per look (`look_fixtures_model.gd`, WO-615 T8: `project.fixtures.looks`).
    A PGM TAKE crossfades the rig to that look.
  - So preprogramming in VR = select + set + Point at + Store into a look. The API exists; the VR client needs
    no new server work for a first version.
- **Calibration** (WO-700 / 713) makes the digital beams land where the real ones do. VR preprogramming is only
  trustworthy on a calibrated or correctly patched rig. Without one, programming in VR is programming the model,
  which is exactly what preprogramming is.
- **Godot 4.7** has OpenXR built in (XROrigin3D / XRCamera3D / XRController3D, hand tracking, passthrough). No
  plugin is needed for the basics. Godot XR Tools (MIT) adds teleport / smooth movement and pointer interaction.

## Shape of the work (when it starts)

1. **XR mode in the previs.** An XROrigin3D replaces the orbit camera when a headset is present. The same stage
   nodes are used, so the MVR scene, beams and LED textures come for free. Movement: teleport plus snap turn, for
   comfort; smooth walk as an option. Scale 1:1, so the MVR's metres are real metres.
2. **Pick and aim.**
   - The controller ray selects fixtures, with a grip modifier adding to the selection, mirroring ctrl-click.
   - A trigger on the floor or a surface = Point at, using the same server IK route.
3. **A wrist / floating panel.** The existing Programmer UI rendered into a SubViewport on a quad, operated with the
   ray. It reuses `programmer_section.gd`, not a second UI (minimalism; one source of truth). It covers intensity,
   colour, zoom, gobo, Store to look and Release.
4. **Optionally, later.** Stand where the audience or a camera stands (presets from the MVR / tracking cameras), to
   check sightlines and how looks read from the house.

## Constraints and open questions

- **Never on the on-air kiosk.** The playout box's GPU and display serve Caspar and the operator GUI. VR rendering
  at 72–120 Hz per eye is a heavy, latency-critical load. The Godot client is already a network client (it can run
  on another machine against the server, as the Mac does), so VR should be a client on a separate PC or a
  standalone headset talking to the box's API. Programming over the LAN is what the Programmer already does.
- **Headset path, unverified.**
  - (a) A PC client with a tethered or streamed headset: SteamVR or Monado on Linux, WiVRn / ALVR for Quest
    streaming.
  - (b) A native Android/Quest export of the client, which raises questions about the native modules (shm
    surfaces, WO-594) and about video textures over the network instead of shared memory.
  - Choose after a hardware test.
- **Live LED textures** reach the previs through local shared-memory surfaces (WO-594/617). A remote VR client
  needs them streamed (NDI or the existing remote surface path, if any). Without that, screens show stills. That
  is acceptable for lighting preprogramming.
- **The beam look decides the value.** Volumetric beams, gobo projection and colour accuracy in the headset decide
  how far VR preprogramming can be trusted versus a real-light check. Test this before building past step 2.
- **Safety.** Programming from VR changes what the rig does when the DMX output is on. The same rules as the
  Programmer apply: DMX leaves the box only while the Fixtures DMX output is on. Offer a "blind" (previs-only)
  default in VR.

## What was done (24.10, /loop: "include the future development but try to make those easily detachable")

Steps 1–2 of the shape above, as a separate folder behind a client flag. The kiosk never starts with `--xr`, so it is
unaffected.

- **`godot/client/features/previs/xr/xr_walk_model.gd`** (new, pure):
  - `start_pose`: eye height 1.7 m, 8 m downstage, looking upstage;
  - `step`: walks along the floor at any pitch, diagonals no faster, 1.4 m/s;
  - `look`: pitch clamped;
  - `keys`: WASD;
  - `snap`: 30° per stick push, re-armed at centre;
  - `trigger`: a head under the ray (or the nearest) → pick, grip adds; no head with a selection → the floor under
    the ray → aim at PSN `[x, -z, 0]`; else nothing.
- **`godot/client/features/previs/xr/xr_walk.gd`** (new), a Node3D on the Previs stage:
  - `attach(stage)` finds the Previs tab (the ancestor with `fixtures3d` and `aim_drag`). The Live tab's read-only
    3D view, which also uses `previs_stage.gd`, gets no walk.
  - **No headset:** its own first-person Camera3D becomes current. WASD walks (shift x3), polled only while the
    Previs tab shows, no text field has focus and ctrl/cmd is not held (⌘D still duplicates). Left-drag looks and
    the wheel steps.
    - Because `previs_stage.camera()` returns this camera, all the existing mouse programming works through it
      unchanged: click a head, ctrl-click to add, right-drag onto the floor to aim, Point at.
  - **Headset:** when `XRServer.find_interface("OpenXR")` is initialised, which needs Godot started with
    `--xr-mode on` and a running runtime (no `project.godot` change, so the kiosk never tries OpenXR):
    - the stage's SubViewport gets `use_xr`, plus XROrigin3D, XRCamera3D and left/right XRController3D;
    - right `trigger_click` → `trigger()` along the controller ray, through a non-current Camera3D on the controller
      whose viewport centre is the ray, so the existing `fixtures3d.hit` / `near` work as they are;
    - pick → `Sel.shared().pick`, aim → `aim_drag.aim` (POST `/api/fixtures/program/aim`, one request in flight);
    - left stick walks along the head's yaw, right stick snap-turns.
- **`previs_stage.gd`**: 4 lines marked `WO-741`:
  - the `walk` var;
  - `attach` in `_ready` only if `Config.args.has("xr")`;
  - `handle_input` gives the walk first refusal;
  - `camera()` returns the walk's camera.
- **`godot/client/tests/test_xr_walk.gd`** (new): the model, the desktop node's input (look, wheel, eye height),
  `attach` in and out of the Previs tab, and the 4 hook lines pinned.
- **`godot/client/e2e/scenarios/06_xr_walk.gd`** (new) and one line in `tools/e2e/run-gui-e2e.js` (`--xr` passes
  `-- --xr` to the client). Without `--xr` the scenario has one step, "Not run".

**Why a camera swap, not a second picking path.** The previs already programs from a camera and a screen point. A
first-person camera reuses every existing tool (select, aim, Point at, the Programmer column) with no copy to keep in
step. The headset only adds the controller ray, mapped onto the same calls.

**Not built:**
- step 3, the Programmer as a panel inside VR (in a headset today you aim and select; the sliders are on the
  desktop);
- step 4, house / camera viewpoints;
- a blind (previs-only) mode. There is none in the server today. Aiming from VR is exactly what a right-drag does:
  DMX leaves the box only while the Fixtures DMX output is on. **Owner decision:** whether a VR session should force
  blind.

## How to remove (owner decision at the end)

- Delete `godot/client/features/previs/xr/`, `godot/client/tests/test_xr_walk.gd` and
  `godot/client/e2e/scenarios/06_xr_walk.gd`.
- Remove the 4 lines marked `WO-741` in `godot/client/features/previs/previs_stage.gd`. `camera()` goes back to
  `return _cam`.
- Remove the line marked `WO-741` in `tools/e2e/run-gui-e2e.js`, and its usage line in the header comment.
- No server, `project.godot` or data changes to undo.

## What was VERIFIED

- **Godot tests:** 21616 passed, 0 failed (`test_xr_walk.gd`: 5 tests, including the pinned hook lines).
- **GUI e2e in the sandbox** (`node tools/e2e/run-gui-e2e.js --e2e=06_xr_walk --xr`): **4 passed, 0 failed, no
  SCRIPT ERROR** in `godot.log`, on the real client under Xvfb against a sandbox server:
  1. The Previs renders through the walk camera, current, y = 1.7. The screenshot shows a first-person view over
     the stage floor (the sandbox has no MVR scene).
  2. Holding W 0.5 s walks upstage (z 8 → 7.28).
  3. A left-drag of 150 px turns the view (yaw < -0.2). The screenshot shows the floor edge turned.
  4. A right-press on the floor with a head selected sends `{"ids":["e2e-head"],"target":[2.28,-3.94,0]}`, which
     equals the floor point under that pixel through the walk camera. The request was captured in the client, not
     sent.
- **First run gave false PASSes.** `page` was a local that the step lambdas captured by value, so steps 2–4 hit
  null. `e2e_scenario.gd` counts a lambda that dies on a runtime error (it returns null) as a pass. I fixed the
  scenario (a member var), and the green above has no SCRIPT ERROR. **The harness weakness remains** (WO-719
  `step()`: `why == null` → ok); it is worth a follow-up.
- **Without `--xr`:** `--e2e=06_xr_walk,05_live_inputs` gave 4/4. 06 says "Not run", and the normal client shows
  no walk.
- `run-client.sh --check`: boot OK. Gates: repo-integrity, max-lines (0 over), unwired, boot, format, and test:ci
  3193 pass / 1 fail (WO-498, export-only, as always). Lint 214 (cap 216).
- **Not verified:** anything with a headset (OpenXR init, controller action names `trigger_click` / `grip_click` /
  `primary` from Godot's default action map, `use_xr` on a SubViewport, comfort). Needs a headset and a runtime
  (SteamVR / Monado / WiVRn) on a non-playout PC, per the constraint above.
