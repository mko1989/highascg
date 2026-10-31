# WO-909 — APC40 profile: the controller drawn with what every control does now, device knobs auto-mapped

**Area:** godot-client
**Status: DONE (31.10.26 — Godot suite 25485/0 incl. test_visuals_apc.gd; box: Controller mode on the owner GUI with live names, values and tooltips)**

## Owner request (31.10.26)
"a special midi profile for the akai apc40. where it visualy shows what each fader, button, encoder etc would do when
pressed, moved. with auto mapping of different parameters" (with the A/B banks, WO-908).

## 1. Investigation (before any change)
- WO-900 gives the Visuals a MIDI controller (`visuals_midi.gd`): bindings `{kind, ch | ANY, num, target}`
  (`midi_map.gd`, `find` = exact channel, then ANY), soft takeover per binding (`midi_pickup.gd` `{live, hw, sent}`),
  LED feedback (`midi_leds.gd`) and Learn (`midi_panel.gd`). The only view of a binding is one text line per row in the
  Inspector's MIDI block — nothing shows *where* a control sits on the unit or what it does right now.
- The default map (`MidiMap.apc40()`) used 3 of the 8 device knobs (CC 16–18 → camera yaw/pitch/zoom) and nothing for
  the track select buttons; device knobs on the APC are meant to follow "the selected device" — the natural
  auto-mapping target is the selected layer.
- Note / CC numbers checked against Akai's "APC40 Mk2 Communications Protocol" v1.2, inbound tables p.30–35: clip pads
  notes 0–39 (bottom row 0–7, top 32–39), clip stop 52 / track select 51 / A|B 66 / activator 50 / solo 49 / rec arm 48
  on the track's channel, faders CC 7 per channel, master CC 14, crossfader CC 15, track knobs CC 48–55, device knobs
  CC 16–23, device buttons 58–65, scene launch 82–86, stop all 81, master 80, pan/sends/user/metronome 87–90,
  play/stop/rec/session 91/92/93/102, tap 99, nudge 100/101, shift 98, bank lock 103, arrows 94–97, tempo CC 13 and
  cue level CC 47 (relative).
- A shader layer's sliders are built by `visuals_shader_mode.gd _render` from the shader's uniforms (key controls first)
  — the device page can take them from there instead of re-parsing the shader.
- Pickup gap found on the box: fader 1 drew an amber "waiting" tick although it sat where the app value was. The APC
  reports positions at open (`seen()` with the value at that time); when the app value later came to the physical
  position (a load / recall), `observe()` only ever turned a binding *off* live, never back on.
- `visuals_midi.gd` is at 399 lines → the profile goes into its own files.

## 2. What was done
- **`features/midi/apc40_layout.gd` (new):** the APC40 mkII front panel as data — every control with its message, shape
  (pad, btn, knob, fader, xfader, encoder), a rect on a 21 × 13.6 unit schematic and its printed name; `find(msg)`
  (a Note Off finds its pad), `msg_of`, `key`.
- **`features/midi/apc40_surface.gd` (new Control):** draws the unit from `info_cb(control)` → `{label, value, lit,
  waiting, hw, line}`: pads/buttons lit like their target (midi_leds states), labelled with the target's live name;
  knobs with a value arc; faders / crossfader at the app value; an amber tick where a waiting control physically is;
  unmapped controls dim with their printed name. A touched control flashes 300 ms. Hover = the full line; a click emits
  `picked`. Redraws at 10 Hz only while visible.
- **`features/visuals/visuals_midi_apc.gd` (new):** the Visuals' side — `info()` per control (binding → target →
  label / value / pickup / LED), live labels ("2 Particles", "Mute Particles", look names, "Cam yaw", "A/B AUTO"…),
  the **auto mapping**: `dev:1–8` = the selected layer's page (a shader layer: `key_controls()` of the Shader mode, in its
  order and names; any other layer: Cam yaw / pitch / zoom / Burst), `select:N` picks layer N (the knobs re-label), a
  click starts Learn for that control (`midi._set_mode("learn")` + `_captured`).
- **`visuals_midi.gd`:** adds the work-area mode "Controller" (`tab.work.add_mode`), passes every decoded message to
  `surface.touch`, resolves `dev:` / `select:` through the profile, the select buttons light on the selected layer.
- **`visuals_shader_mode.gd`:** `key_controls()` → `[{label, control}]` from the rendered cards.
- **`midi_map.gd`:** targets `dev` (range) and `select` (button) with labels; the APC40 default map: device knobs CC 16–23
  → `dev:1–8` (was 16–18 → camera), track select → `select:1–8`, scene launch 4 / 5 → A/B AUTO / CUT. (Map: 61 bindings.)
  WO-900 §4 table updated.
- **`midi_pickup.gd observe()`:** a waiting binding whose physical position the app value has come to (within TOL) is
  live again — the stale amber tick above.

## 3. Verified
- Godot suite: 25485 passed, 0 failed. New `tests/test_visuals_apc.gd` (4: every default binding has a control on the
  layout; live names and values in `info()`; the device knobs follow the selection incl. an injected shader card; a
  message flashes its control, a click starts Learn). `test_midi_pickup`: dev:1 / select:3 in the map, the observe
  resync; `test_visuals_midi`: map size 61. Smoke `smoke-wo909-apc40-profile.test.js`.
- Box, owner GUI (DP-4, APC40 mkII on hw:4,0,0): Visuals → Controller draws the unit with Pulse…Fade time on the track
  knobs, Look 1–12 on the pads, Burst / Auto / Tempo / A/B AUTO / A/B CUT on the scene column, Mute / Sel with the layer
  names, faders "1 Particles", "2 3d-audio-vis…", Master; device knobs Cam yaw / pitch / zoom / Burst (no shader layer
  selected). Tooltip "Fader 2 → Layer 2 opacity: 2 3d-audio-visualizer · 0 %". After the observe fix and a GUI
  relaunch the stale amber tick on fader 1 is gone.
- Owner QA: the physical unit — move faders/knobs and watch the flash; track select on a shader layer → device knobs
  re-label and drive its sliders; scene 4 / 5 with A/B on.
