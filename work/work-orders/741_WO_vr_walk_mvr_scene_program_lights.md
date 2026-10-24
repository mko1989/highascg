# WO-741 — VR: walk into the MVR scene and program lights from inside it (future)

**Status: OPEN — future development, noted 24.10.26. Nothing built. The investigation below is from the code; the
headset and runtime notes are from general knowledge and have not been tested on any box.**

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

## What was done

- Nothing built: noted for the future at the owner's request.

## What was VERIFIED

- Nothing yet. The facts about existing code above were read from the files cited.
