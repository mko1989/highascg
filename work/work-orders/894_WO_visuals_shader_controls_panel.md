# WO-894 — Visuals ▸ Shader panel: the shader controls come back in the Visuals tab

**Area:** godot-client
**Status: OPEN (31.10.26, owner-approved design; implementation queued after WO-890 dynamic visual layers)**

## Owner request

Owner, 31.10: *"for shaders we were doing a special panel which in godot is non existent now. should be available in the visuals tab."*

## Investigation

File references are as found on 31.10.26; to re-verify at implementation.

- Server: the Shader Live session `src/shaderfx/shader-live-session.js` keeps a working copy of the GLSL per shader id
  and rewrites its literals when a control changes. Routes:
  - `GET /api/shader-live`, `GET /api/shader-live/shaders/:id`
  - `POST /api/shader-live/shaders/:id/:op`, with op = `set | macro | reset | preset | preset-save | preset-delete |
    pin | hide | unhide | label | randomize | wiggle | save`
  - `pushLive` sends the rewritten source to the Caspar CEF instances as a CG UPDATE.
- Old client: `features/live/shader_live_panel.gd`, with `shader_live_model.gd`, `shader_live_controls.gd` and
  `shader_live_stack.gd`. It had the key controls, presets, Randomize, Advanced, Save as child and Take. WO-883 removed
  its entry points, so nothing in the client reaches it now.
- The Visuals tab runs shaders natively through `features/visuals/shadertoy_rd.gd` (RenderingDevice, Texture2DRD).
  Its work area has 3D and Flow modes and no shader mode.

## Design (approved 31.10.26)

- Add a **Shader** mode beside 3D and Flow in the Visuals work area. It edits the selected shader layer (the per-layer
  stack from WO-890); which layer is picked works the same as the rest of the tab.
- The mode uses the server ops above: key controls call `set` / `macro`, and presets, pin / hide / unhide / label,
  Randomize, Wiggle, Reset and Save go through the same routes. No new server API.
- After each op, re-fetch `GET /api/shader-live/shaders/:id` and recompile the `shadertoy_rd` runner from the working
  cfg. Recompiles are throttled while a control is dragged; the last value always lands.
- Phase 2: turn the scanned literals into UBO uniforms, so a slider changes the value without a recompile. Phase 1
  ships with recompiles only.

## Acceptance / verification plan

- Shader mode lists the controls of the selected layer's shader from the working cfg. Every control the old panel
  showed is present: key controls, presets, Randomize, Advanced, Save as child, Take.
- Each op round-trips: a control change shows in `GET /api/shader-live/shaders/:id` and in the Visuals preview; a preset
  save then a reload restores the same values.
- Throttle: dragging one control produces no more than one compile per throttle window, and the final value renders.
- Selecting another layer shows that layer's shader, never the previous one.
- Godot suite green and `run-client.sh --check` clean; no file over the 500-line limit.
- Box: a probe client on a private Xvfb with `--tab=Visuals`. Drive one control and one preset, screenshot before and
  after, and confirm the Caspar CEF output updates (the CG UPDATE shows in the journal).

## Dependencies

- **WO-890** (dynamic visual layers, per-layer shaders): the panel edits the selected layer's shader. Implementation
  waits for it.
- **WO-883**: removed the old panel entry points. This WO brings the controls back inside the Visuals tab.
- Server `src/shaderfx/shader-live-session.js` and its routes: no change planned for phase 1.
