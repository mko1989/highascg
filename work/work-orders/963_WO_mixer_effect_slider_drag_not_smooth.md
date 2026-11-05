# WO-963 — Mixer-effect slider (Brightness) cannot be dragged smoothly

**Area:** godot-client
**Status: DONE (05.11, unit test + full suite 0 failed + GUI e2e 19_wo963 on a throwaway real Caspar; owner QA of the feel on the box)**

Owner: "i cant set brightness of a clip from mixer effects smoothly by draging the slider."

## 1. Investigation

Suspects checked and cleared: the slider step (0.01, fine), serial requests (PreviewPusher is already coalesced: 16 ms
debounce, 200 ms max wait, one push in flight), PLAY/LOAD per change (the server answers `mode: nudge` = MIXER lines
only), the section rebuilding on its own edit (`_set_param` emits without a rebuild).

Reproduced with a new e2e (`e2e/scenarios/19_wo963_effect_slider_drag.gd`: look + clip, add Brightness, press-drag the
slider across its range) on a throwaway real Caspar, with a temporary print in `effects_section.gd::_rebuild`:

```
show_effects differs: [{brightness value 0.04}] vs [{brightness value 0.11}]
_rebuild <- show_effects (effects_section.gd) <- layer_inspector.show_layer <- look_editor._sync_fields
  <- _select <- _refresh_list <- Store.project_changed lambda <- state_store.upsert_deck_scenes <- main._on_change <- ws._dispatch
```

Root cause: the server broadcasts the deck scenes over the WebSocket (an echo of our own deck sync / autosave).
`Store.project_changed` → look editor `_refresh_list` → `_select` → `_sync_fields` → `LayerInspector.show_layer` →
`EffectsSection.show_effects` with the layer as the SERVER last knew it, i.e. a value several ticks behind the
slider. It differs from the section's own state, so the whole section is rebuilt: the HSlider being held is freed (the
drag dies after 1-2 ticks, e2e: "the slider was rebuilt during the drag (after 1 ticks)") and the new slider shows the
stale value. Not a request-rate problem: pushes were fine, the drag simply never survived.

Same for any effect param (all go through `param_field.gd` + `_set_param`), and for typing into a spin box and for
add/remove (a stale echo would drop the new card).

## 2. What was done

- `features/live/effects_section.gd`: `show_effects(effects, content, key := "")` ignores an incoming array while the
  section is "holding": a slider is grabbed, or HOLD_MS (600 ms) after our own last edit (param, add, remove) — the
  section's own state is newer than any echo. A different `key` (look/main/layer, passed by `layer_inspector.show_layer`)
  always shows and resets the hold, so selecting another layer is never swallowed; an empty key (the
  content-resolution refresh) counts as the same layer.
- `features/live/param_field.gd`: `control(..., px_dim := 0, on_drag := Callable())` — optional, API-compatible (the
  global border panel is untouched); the slider's `drag_started` / `drag_ended` call `on_drag(true/false)`.
- `features/live/layer_inspector.gd`: one line — `show_layer` passes the layer key to `show_effects`.
- Tests: `tests/test_wo963_effect_slider_hold.gd`; e2e `19_wo963_effect_slider_drag.gd`.

## 3. Verified

- Godot suite: 26002 passed, 0 failed; `run-client.sh --check` boot OK.
- e2e 19 on `--air`: FAILED before the fix (slider rebuilt after 1 tick), PASSES after: same slider node for the whole
  40-step drag, 37 pushes, `mode nudge`; the Caspar log shows 37 `MIXER 2-10 BRIGHTNESS` lines with 27 distinct
  intermediate values (0.04 … 2) and only the initial take's `LOADBG`/`PLAY` on the layer, none during the drag.
- Remaining: owner feel on the box.
