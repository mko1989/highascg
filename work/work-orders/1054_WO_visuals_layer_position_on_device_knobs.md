# WO-1054 — Visuals: pan / tilt (position), size and rotation of the selected layer, on APC device knobs 5–8

**Area:** godot-client
**Status: IN PROGRESS (13.11 — design contract; build after WO-1053, same files)**

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

(to fill)

## What was verified

(to fill)
