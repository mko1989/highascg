# WO-657 — Look editor: Fit (zoom) and Mirror copy

**Area:** godot-client
**Status: DONE (2026-10-21, Godot tests 20745/0; box: Fit snaps a 3-notch zoom back; Mirror copy L11 x 961 → L12 x 859)**

Owner 21.10: "fit button, copy with "mirror" image, meaning if the original layer is on the left the layer will be
coppied on the right" — then "not this fit. fit the zoom after zooming in out".

## Investigation

- WO-654 zoom had only a middle double-click to get back to the fit view — not discoverable.
- The layer inspector's Content sizing already has "Fit canvas" (server refit); a first attempt wired Fit to it, the
  owner corrected that within minutes — Fit means the VIEW. That wiring was reverted before commit.
- Mirror has to use what Caspar shows: with aspect lock + native/fit the clip is contain-fitted at the fill's top-left
  (WO-653), so mirroring the raw fill would misplace the visible clip. Mirroring the shown width keeps it exact,
  because the server re-applies the same anchoring to the copy.
- `look_editor.gd` is at the 500-line cap → new pure helper.

## What was done

- New `godot/client/features/live/look_layer_ops.gd` (pure): `next_layer_number` (web `nextLayerNumber`: lowest free
  10–99, -1 full), `mirror_copy(layers, layer, shown)` (deep copy, next number, visible — cropped — rect's x flipped
  about the centre line: x' = 1 − x − w on the shown width, crop kept, rotation negated) and `layer_name` (moved out
  of look_editor.gd `_name` / `_short` to make room).
- `look_editor.gd` buttons row: Remove layer · ▲ Up · ▼ Down · **Fit** (`_view.reset()`) · **Mirror copy**
  (`_mirror_copy`: appends the copy, selects it, PRV push) · Crop · Reset crop. File stays at 500 lines.
- New `godot/client/tests/test_look_layer_ops.gd`.

## What was VERIFIED

- `--check` OK, `--test` 20745 passed / 0 failed.
- Box (on "Look 1 (copy)", not the owner's Look 1): select L11 (x 961, w 1252) → Mirror copy → L12 at x 859 in the
  autosave (3072 − 961 − 1252), shown on PRV; 3 wheel notches in → Fit → back to the full frame. The test L12 was
  removed again (autosave layers 10, 11).
- Owner QA: mirror a layer that sits clearly on one side; a rotated / cropped layer.
