# WO-1000 — FragCoord custom uniforms as controls in Visuals ▸ Shader (sliders/colours, saved with the shader)
**Area:** godot-client, engine
**Status: DONE (08.11 — offline + Godot suites; live on the box: a FragCoord test shader's four controls drawn in Visuals ▸ Shader, values set over the session API recompiled into the stage picture, Save as child + preset persisted, screenshots; box left as found)**

Follow-up to [WO-999](999_WO_fragcoord_native_shader_runtime.md). FragCoord shaders declare their own controls:
`uniform float u_x; //default, [min, max]` becomes a slider in FragCoord's editor, and a vec3 in 0..1 becomes a colour.
WO-999 runs those uniforms, with each value in a UBO slot (`fragcoord_glsl.gd` `uniforms()`/`slot_values()`,
`cfg.values`), but nothing in the UI can change them.

## Investigation

- **The Visuals ▸ Shader panel shows literals only.**
  - `visuals_shader_mode.gd` draws what the node's Shader Live session sends (`src/shaderfx/shader-live-session.js`
    `view()`): key controls and params from `scanShaderCfg`, i.e. float literals inside function bodies.
  - The scanner masks comments, and a `uniform` line has no body literal, so the author's controls are invisible.
  - What the panel shows on a FragCoord shader is the auto-detected literals. Those work, because the sync merges the
    working GLSL over the library config (`visuals_shader_sync.gd` `merged()`) and keeps `dialect`, but each one
    recompiles.
- **The runner already supports value-only changes.** `fragcoord_rd.gd` `use()` compares `[common, passes,
  uniforms]` with the running key. When only `cfg.values` differs, it takes the values and compiles nothing, so a
  slider drag costs one UBO write per frame.
- **Persistence path.** The session's working copy (`s.cfg`) is what "Save as child" writes
  (`shader-live-ops.js` `saveChild`), and `normalizeFragcoordParts` keeps `values`. Values set in the session are
  saved with literal edits, with no new endpoint. Playback then reads the library config, which has the values.
- **Op routing.** `set` / `reset` look the key up in the literal params (`byKey`). A `u:<name>` key namespace for
  uniforms lets the existing widgets (`shader_live_controls.gd` `value_widgets`, which post `set {key, values}`)
  drive uniforms unchanged. The sync's per-key coalescing also applies.
- **Defaults must match the GPU side.** The view needs defaults and ranges. They must be parsed by the same rules as
  `fragcoord_glsl.gd` `uniforms()` (initialiser or `//d, [a,b]`; the last value fills a vector; no default → 0
  clamped into the range; common first, first declaration wins; built-ins and `u_passN` left out; at most 16 value
  slots).
- **Measured live:** `GET /api/shader-live/shaders/<a FragCoord shader>` returned `params: 0`, so before this WO a
  FragCoord shader had **no** controls at all in the panel. `scanShaderCfg` (client/lib) walks Shadertoy's
  `image`/`bufferA-D` keys only, never `main`/`passN`. The summary line still said "No obvious controls detected".
- **The store dropped curation on FragCoord shaders** (found while verifying). `normalizeShaderConfig`'s WO-999
  branch returned early, before `paramLabels`, `controls` (presets, pin, hide) and `parentId`. A preset on a FragCoord
  shader (`persistCuration` → `saveShader`) and a child's parent link were silently dropped on the next write. Live
  proof: `sh-fc-wo1000-test-c2.json` was saved with its values but `parentId: undefined`.
- **Open shaders with controls are rare on FragCoord.** A throttled scan of about 115 search results (audio,
  customizable, slider, palette, color, controls, music) found none that is openly licensed (MIT / CC0 / CC-BY)
  *and* declares a custom uniform. The ones with controls are "none" (all rights reserved) or NC. The live check
  therefore used a test shader written for this WO, deleted afterwards.
  - FragCoord answers HTTP 429 (`retry_after` 25 s) to a fast scan; the second pass waited 2.5 s per request.

## What was done

- **`src/shaderfx/fragcoord-uniforms.js`** (new):
  - `fragcoordUniforms(cfg)` is the JS twin of `fragcoord_glsl.gd` `uniforms()`, with the same regexes, order, skips,
    defaults, range clamp and 16-slot cap.
  - `uniformParams(cfg, pristine)` makes param-like rows with key `u:<name>`, current values over defaults, and
    `changed` against the library. Widget kind:
    - `color` for a vec3/vec4 in 0..1 (FragCoord's rule);
    - `toggle` for a bool;
    - `float` otherwise, with a step of 1 for ints. With no range, the slider runs from 0 to twice the value.
  - `setUniform(cfg, key, values | null)` validates the arity, clamps into the declared range, rounds int and bool, and
    writes `cfg.values`. `null` means back to the library's value.
  - It is a separate file so that `fragcoord-config.js` stays the library shape only.
- **`shader-live-session.js`**:
  - `open()` keeps `pristine.values`.
  - `view()` adds `uniforms`, and `dirty` counts them.
  - `workingOf()` carries `values`, so the Godot sync's recompile and Save as child both see them.
- **`shader-live-ops.js`**:
  - `set` / `reset` on a `u:` key change `cfg.values` only. No source rewrite and no CG push, because Caspar
    never runs FragCoord.
  - Reset all and Original restore the library values.
  - `preset-save` stores changed uniforms under their `u:` keys, and `preset` applies them (the rest go back).
  - No new endpoint: the existing widgets post `set {key: "u:…"}` and the sync's per-key coalescing applies.
- **`shader-store.js`**: the labels, controls and parentId block is now `curationOf(payload, id)`, used by both
  dialects. This fixes the dropped presets and parent link.
- **Godot:**
  - **`visuals_shader_sync.gd` `merged()`** copies the working `values` over the library's. `fragcoord_rd.gd` `use()`
    then sees an unchanged key and only refills the UBO slots, so a drag never recompiles.
  - **`visuals_shader_mode.gd`**: a "Shader controls" group comes first, with one row per uniform: ↺ reset, the name,
    then a slider, colour or checkbox. The rows are also first in `key_controls()` for the WO-909 MIDI knobs. The
    "No obvious controls" summary is hidden when the uniforms are the only controls.
  - **`visuals_tab.gd`**: a dev flag `--visuals-mode=<mode>` opens a Visuals mode at launch. I used it to check the
    panel on the owner's GUI without pointer automation.

## What was VERIFIED

- **Offline:** `tools/smoke/smoke-wo1000-fragcoord-uniform-controls.test.js` (curated, `offline-test-files-3.js`),
  6 tests:
  - parse parity, with the same cases as `test_fragcoord_glsl.gd`;
  - view rows;
  - set, clamp, round, wrong arity, unknown name, reset to the stored and to the absent value, and the source left
    untouched;
  - presets, Original, reset all, and Save as child with values;
  - the store keeping presets, labels and parent on FragCoord;
  - the Godot wiring greps.

  The shader smokes (WO-376/379/380/580/606/662/999, alpha binding) pass: 82/0. `run-offline-tests.js`:
  **5547 passed, 0 failed** (3 todo), exit 0. No files over 500 lines. ESLint is clean.
- **Godot:** `--test` **26119 passed, 0 failed**. The new `test_fragcoord_uniform_controls` covers `merged()` values
  and dialect, the "Shader controls" group, slider, colour and checkbox, current values, MIDI order, and no misleading
  note. `--check` boots clean.
- **Live** (node restarted twice; the owner's GUI relaunched with `--tab=Visuals --visuals-mode=shader`):
  - Test shader `sh-fc-wo1000-test` (rings; `u_rings [1,24]`, `u_speed = 1 [0,4]`, `u_tint` vec3 0..1,
    `bool u_audio_on`), on a Visuals layer via autosave, with no output ring.
  - The session view listed all four with kinds float / float / color / toggle and the declared ranges.
  - **Screenshot 1:** a "Shader controls" group with four rows, and the stage showing cyan rings at the defaults.
  - Set over the API: rings 18, tint (1, 0.3, 0.1), speed 0, then a relaunch. A layer picked with live edits compiles
    from them. **Screenshot 2:** 18 orange rings, still; the sliders at the new values; the changed names accented;
    "● edited, not saved".
  - **Screenshot 3** (after Save as child): the bool is a checkbox, there is no "no controls" note, and the original
    shader is back at its defaults (a save never overwrites).
  - Child files: `-c3` has `values {u_rings: 3}`, `parentId` and the "Wide" preset with `u:u_rings`. The root
    shader kept the preset through `persistCuration`. That is the store fix. Before it, `-c2` had lost `parentId`.
- **Left as found:** the three test shaders were deleted. The Visuals slice was set back to `null` as in WO-999; the
  project diff against the backup is empty. `projects/_trash` stayed at 1. The GUI was relaunched on Live, and the
  client log has no script or shader errors for any of the five launches.
- **Not covered:** a real mouse drag on the slider. `value_widgets` posting `set` is covered by the WO-894 tests,
  and the drag path is the same widget.

## Limits

- Literal controls ("Advanced") still don't see FragCoord passes (`scanShaderCfg` knows Shadertoy pass keys only).
  The author's uniforms are the controls.
- Randomize leaves uniforms alone. Wiggle (≋) is not offered on them.
