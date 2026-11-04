# WO-945 — Visuals: removing the bottom layer flashed it for a frame

**Area:** godot-client
**Status: DONE (04.11.26 — mechanism probed on the box's GPU, Godot suite 25779/0 (+1 test, 1 assertion moved to the new contract), boot check OK; deployed to the second dev box's client: bottom-layer removal recorded at 60 fps, 0 frames with the removed layer) — owner QA on the glass**

Owner 04.11 (second dev box): *"when removing a visual from first layer while there is another one playing on a second layer results in a brief flash of the visual from first layer"*, then *"removing the bottom layer gives the glitch, not the top one."*

Related: [WO-890](./890_WO_visuals_dynamic_layers_opacity.md) (the layer stack and its base), [WO-873](./873_WO_visuals_scene_library_particles.md) (the stage's tinted background).

## 1. Investigation

- `features/visuals/visuals_deck.gd` (WO-890): each layer renders alone in its own SubViewport; the bottom one is the **base**. `_order()` set `slots[i].vp.transparent_bg = i != 0` — the base opaque (its world draws the hue-tinted, audio-flashing background, `visuals_stage.gd` `_env.background_color`), every other layer transparent.
- Removing the **top** layer: the base stays the base, nothing flips; the removed layer fades out over the stack (`leaving`, at its old place). Recorded on the box at 50 fps: a clean 1 s crossfade.
- Removing the **bottom** layer: the layer above becomes the base, so its running viewport flips `transparent_bg` true → false, while the removed old base keeps drawing underneath at full weight (its fade-out has just begun, at `at` 0, under the new base).
- **Probe** (standalone Godot 4.7.2 project on the box's display: a red quad in a SubViewport, transparent_bg flipped at frame 10, centre pixel of its texture read every frame): frames 4–9 `(1,0,0,1)`, **frame 10 `(0,0,0,1)`**, frames 11+ `(1,0,0,1)`. A SubViewport draws nothing on the frame its transparent_bg flips. That frame the new base showed nothing and the layer leaving under it came through — the owner's flash. A move ▲▼ into / out of the bottom slot flipped a viewport the same way.

## 2. What was done

- `visuals_deck.gd`: no viewport's `transparent_bg` ever changes — every layer world is transparent from `_slot()` on (`_order()` only calls `set_base`, which still drives a game layer's overlay mode). New `_backdrop()` (every `step`): the black backdrop `_back` takes the base's tint × the base's effective opacity (`s.a`, kept by `_update`) — what the opaque base world gave, the base fader still dimming it to black.
- `visuals_stage.gd`: the tint (hue + flash) is computed into `bg_tint` (base only, else black) instead of the environment's background colour, which stays black.
- Why not keep the opaque base and hide the flip (defer it past the fade, snapshot the texture): every variant still shows one empty frame of the new base at some moment (over black when nothing is left under it); a world that never flips has no such frame. The tint never bloomed (glow threshold 0.9), so drawing it in 2D behind the stack is the same picture.

## 3. What was verified

- Godot suite **25779 passed, 0 failed**. `test_visuals_layers.gd`: `test_deck_edits_in_place` now pins every world transparent (was: base opaque — the old contract); new `test_removing_the_bottom_layer_flips_no_viewport`: the top layer becomes the base with its viewport untouched, the removed bottom fades out below it on a transparent world, the backdrop = the new base's tint at its 50 % opacity. `run-client.sh --check`: boot OK.
- **Box:** deployed `visuals_deck.gd` + `visuals_stage.gd`, client restarted. A single layer (Electric Sinusoid) looks as before. Fly by Night (top) over Electric Sinusoid (bottom), ✕ on the bottom, canvas recorded at 60 fps for 3 s: **0 of 180 frames** with Electric Sinusoid's cyan (> 20 px). A capture can miss a single frame, so the owner's eye is the last check.
