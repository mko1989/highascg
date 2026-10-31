# WO-894 — Visuals ▸ Shader panel: the shader controls come back in the Visuals tab

**Area:** godot-client
**Status: IN PROGRESS (31.10.26, phase 1 implemented; verified by the Godot suite and a probe client on a private Xvfb against a stub node running the real Shader Live code; NOT yet on the live node: it needs a highascg restart for `?working=1`; no CG UPDATE journal line seen)**

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
- Server `src/shaderfx/shader-live-session.js` and its routes: no change planned for phase 1 (see Investigation: one additive field was needed).

## Investigation (31.10.26, at implementation)

- The working GLSL is **not on any route**: `GET /api/shader-live/shaders/:id` returns the view only (`src/shaderfx/shader-live-session.js:105-143`:
  controls, params, advanced order, `dirty`), and `GET /api/shaders/:id` is the library copy (`store.getShader`). The session's rewritten
  `cfg` lives in `sessions` (`shader-live-session.js:31`) and left the node only as `CG UPDATE` pushes (`pushLive`, :148). So "re-fetch
  the working cfg and recompile" needed one additive server field (below); everything else is the existing ops.
- The old panel's widgets are reusable as they are: `shader_live_controls.gd` calls only `ui.post_op / current_values / wiggle / rename`
  on its host (`key_control`, `param_row`), `shader_live_model.gd` is pure. The panel itself (`shader_live_panel.gd`) is tied to `Api`
  and Caspar instances (`_refresh_instances`, PRV Take, PGM stack, mixer rides), so it is not reused.
- `slider()` (`shader_live_controls.gd:12`) committed only on release or 150 ms after the last step: a drag would show nothing until
  release. Caspar's `wiggle` op needs a PRV instance (`shader-live-ops.js:180-181`, 409 "Load this shader on preview first").
- A recompile is `shadertoy_rd.gd use()` (glslang on the caller's thread); `scenes/shader.gd set_shader` reset `_time` on every call, so a
  recompile jumped the clock. `visuals_deck.gd stage_at(i)` is the layer i stage (slots follow `slice.layers`).
- `/api/shader-live/shaders/:id/:op` POSTs are `requireCaspar: true` (`routes-shader-live.js`, last route): with Caspar down the ops answer 503.
- Server quirk, not changed: `preset {original:true}` can leave one deep param "changed" (sh-chillwave-planet), so `dirty` stays true after
  Original; `reset` (Reset all) clears it.

## What was done

- `src/shaderfx/shader-live-session.js` + `src/api/routes-shader-live.js`: `workingOf(s)` and **`GET …/shaders/:id?working=1`** adds
  `working: {common, passes:{key:{source}}}` to the view (opt-in; op replies stay small). Deviation from "no server change": the working
  GLSL is otherwise unreachable. Smoke added to `tools/smoke/smoke-wo606-shader-live-server.test.js` (already in the curated list).
- `features/visuals/visuals_shader_sync.gd` (new): the wire. One op at a time; a still-queued value op (`set`/`macro`, same key) is replaced
  by a newer one; after ops landed, fetch the working copy, merge it over the library config (`GET /api/shaders/:id`: channels, opts), emit
  `compiled`. At most one compile per 350 ms while ops keep coming, the last value always lands (trailing compile). Work for a shader that
  was switched away is dropped.
- `features/visuals/visuals_shader_mode.gd` (new): the panel (key controls by section, presets bar with Original / presets / + Preset /
  Randomize, Advanced, Reset all, Save as child, edited marker, status line) built from `shader_live_controls.gd` / `shader_live_model.gd`.
  Follows the selected layer each frame (`sel`, else the top layer like the tab's `_target()`): another layer shows its own shader, a
  non-shader / empty / no layer shows a short note. A shader that already has live edits on the node compiles from them when picked.
  `recompile()` sets the new config on every layer running that shader (`stage_at(i).set_shader`). The wiggle button swings the value
  through `set` ops (Caspar's op needs a PRV). Left out on purpose: Take, the PGM stack and the Caspar-mixer rides (a Caspar PRV/PGM deck;
  the Visuals have the layer fader and Send).
- `features/live/shader_live_controls.gd`: `slider(…, live_ms := 0)` commits while dragging at most every `live_ms` (release still commits the
  last value); widgets read the host's `live_ms`. Default 0 = old behaviour.
- `features/visuals/scenes/shader.gd`: `set_shader` keeps the clock when the config has the same id; another id restarts.
- `features/visuals/visuals_tab.gd`: preload, `work.add_mode("shader", …)`, `set_shader_cfg()` (cache + recompile), probe flag (+~12 lines).
- `features/visuals/visuals_probe_shader.gd` (new) + flag `--probe-visuals-shader=<dir>[:<shader id>]`.
- `tests/test_visuals_shader_mode.gd` (new).

## What was VERIFIED

- Godot suite: `[tests] 24623 passed, 0 failed` (final run; two earlier runs showed unrelated failures in `test_tab_undock` (Previs) and
  `test_ui_fit` (fonts), not Visuals, not touched). `--check`: boot OK. `check-max-file-lines.js`: 0 over (tab is 463 lines).
  New tests (all pass): config merge; throttle (30 changes of one control give 2-3 compiles at least 100 ms apart, last value compiled, a
  queued op of a switched-away shader dropped); the mode follows the selected layer (sh-a then sh-b shows b's values, a tunnel layer a
  note, empty shader id a note, no layers a note); set compiles with the working GLSL, Reset all restores library values and redraws,
  Save as child names the child, a compile error is shown; `recompile()` hits only the layers of that shader and keeps its clock; live
  slider commits.
- Node: `node --test tools/smoke/smoke-wo606-shader-live-server.test.js` 9/9 (new: `?working=1` carries the rewritten GLSL, plain GET does
  not, library untouched, reset restores).
- Probe on a private Xvfb `:92` (own XDG_DATA_HOME copy, `--visuals-ring=probe894`, torn down by PID) against a stub on :4299 running the
  real routes/session/ops with an in-memory shader store, GETs proxied to :4200, other POSTs swallowed (project and live shaders
  untouched). sh-chillwave-planet, layer 1, Shader mode: a 20-change Zoom drag in 1 s = 5 compiles, no errors; Randomize and Reset all
  recompile; Reset all gives dirty false. Screenshots in
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/shots/`: `shader-1-before.png`, `shader-2-control.png`,
  `shader-3-random.png` (teal rim), `shader-4-original.png`, `shader-5-reset.png`, `canvas-strip.png` (the five canvases side by side).

## NOT verified / remaining

- The live node must be restarted once (`kill -TERM $(systemctl show -p MainPID --value highascg)`) so `?working=1` exists; until then the
  mode says to restart the highascg service instead of recompiling. Not done here (other agents probing).
- No `CG UPDATE` journal line seen: needs the shader on air in a Caspar look and a Visuals edit (the push path is unchanged server code).
- Owner QA on the box display; "preset save then reload restores values" is covered by the node smoke (WO-606), not re-run through the UI.
- Phase 2 (UBO uniforms, no recompile per value) untouched.
