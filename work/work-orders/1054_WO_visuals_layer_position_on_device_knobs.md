# WO-1054 — Visuals: pan / tilt (position), size and rotation of the selected layer, on APC device knobs 5–8

**Area:** godot-client
**Status: IN PROGRESS (13.11 — built; offline suite + compile boot green; on-air check pending)**

Owner, 13.11: *"i should be able to pan tilt the selected visual so i can position it where i want. there are 4 unused encoders
on the right."*

## Investigation

- APC device knobs (CC 16–23, `dev:1..8`) follow the selected layer: `visuals_midi_apc.gd page()`. A shader layer gets its
  key controls (`sm.key_controls()`, any count). Any other layer gets `FALLBACK` = Cam yaw, Cam pitch, Cam zoom, Burst, so
  **knobs 5–8 do nothing** (the owner's screenshot: four "—" knobs under Cam yaw / Cam pitch / Cam zoom / Burst). The device
  knobs are relative encoders (WO-912, `Pickup.turn`).
- Cam yaw / pitch / zoom are **global** `param:` values (the 3D scene camera), not a layer's place on the canvas. No layer has a
  2D transform. `visuals_layers.gd layer_of()` has no position fields. Each layer is a full-canvas render, drawn into its
  composite by a full-canvas TextureRect (`visuals_deck.gd _slot()`, `s.rect`).
- Device ◀ / ▶ (notes 58 / 59) are unmapped on the owner's unit (WO-1052 capture). They are free for paging.

## Design (contract)

1. **Layer fields** (`visuals_layers.gd`): `x`, `y` (canvas fractions, −1..1, 0 = centred: x = 1 moves the layer one full
   canvas width right, y = 1 one full height **up**), `size` (0.1..4, 1 = full canvas) and `rot` (degrees −180..180).
   Each is saved only when it differs from the default, so older shows stay byte-identical. **Not** part of `L.key()`, so a
   move never restarts the layer. `from_payload` keeps them when a visual replaces the layer (a pad swap keeps the place).
2. **Deck** (`visuals_deck.gd`): the slot's draw rect gets the transform: pivot at the canvas centre, scale `size`, rotation
   `rot`, offset `(x·W, −y·H)`. It applies in place on every `apply()` and also while a layer fades in or out. It applies in
   whichever composite the layer draws into: `out` or a WO-1051 / WO-1053 route-key composite. Areas uncovered after a move
   are transparent in the layer's own picture, so the black back (main) or transparency (route keys) shows.
3. **Inspector** (Visuals page): a compact **Position** block for the selected layer, with sliders X, Y, Size, Rotate and a
   **Reset** button. The sliders are real Range controls, so mouse, virtual controller and MIDI Learn all use them. Edits go
   through the tab's layer edit path (autosave + undo, live deck in place). The block is hidden when no layer is selected.
4. **Device knobs** (`visuals_midi_apc.gd page()`): **knobs 5–8 are always X, Y, Size, Rotate** of the selected layer.
   Knobs 1–4 hold the first four entries of the old page (shader key controls, or Cam yaw / Cam pitch / Cam zoom / Burst).
   A shader with more than 4 key controls: **Device ▶ / Device ◀** (notes 58 / 59, new defaults added to stored maps through
   `with_new_defaults` when free) page knobs 1–4 through the rest, 4 at a time. The page index resets when the selection
   changes. Knob rings, labels and pickup work as for every device knob (WO-909 / 912). The virtual controller labels show
   X / Y / Size / Rotate.
5. Encoder feel: a full knob turn should move about one canvas width or height for X / Y. Size steps are multiplicative
   (fine near 1). Rotate is 360° over about two turns. Choose the step sizes in the slider ranges / steps, and write them in
   the WO.

## What was done

- `features/visuals/visuals_layers.gd`: `PLACE` = {x, y: −1..1 (0), size: 0.1..4 (1), rot: −180..180 (0)}. `layer_of()`
  clamps numbers, ignores non-numbers / NaN, and stores a field only when it is not the default (an older show normalises to
  the same JSON). Not in `key()`. `from_payload(payload, keep)` copies the kept layer's place (pad swap, drop onto a layer,
  game ROM move). New helpers `place_of(l)` (full place with defaults) and `placed(l, place)` (merge + normalise, so a value
  back at its default drops out).
- `features/visuals/visuals_deck.gd`: `_place(s)` puts the layer's place on its draw rect (`pivot_offset` = canvas centre,
  `position` = (x·W, −y·H), `scale` = size, `rotation_degrees` = rot). Called for every slot and leaving slot in `_update()`
  (every `apply()`, every fade step) and in `resize()`. The rect is the same node in `out` or in a WO-1051/1053 route-key
  composite, so the transform follows it there; the slot is never rebuilt (no restart).
- `features/visuals/visuals_position.gd` (new, Inspector block): X, Y, Size, Rotate HSliders + a value read-out each, and
  Reset. `show_layer(l)` (hidden for none), `control("pos:…")`, `entries()` (device knobs 5–8; controls null while hidden).
  A slider move emits `edited(place)`; Reset emits the defaults.
- `features/visuals/visuals_page.gd`: the block (`page.place`) sits under the layer list's shader / game rows. It shows
  `layer_list.sel` (refreshed on selection and on every `set_state`). An edit becomes `layers_changed` with the selected
  layer `placed()`: the tab's existing layer edit path (slice, `_go(false)` in place, `_store()` → autosave + undo, the page
  refreshed). `visuals_tab.gd` is unchanged (498 lines).
- `features/visuals/visuals_midi_apc.gd`: `page()` = 8 entries. Knobs 1–4 = page `dev_page` (4 at a time) of the old list
  (shader key controls, else Cam yaw / Cam pitch / Cam zoom / Burst), padded with "—" (no control). Knobs 5–8 =
  `page.place.entries()`. `dev_page` goes back to 0 whenever `tab.sel` changes. `turn_page(±1)` (clamped) is driven by two
  hidden Buttons, which `control_of("devpage:prev|next")` returns, so MIDI presses them like any other button target.
  `can_page()` lights ◀ / ▶ only when there is a page in that direction. `label()`: "X" / "Y" / "Size" / "Rotate" for
  `pos:`, "◀ Keys n/m" / "Keys n/m ▶" for the arrows (virtual controller).
- `features/midi/midi_map.gd`: `pos` is a range kind and `devpage` a button kind. The default APC map gains
  ◀ Device (note 58) → `devpage:prev` and Device ▶ (note 59) → `devpage:next`, plus their names (and Dev on/off 62) in
  `apc_name`, and labels in `target_label`. `with_new_defaults` now treats a control as taken when a binding exists on that
  note on **any** channel (Learn binds on the control's own channel, e.g. ch 0; before, an ANY default was still added next
  to it).
- `features/visuals/visuals_midi.gd` (496 lines): `control_of` routes `pos` / `devpage` to the APC view; `targets()` adds
  `pos:x|y|size|rot` (MIDI Learn); `_load` passes `"devpage"` to `with_new_defaults`; `led_state("devpage:…")`.

**Step sizes (encoder feel).** An APC device knob moves its Range by 1/127 of the ratio per step (`midi_pickup.gd turn()`),
so the slider range sets the feel:
- **X / Y:** range −1..1, slider step 0.001. One encoder step is 0.016 canvas, and 63 steps (about one knob turn, if the
  APC counts ~64 steps a turn) move one full canvas width / height.
- **Size:** 0.1..4 with `exp_edit`, step 0.001. Each step multiplies by 40^(1/127) ≈ ×1.029: fine near 1, and the same
  feel at any size.
- **Rotate:** −180..180, step 0.1°. One step is 2.8°; 127 steps ≈ 356°, about two turns.

Every encoder step is much coarser than its slider step, so rounding never swallows a turn. The steps were measured
through the real MIDI path (see the tests below).

**Deviations from the contract:**
- The contract says "Device ▶ / Device ◀ (notes 58 / 59)". The APC layout (`apc40_layout.gd`) and WO-1052 have
  **◀ Device = 58** and **Device ▶ = 59**; that is what is bound.
- A positive `rot` turns the layer **clockwise** on screen (Godot's `rotation_degrees`). The contract does not say which
  way.
- The ◀ / ▶ page targets are hidden Buttons held by the APC view, not visible Inspector controls (minimal UI).
- `with_new_defaults`' check for a free control became channel-aware (see above). This also covers the WO-913/1052
  defaults.
- The base layer's tint (WO-945 `_backdrop`) still fills the whole canvas behind the stack. Moving the base layer
  uncovers that tint, which is near-black (`v` 0.02 + flash), not pure black. Turning the tint off when the base moves
  would make the whole tint jump on the first nudge.

Tests updated, because they pinned the old 4-entry page or the old default map size (as the contract requires):
- `tests/test_visuals_apc.gd`: the `dev:5 == null` assertion is kept. It is still true, because no layer is selected at
  that point; only its message changed. A new assertion checks that knob 5 = X after Sel 2.
- `tests/test_visuals_midi.gd`: the APC map size went from 64 to 66 (◀ ▶ Device).

## What was verified

All offline; not checked on air or on the real APC.
- New `godot/client/tests/test_visuals_layer_position_wo1054.gd` (7 tests). It covers:
  - Field clamping, defaults not stored, byte-identical JSON for an old layer, not in `key()`, `placed()`, and the place
    kept by `from_payload` / drop-onto (a new layer starts centred).
  - The deck rect: pivot at the centre, offset (x·W, −y·H), scale, 90° rotation checked through `get_transform()`.
    Changes apply in place (same vp / stage, no fade) in `out` and in a WO-1053 route-key composite ("overlay"), on a
    layer fading in, on one fading out (also after `step`), and after `resize`.
  - `page()`: 8 entries, 5–8 = X / Y / Size / Rotate. These have no control with no selection and are the block's sliders
    with one. Knobs 1–4 fall back for a non-shader layer. The virtual controller's knob 5 reads "X".
  - A 6-key shader pages with `handle_msg` notes 59 / 58, clamps at the ends, ◀ / ▶ lights follow, and the page resets to
    1 on a new selection.
  - Encoder steps via real CC 20–23 messages with `apc = true`:
    - X: one step ≈ 2/127 and 63 steps ≥ 0.95 canvas. The deck rect moved with no restart.
    - Y: up moves the rect up.
    - Size: one step ×1.025–1.035; 10 steps match 40^(10/127) within 0.01; back down to 1 ± 0.004.
    - Rotate: one step 2.5–3.0°, 63 steps ≥ 170°.
    - Only the selected layer moves.
  - The stored map gains ◀ ▶ Device when they are free, not when taken (on ch 0, or on ANY), with no duplicates on reload.
  - The Inspector block: hidden with no selection. A slider edit goes through the tab (slice + deck rect, same vp) and
    follows the selection. MIDI Learn targets. Reset brings the layer back to exactly `layer_of({scene})` and the rect to
    the full canvas.
- `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --test` (full suite): **[tests] 28368 passed, 0 failed**.
- `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --check`: `[check] boot OK (no script errors)`.
- `node tools/ci/check-max-file-lines.js`: none of the touched files is over 500 (visuals_midi.gd 496, visuals_tab.gd
  498 unchanged). The only file over is `src/api/routes-audio.js` (505), which was already over before this work and was
  not touched here.
- Smokes that read the touched files: `node --test tools/smoke/smoke-wo909-apc40-profile.test.js
  tools/smoke/smoke-wo908-visuals-ab-banks.test.js` → 8 / 8 pass.
- **Not verified:** on air, on the owner's APC, and how many encoder steps one physical turn really is. If it is not
  ~64, retune the ranges or steps.
