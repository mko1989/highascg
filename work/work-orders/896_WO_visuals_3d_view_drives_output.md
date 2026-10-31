# WO-896 — Visuals 3D view drives the output: the orbit camera reaches the program

**Area:** godot-client
**Status: OPEN (31.10.26, owner-approved design; implementation queued after WO-890 dynamic visual layers)**

## Owner request

Owner, 31.10: *"the 3d view of the visuals has no effect on the actual output."*

## Investigation

File references are as found on 31.10.26; to re-verify at implementation.

- The Visuals tab's 3D view is an orbit view. It moves only the **editor** camera.
- The output stage, `features/visuals/visuals_stage.gd`, has its own camera. The mixer decks in
  `features/visuals/visuals_mixer.gd` render through that stage, so they never see the editor orbit.
- Result: the operator can orbit the 3D preview, and the program output stays fixed.
- The shader backdrop quad is not known to follow the stage camera (to verify at implementation; the Design below
  requires it to).
- Flow (`features/visuals/visuals_flow.gd`) drives values over time; whether it can reach a camera parameter is to
  verify at implementation.

## Design (approved 31.10.26)

- Add an option to make the orbit camera **drive the output stage camera**. When on, the stage camera copies the
  editor orbit each frame; when off, the output stays where it is.
- Store the choice and the camera pose **per look** and in the visuals params, so a saved look reproduces its framing.
- Optional: audio-driven orbit. Flow parameters (`visuals_flow.gd`) drive yaw, pitch or distance of the stage camera,
  so the output moves with the music.
- The shader backdrop quad follows the stage camera, so the shader fills the frame from any angle the camera reaches.

## Acceptance / verification plan

- Orbit the 3D view with the option on: the program output (the mixer preview of the stage) changes framing to match.
- Option off: orbiting changes only the editor view; the output stays fixed.
- Save a look with a camera pose, switch away, switch back: the output returns to the saved framing.
- Audio-driven orbit: with a Flow parameter bound to yaw, the output moves with the audio and stops when the binding is
  removed.
- The backdrop quad stays covering the frame at extreme orbit angles (no edge showing).
- Godot suite green, `run-client.sh --check` clean, no file over 500 lines.
- Box: probe client on a private Xvfb with `--tab=Visuals`; set the option through the probe, orbit by script, and
  screenshot the output stage before and after.

## Dependencies

- **WO-890** (dynamic visual layers, per-layer shaders): the camera and backdrop act on the layer stack. Implementation
  waits for it.
- **WO-877** (mixer decks in the Visuals stage): the decks render through `visuals_stage.gd`, so the camera change must
  reach them.
- Flow (`features/visuals/visuals_flow.gd`): needed only for the optional audio-driven orbit.
