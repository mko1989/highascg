# WO-873 — Visuals engine: scene library with GPU particles, a second layer, burst triggers

**Area:** godot-client, engine, audio
**Status: DONE (30.10, Godot suite 23922/0 + Xvfb render probe screenshots and GPU ms per scene)**

Owner, 30.10: "Want you to also expand on the vj engine. Add particles etc."

Builds on [WO-863](./863_WO_visuals_tab_canvas_flow_send_to_screen.md) (Visuals tab: canvas, Flow, Send) and the WO-858 §6.1 scene-library
plan ([858](./858_WO_godot_audio_reactive_visuals_report.md)); audio from [WO-861](./861_WO_realtime_audio_parts_buses.md) /
[WO-872](./872_WO_beat_tracking_fosfora_comparison.md).

## 1. Investigation

- **One hard-wired scene.** `visuals_tab.gd:9,44` preloads `visuals_scene.gd`, which renders three rings of emissive MultiMesh bars. It
  also owns the camera and the WorldEnvironment (`visuals_scene.gd:34-45`). Its five parameters are fixed in `visuals_model.gd:5-6`:
  pulse, spin, hue, glow and flash. The Flow graph's Parameter node, the Inspector sliders and `params_of` all read that list.
  So a new parameter appears everywhere once it is in `PARAMS`.
- **Events cannot be expressed.** Every parameter is a level (base + Σ bound audio, `visuals_model.gd:107-130`), and nothing turns a
  hit into a one-shot. WO-858 §6 listed "Burst Particles" as the action an operator wants: "On kick → burst".
- **Renderer.** The client is Forward+ (`godot/client/project.godot:33`) on Godot 4.7.2 with an RTX PRO 4000 (20 % GPU, 0.8 of 24 GB in
  use at the time of writing). `GPUParticles3D` with turbulence, trails and sub-emitters is available. WO-858 §2 budgets
  0.3-2 ms per 0.1-1 M particles.
- **Persistence.** `project.visuals` is a client-owned slice (WO-863). `slice_of` fills every field, so new fields (`scene`, `overlay`)
  load with defaults in old projects.
- **Tests that pin the current shape.** `test_visuals_model.gd:83-91` checks that `tab.scene` is the output viewport's child and has
  `params`.

## 2. Design

- **Stage + scenes.** `visuals_stage.gd` owns the camera, the WorldEnvironment (glow, the hue-tinted background, flash) and the
  burst trigger. It hosts a **main scene and an optional second layer** in the same world, for example Tunnel + Particles.
  Scenes are content only, in `features/visuals/scenes/<id>.gd`, and each implements `step(params, delta, burst: bool)`.
- **Scenes:**
  - **Rings**: the WO-863 bars, moved.
  - **Particles**: a GPU particle cloud with turbulence. Amount sets the density, pulse the size and outward speed, spin swirls
    the cloud, speed sets the simulation rate. A burst fires a one-shot explosion of 6 000.
  - **Starfield**: stars streaming at the camera. Speed is warp, and a burst is a hyperspace kick that decays.
  - **Tunnel**: a shader on an inverted cylinder around the camera axis. Its own clock is integrated from speed on the CPU, so
    speed changes never jump the phase (the WO-580 lesson). A burst sends a bright ring down the tunnel.
- **Parameters**, shared by every scene and each interpreted in the scene's own way. The WO-863 five are joined by **speed**,
  **amount** and **burst**. Burst is the event parameter: a rising edge through 0.5 (re-armed below 0.3) fires the scenes' burst.
  So `kick → Shape → burst` in Flow is "on kick → burst". The Inspector also gets a **Burst** button for a manual hit.
- **Slice.** `project.visuals.scene` (default `rings`) and `overlay` (default none; equal to `scene` → none).
- The starter graph adds kick → burst, through the kick's Shape.

## 3. What was done

- `godot/client/features/visuals/visuals_stage.gd` (new, replaces `visuals_scene.gd`): camera, WorldEnvironment (glow,
  threshold 0.9) and up to two scene layers. `set_layers(main, overlay)` rebuilds only on change, maps an unknown id to rings
  and drops a second layer equal to the first. `burst_edge(v)` is the 0.5 / 0.3 hysteresis edge (plus `fire()` for the
  button); every frame each layer gets `step(params, delta, burst)`. The background tints to the opposite hue and flashes on
  a burst.
- `scenes/rings.gd` (the WO-863 bars, moved; speed / amount / burst added), `scenes/particles.gd` (40 000-particle
  `GPUParticles3D` cloud with turbulence + a 6 000-particle one-shot burst emitter; additive radial-sprite dots whose HDR
  albedo feeds the bloom), `scenes/starfield.gd` (box emitter 90 units out streaming at the camera, prewarmed; burst = warp
  kick), `scenes/tunnel.gd` (spatial shader on an inverted cylinder; travel and roll integrated on the CPU so a speed change
  never jumps the phase; burst = a ring launched from the camera down the tunnel). Every scene builds in `_init`, because the
  stage may step it before it enters the tree (the headless runner never calls `_ready` on detached nodes).
- `visuals_model.gd`: `PARAMS` gain speed / amount / burst; `SCENES` + `scene_ids()`; `slice_of` normalises `scene` and
  `overlay`; the starter graph links the kick's Shape to burst.
- `visuals_page.gd`: Scene and Layer 2 pickers and a Burst button (signals `scenes_changed`, `burst_pressed`).
  `visuals_tab.gd` stores them in the slice and fires the stage. Dev probe `--probe-visuals-shots=<dir>` renders each scene,
  measures the viewport's GPU time over 30 frames, fires a burst and saves a PNG.
- Why GPU particles and shaders, not more MultiMesh bars: particle counts in the tens of thousands cost nothing on the CPU
  (the WO-863 render path already runs at the PGM rate), and the burst event is the one thing the parameter set lacked —
  drums are events, not levels.

## 4. What was VERIFIED

- Godot headless suite: **23922 passed, 0 failed** (new `tests/test_visuals_stage.gd`: burst edge + hysteresis + manual
  fire, layer rules, every model scene stepped 40 frames with 4 bursts under a second layer; `test_visuals_model.gd`: the
  slice's scene / overlay normalisation, new-parameter defaults in an old project, the kick → burst starter link).
  `run-client.sh --check`: boot OK, no script errors.
- Render probe on a private Xvfb with the real GPU (RTX PRO 4000, Forward+), 1280×720, burst fired before each shot:
  rings 0.09 ms, particles 0.12 ms, starfield 0.13 ms, tunnel 0.12 ms, tunnel + particles 0.13 ms GPU per frame.
  Screenshots checked by eye: particles first came out a blown-out white core, so per-dot brightness, dot size and spread
  were lowered and reshot.
- Not proven: the scenes on a PGM screen over SHM (unchanged WO-863 path, scene-agnostic) and the look under live music —
  next on-box session.
