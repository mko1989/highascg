# WO-946 — Visuals Controller: play the drawn APC40 with the mouse like the real unit

**Area:** godot-client
**Status: DONE (04.11.26 — Godot suite 25791/0 (+2 tests), boot check OK; deployed to the second dev box's client and played there: fader 1 → layer opacity 100 → 50 % → back, Hue knob turned) — owner QA**

Owner 04.11 (second dev box): *"also add the ability to use the virtual akai apc40 controller like a real one (moving faders, encoders etc with a mouse)."*

Related: [WO-909](./909_WO_visuals_apc40_profile.md) (the drawn unit), [WO-900](./900_WO_visuals_midi_controller_apc40_pickup.md) (map, Learn, pickup), [WO-912](./912_WO_visuals_apc_knobs_are_encoders.md) (knobs are encoders), [WO-913](./913_WO_visuals_apc_pads_load_visuals.md) (a click presses a pad / button).

## 1. Investigation

- `features/midi/apc40_surface.gd` (WO-909) drew every control at its app value but took only clicks: a left click `clicked` → `visuals_midi_apc.gd` `_click` pressed a mapped button / pad (WO-913, `handle_msg` note 127) and **Learned** anything else — a knob, a fader, the crossfader. Nothing could be moved with the mouse.
- A real control's message goes `visuals_midi.gd` `handle_msg` → map lookup → `_move` (ranges) through `midi_pickup.gd`: `move` (faders: soft takeover) or `turn` (APC knobs, WO-912: relative to the last message, the first only primes).
- Feeding mouse moves through that pickup state would corrupt the hardware's: the state is keyed per binding, so after a virtual move `hw` would sit at the app value, and the real fader's next message would count as "crossing" the target (`(prev − app)·(hw − app) ≤ 0` with prev = app) and jump the value — the very thing pickup exists to prevent.

## 2. What was done

- `apc40_surface.gd`: a mapped fader / crossfader / knob / encoder whose target is there (`playable()` ≥ 0) is **grabbed** on a left press — no value sent until the mouse moves — and dragged: a fader follows the mouse along its slot from where its cap was (never a jump), the crossfader sideways, a knob or encoder 0→1 over 160 px up (`drag_value`); the wheel moves one by 2/127. New signal `turned(control, ratio)`. Cursor: ↕ / ↔ over playable controls, a hand over buttons. Buttons, pads and unmapped controls keep the WO-913 click; right-click is Learn as before. Tooltip adds "Drag it (or the wheel) · right-click to Learn".
- `visuals_midi_apc.gd` `turn()`: the message the unit would send (`cc`, its channel / number, `val` 0–127) plus `ratio` and `virtual: true`, into `handle_msg` — so the flash, the status line, the target lookup and **Learn mode** (a virtual move is captured like a real one) are the hardware's own path. HINT updated.
- `visuals_midi.gd` `_move`: a virtual message sets the target's ratio as is and returns **before** the pickup state — the hardware fader then sees an app value it did not set and waits for pickup (`Pickup.observe`), like after any Inspector drag.
- Learn stores only kind / channel / number (`MidiMap.learn`), so the extra keys never reach the saved map.

## 3. What was verified

- Godot suite **25791 passed, 0 failed**. `tests/test_visuals_apc.gd`: `test_virtual_fader_and_knob_move_their_targets` (fader 2 dragged to 0.85 → layer 2 opacity 0.85 at once, flashes; the real fader 2 at 10 then waits, at 108 takes over — no jump; device knob 1 → camera yaw; buttons / unmapped not playable; in Learn mode a virtual move is captured and the target untouched); `test_drag_geometry` (fader 23 px of 46 = +0.5, clamps, crossfader, knob 80 px = half a turn). `run-client.sh --check`: boot OK.
- **Box (highascg5867):** client restarted with the change; Visuals → Controller: dragging fader 1 down set "Shader · Fly by Night" to 50 % (Inspector and canvas), dragging the Hue knob up moved the Hue slider; both put back.
