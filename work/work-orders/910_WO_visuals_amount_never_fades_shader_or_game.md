# WO-910 — Visuals: a bank's Amount hid every dropped shader (and game) — the layer fader is their only opacity

**Area:** godot-client
**Status: DONE (31.10.26 — Godot suite 25490/0; probe client on a private Xvfb behind the read-only proxy + the owner GUI: shader layers draw at their fader's opacity)**

## 1. Investigation
- Box, owner GUI, 31.10 (A/B on so bank A stayed on air): the project's shader layer "3D Audio Visualizer" made visible at
  100 % in PRV B → PRV black; replaced by "Warp speed" (double-click in Sources ▸ Visuals) → still black. The Shader mode
  loaded the shader's controls, no compile error, no layer note.
- Reproduced in an isolated probe client (`--probe-visuals-shader=<dir>:sh-sa-warp-speed`, Xvfb :93, scratch
  XDG_DATA_HOME, `HIGHASCG_SERVER` → `tools/dev/readonly-proxy.js` so no write reached the box): black, with A/B on and with
  A/B off — so not WO-908. The same probe rendered shaders at WO-894 (13:17) — but then on the stub project's params.
- `features/visuals/scenes/shader.gd step()`:
  `_mat.set_shader_parameter("opacity", clampf(float(p.get("amount", 0.5)) * 2.0, 0.0, 1.0))` — **amount = opacity**, from
  WO-874, when a shader was the main scene or "layer 2" and amount was the only way to fade it. `amount` is one parameter
  per bank shared by every layer; for the other scenes it is a density (particles `amount_ratio`, starfield stars, rings
  lit bars, tunnel spokes, spectrum bars). The owner's bank has it at ≈ 0.03 (sparse particles) → every shader drew at ≈ 6 %.
  Since WO-890 each layer has its own opacity fader (`visuals_deck.gd`), so amount-as-opacity is a second, hidden fader.
- The Game scene had the same line (found the same afternoon, fixed under WO-876 §4).

## 2. What was done
- `scenes/shader.gd`: amount is not used; the `opacity` uniform is gone (`ALBEDO = c * gain + flash`). The layer's fader
  is the shader's opacity. Header comment says why.
- (`scenes/game.gd`: same, WO-876 §4.)
- Behaviour change to note: a saved look that faded a shader with a low amount now shows it at its layer fader's opacity.

## 3. Verified
- Godot suite 25490 passed, 0 failed; `test_shadertoy_glsl.gd test_shader_scene_headless`: after a step with amount 0 the
  material has no opacity term.
- Probe client (same command as above, 54 POSTs swallowed by the proxy): Warp speed renders (before / Randomize shots:
  the teal-pink warp), Shader mode 20-change drag = 5 compiles, Randomize, Original, Reset all OK.
- Owner GUI relaunched with the fix: A/B on, 3D Audio Visualizer visible at 100 % in PRV B → drawn (the lit cube room). With
  it, WO-894 on the live node: Iterations 30 → 1.1 → 19.3 recompiled through `?working=1` (server `dirty: true`, the picture
  changed), Reset all → `dirty: false`; A/B off → stored project back to the owner's two layers at 0 %, no `dj`.
