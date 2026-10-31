# WO-913 — Visuals Controller: drop a visual on an APC40 pad → the pad loads it into PRV, lit in the visual's colour

**Area:** godot-client
**Status: DONE (31.10.26 — suite 25533/0, probe-client clicks; owner physical QA of pads / arrows / Stop / colours: good)**

## Owner request (31.10.26)
"in the controller in visuals it should be possible to drop different visuals onto the buttons/pads to load them
instantly to prv a or b" · "when a visual is droped on the button the button should show the visuals main color as the
backlight of the button."

## 1. Investigation
- The Controller mode (WO-909, `features/midi/apc40_surface.gd`) drew the unit and took clicks (Learn) but no drops. Pads
  are the clip grid (notes 0–39, top row 32–39; column = note % 8) and the scene-launch column (82–86).
- The APC map's columns are tracks = layers already: track fader N = layer N opacity, clip stop N = mute N, track select
  N = select layer N. Rows 1–2 recall looks 1–12, rows 3–5 were unmapped.
- Loading a visual: `visuals_tab.gd drop_visual(payload, target)` (the Sources ▸ Visuals drop / double-click path); A/B
  (WO-908) edits the bank in `slice`, `dj.to_prv()` moves editing to the bank off the canvas (as a picked look does).
- APC40 mkII RGB pads: Note On, velocity = an index into a fixed 128-colour palette (Akai's protocol RGB table; the
  existing `midi_leds.gd` already used 5 = red, 21 = green from it). The host lights the pads only in the Ableton modes
  (pad lights on); the box had them off (`ui.cfg [midi] leds=false`, WO-912).
- Thumbnails (WO-885 `visuals_thumbs.gd`) exist per Sources row once its folder was opened; games have none.

## 2. What was done
- `features/midi/apc40_palette.gd` (new): the 128 palette colours (transcribed from github.com/hepp/akai-apc40-mk2, MIT,
  which copies Akai's table), `main_color(img)` (saturation × brightness² weighted mean of a 32×18 thumbnail, at full
  brightness; grey → white), `nearest(c)` (palette index), `of_name()` (a hue from the name when there is no thumbnail).
- `features/live/visuals_sources_panel.gd _drag`: a row with a thumbnail puts its main colour in the drag payload (`color`;
  `Layers.from_payload` ignores it, so canvas / layer-list drops are unchanged).
- `features/visuals/visuals_midi_clips.gd` (new): `drop(num, payload)` binds the pad to `clip:<note>` (replacing what
  it drove, e.g. a look), stores {payload, colour} in `ui.cfg [midi] clips` with the mapping, turns pad lights on (the
  colour is a host-lit backlight); `fire(num)` → `dj.to_prv()` + `drop_visual(payload, column's layer | -1 = new on top)`;
  `velocity(target)` = the pad's palette index.
- `midi_map.gd`: `clip` is a button target ("Visual pad (loads into PRV)"). `visuals_midi.gd`: `control_of("clip:N")`,
  `_button` fires it, the light frame takes `clips.velocity` (`midi_leds.gd frame(…, vel)`: an RGB pad's own colour).
- `apc40_surface.gd`: `_can_drop_data` / `_drop_data` (`can_drop_cb`, `dropped`), a pad with `info.color` drawn in it
  (dark text on light colours). `visuals_midi_apc.gd`: accepts Sources ▸ Visuals payloads on clip-grid pads only, names
  the pad after the visual, hover line "Pad 3·3 → Rings: press = into PRV, layer 3 …".
- `visuals_tab.gd`: `--probe-midi=off` = a probe client with MIDI closed and no MIDI script (so a probe never opens the
  APC or sends it rings / lights while the operator GUI holds it).

## 3. Verified
- Godot suite 25522 passed, 0 failed — `tests/test_visuals_midi_clips.gd`: palette (128, red 5, green 21, grey → white;
  a dark frame with a blue shape → that blue at V = 1), clip colour from the payload / name; drop replaces the look-2
  binding with `clip:33`, its light = velocity 5 (red); pressing note 33 replaces layer 2 (fader kept), a column past the
  layers adds one on top; A/B on while editing the bank on air → the press edits the PRV bank, the bank on air unchanged;
  the surface takes visuals on grid pads only (not scene launch, knobs, media).
- Probe client (Xvfb :93, scratch XDG_DATA_HOME, `HIGHASCG_SERVER` → read-only proxy, `--probe-midi=off`): Controller
  mode, Tunnel / Spectrum / Rings dragged from Sources ▸ Visuals onto pads 1·3, 2·3, 3·3 → the pads read "Tunnel"
  (purple), "Spectrum" (yellow), "Rings" (cyan) with the hover line.
- **Open (owner, physical):** a pad press loading into PRV; the APC pads lit in the colours (pad lights switch on with
  the first drop — Ableton mode, host-lit buttons).

## 4. Owner follow-up (31.10.26): selected layer, a clear button, ◀ / ▶ pick the edited bank (PGM too)
"the visuals from the pads should go into selected layer/fader. there should aslo be a clear layer/fader button. clicking
the left right arrows should change which slot a/b is edited, with possibility to edit live on pgm too"
- **Pads → the selected layer** of the bank being edited (`tab._target()`: the selected layer, else the top one, no layers
  = a new one) — replaces §2's column = layer; no `dj.to_prv()` any more, so the pad follows the edited bank.
- **◀ / ▶ (notes 97 / 96) = Edit A / Edit B** (`edit:1` / `edit:2` → `dj.focus()`), the bank on air included — the MIDI
  line says "ON AIR: changes are live". Lights: the edited bank's arrow on, blinking while that bank is on air (the
  drawing: green / red). A/B off: not there.
- **Stop (note 92) = Clear layer** (`clear` → the selected row's ✕: the layer is removed, the ones above move down a fader).
- A stored map gains these (`MidiMap.with_new_defaults`, only where the control is still free) — the box's ui.cfg had a
  saved map since the first pad drop.
- **Clicks on the drawing press** (`apc40_surface.gd clicked`): a mapped button or pad does what the hardware would; a
  knob, fader or unmapped control still Learns; right-click Learns anything. Hint text updated.
- Verified: suite 25533 / 0 (`test_arrows_pick_the_edited_bank`, `test_stored_map_gains_the_new_buttons`,
  `test_click_on_the_drawing_presses_a_pad`, selected-layer + Stop asserts); smokes WO-900/908/909 8/8. Probe client
  (Xvfb :93, read-only proxy): click Edit B on the drawing → "PGM B ✎", its arrow red; Edit A; Sel Particles; the Tunnel
  pad → layer 1 Tunnel (its fader / eye kept); Clear layer → gone.
- Note: a replaced layer keeps its mute (eye) and fader, as every drop-replace does (WO-890) — a pad into a muted layer
  loads it unseen.

## Owner QA

Owner 31.10.26: "good" — physical QA on the real hardware passed.
