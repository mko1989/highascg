# WO-890 — Visuals: dynamic layer stack with a per-layer opacity fader

**Area:** godot-client
**Status: DONE (31.10.26 — Godot --test 24245 passed / 0 failed, --check boot OK, line limit OK; probe client on Xvfb :88: drop on canvas adds a layer, fader / Add / mute / reorder / drop-on-row replace shown in screenshots; project `visuals` slice restored and verified by GET)**

Owner 31.10: "we need an ability to dynamically add visual layers and have an opacity fader for each layer added.
similar to looks editor."

## Investigation

Before this WO the Visuals canvas had a fixed pair, main + "Layer 2", rendered in **one** 3D world:

- `visuals_stage.gd:59` `want(main, overlay)` / `:67` `set_layers(main, overlay)` (HEAD): at most two scene nodes in
  the stage's single World3D. `:75-76`: the main scene is told it is an overlay when a second one exists.
- The layer-2 look came from each scene's own overlay mode, not from compositing: `scenes/shader.gd:55-58`
  `set_overlay()` switches the fullscreen quad to `blend_add, depth_draw_never, depth_test_disabled`, and
  `scenes/game.gd:73` keys the game's black out. So layer 2 was always additive (shader) or keyed (game), it had no
  opacity, and depth decided coverage for the 3D scenes (a tunnel's walls hide anything inside it whatever the order).
- `visuals_mixer.gd:79` `go(main, overlay, shader_cfg, seconds, force)` (HEAD): one shader config per stage, so only
  one shader could run. `:81` skipped the A/B swap when `ids() == want(main, overlay)`.
- `visuals_page.gd:17,19,54,65,205` (HEAD): two fixed rows, "Scene" and "Layer 2", each a drop target
  (`visual_dropped(payload, overlay: bool)`).
- `visuals_catalog.gd:109-122` (HEAD) `apply_drop(slice, payload, overlay)`: the slice holds one `scene`, one `overlay`,
  one `shader` and one `game`, so a second shader replaced the first.
- `visuals_looks.gd:8` (HEAD) `KEYS := ["scene","overlay","shader","game","params","graph"]`: looks capture the pair.
- `features/live/visuals_sources_panel.gd:204-209` (HEAD) `_mark()`: the live highlight checks only `scene` and `overlay`.
- `src/engine/project-client-slices.js:15`: `visuals` is already in `CLIENT_OWNED_SLICES` (WO-863), so web autosaves keep
  the whole Godot slice, including a new nested key. The server does not read `project.visuals` otherwise.

So the fixed pair could not grow to N layers, and opacity could not be bolted onto it: in one world there is no
per-scene alpha, and the order is decided by depth, not by the list.

## What was done

### Design: one world per layer, composited in 2D (`features/visuals/visuals_deck.gd`, new)

Each layer is a `Stage` (camera, environment and glow, burst, audio smoothing; `visuals_stage.gd`, unchanged API) running
**one** scene in its own `World3D` inside its own `SubViewport`. The deck's `out` SubViewport draws them bottom to top
over black, each as a `TextureRect` with a tiny canvas shader:

- `normal` uses `blend_premul_alpha` with `COLOR = tex * opacity`. Opaque content covers the layers below it, and the
  black around it plus the bloom add on top.
- `add` uses `blend_add` with `COLOR = vec4(rgb, opacity)`.

The bottom layer is the base: it is opaque and has the hue-tinted background and flash (`Stage.set_base`). Every
other layer renders with `transparent_bg` on a black background, and a game layer keys its black out (overlay mode).

Why this over one world: the list order becomes the drawing order, and the fader becomes a plain alpha, for any scene
(3D, shader or game). Each shader layer gets its own runner, so N shaders can run at once. The cost is one render
per layer, so the stack is capped at 8 (`visuals_layers.gd MAX`), and muted or 0% layers do not render at all (the
viewport is `UPDATE_DISABLED` and the stage `_process` is off).

**Edits happen in place.** Slots are matched by `key` (scene|shader|game), so unchanged layers keep running with no
restart and no shader recompile. A new layer fades in over `fade`. A removed or replaced layer fades out at its old
place, then is freed. A fader, mute or blend change takes effect at once.

### A/B crossfades kept (`visuals_mixer.gd`, rewritten)

The two decks are `Deck` nodes, and the MIX shader is unchanged. `go(layers, cfgs, seconds, force)` works in two ways:

- Without `force` (a drop, a fader, mute, order or removal), the live deck edits in place.
- With `force` (a look recall, the autopilot), the idle deck loads the whole stack and the decks crossfade.

The idle deck is cleared and renders nothing.

### Model (`visuals_layers.gd`, new, pure)

`project.visuals.layers` is a bottom-to-top list of `{scene, shader?, game?, label?, opacity 0..1, visible, blend}`.

- `normalize()` keeps known scenes only, at most 8, and one game layer: a game is one window and one ring, so a second
  game layer would show the same picture.
- `migrate()` turns an old `scene`/`overlay`/`shader`/`game` slice (or a saved look) into layers. An old layer-2
  shader becomes `blend: "add"`, because it was additive before (WO-874).
- `compat()` derives the old fields from the layers. `visuals_model.gd with_layers()` writes them next to `layers`, so an
  older client or other consumer still sees the bottom two layers.
- `drop()` has two cases. A target of -1 adds a new layer on top. A layer index replaces that layer's picture and keeps
  its fader, mute and blend. A game dropped while a game layer exists changes or moves that layer. When the stack is
  full, the drop is refused with the note "8 layers is the limit — drop onto a layer to replace it".

### Inspector: layer list like the Look editor (`visuals_layer_list.gd`, new; `visuals_page.gd`)

The list shows the top layer first. Each row has:

- an eye button to mute the layer
- the layer's name (⚠ plus a tooltip when its shader does not compile)
- an **Add** toggle for the blend
- ▲ / ▼ to reorder, and ✕ to remove
- an opacity HSlider plus a % SpinBox. The SpinBox follows RULES.md through `core/numeric_field.gd`: select on focus,
  maths, gibberish reverts. The slider is `FOCUS_NONE`, so the show keys stay show keys.

Clicking a row selects it (accent border). Rows are rebuilt only when the stack's keys change, so a dragged fader is never
torn down under the pointer.

### Drops (`visuals_catalog.gd apply_drop`, `visuals_tab.gd`)

- **Canvas drop:** a new layer on top. With Shift, it replaces the selected layer (or the top layer if none is selected).
- **Drop on the list:** a new layer on top. **Drop on a row:** replaces that layer.
- **Sources double-click:** replaces the selected layer (or the top one), or adds a first layer to an empty stack. The 3D
  view's orbit camera looks into the selected layer's world.

### Looks, Auto, fade (`visuals_looks.gd`)

`KEYS = ["layers","params","graph"]`. capture/apply/normalize also write the compat fields. Old looks migrate on
`normalize` through `slice_of`. Recall and the autopilot use the `force` path, so the whole stack crossfades. Look
names now come from the layers, e.g. "Tunnel + Ribbons + Particles", or "… + N more".

### Sources highlight (`features/live/visuals_sources_panel.gd`)

`_live` is the layer list, and `_mark` uses `Layers.runs()`, so every layer's visual is highlighted.

### Probes and tests

- `visuals_probes.gd`: shots, shaders, onair, autopilot and ring use stacks. The shots probe adds a four-layer case and
  reports the deck's `gpu_ms()`.
- New `tests/test_visuals_layers.gd` (8 tests): normalize/migrate, slice round-trip with compat, drop rules, the `runs`
  highlight plus the panel, the deck editing in place with two shaders in parallel, the layer list's rows and signals,
  and looks keeping the stack.
- Updated tests: `test_visuals_catalog.gd`, `test_visuals_show.gd`, `test_visuals_model.gd`.

## What was verified

- `./run-client.sh --test`: **24245 passed, 0 failed**. One earlier run had an unrelated flaky failure in
  `test_previs_quality::test_led_shader_aa_follows_the_level`, from concurrent WO-892 work; it was green on the final run.
- `./run-client.sh --check`: boot OK. `node tools/ci/check-max-file-lines.js`: 0 files over 500
  (`visuals_tab.gd` is 492, close to the limit).
- I ran a probe client on a private Xvfb :88 (`--tab=Visuals --sources-tab=4`) and drove it with xdotool on :88 only.
  The screenshots are in the session scratchpad `wo890/`:
  - `01-start.png`: the owner's old slice migrated to two layers, "Particles" over "Shader · 3D Audio Visualizer".
  - `02-drop-canvas.png`: Ribbons dropped on the canvas becomes a third layer on top. It is selected and highlighted in
    Sources.
  - `03-opacity.png` / `04-grid.png`: the Ribbons fader at 39%; the particles show through.
  - `05-add.png`: Add blend on.
  - `06-mute.png`: Particles muted (eye_off, dimmed name, not rendered).
  - `07-reorder-filter.png`: ▼ moved Ribbons under Particles, and the selection followed.
  - `08-replace-row.png`: Sources ▸ Tunnel dropped on the bottom row replaced the shader layer with Tunnel (100% kept,
    row selected). The stored slice showed `layers` = Tunnel / Ribbons (0.39, add) / Particles (muted), and the compat
    fields were `scene: tunnel, overlay: shader, shader: sh-sa-ribbons`.
- Project restore: the probe autosaves the live project. The `visuals` slice saved before probing was POSTed back to
  `/api/project/autosave` (rev 465 to 466), and a GET returned it byte-identical. It was re-checked 8 s later and was
  still identical, with no `layers` key. The next new client to load it migrates it to [shader, particles].

### Not verified / owner QA

- GPU cost per layer on the real output was not measured; on Xvfb it is not representative. Use
  `--probe-visuals-shots=<dir>` on the box display for per-deck `gpu_ms`, which includes a four-layer case.
- I did not do an on-air (Send) check through Caspar with a multi-layer stack, beyond the existing probe code paths.
- In a mixed-version session, an older client sees only the compat fields (the bottom two layers). If it autosaves, it
  writes a slice without `layers`, and the new client then re-migrates from the old fields, so layers 3 and up are lost.
