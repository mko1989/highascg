# WO-1052 — APC40 mkII: hardware Sel selected nothing (APC stayed in Generic mode) and Clear layer sat on a button the mkII lacks

**Area:** godot-client
**Status: IN PROGRESS (13.11 — Ableton-mode cause proven on the hardware; GUI fix built, suite green; owner relaunch check pending)**

Owner, 13.11: *"the select buttons on the akai still dont select a slot/layer. in the virtual controller they do work."* and
*"also there is no clear layer button on my akai, yet its on the virtual one."*

## Investigation

- The owner's map (`ui.cfg [midi]`) is right: `select:1..8` = note 51 on ch 0–7, the APC40 mkII track select.
- I couldn't sniff the APC while the GUI held it: rawmidi is single-open, and `aseqdump -p 28:0` returned
  `Resource temporarily unavailable`. So I recorded the MIDI status line instead
  (`ffmpeg x11grab` of the Inspector's MIDI line at 4 fps).
  - **Capture 1**, owner pressing buttons: Device lock, Metronome, Tap, User and device knobs appeared, but **no Sel**.
    Every handled message prints a line, so Sel sent nothing.
  - WO-1048's symptom fits the same cause: Sel moved the device knobs to other values, which is Generic mode's internal
    track-select banking.
  - In Generic mode (the APC's power-on mode) the mkII handles track select itself and sends nothing to the host.
- `visuals_midi.gd _port()` sent the Generic Introduction (`_hello`, for the fader-position dump) and then, with `leds=true`,
  the Ableton Introduction. Both went in **one** `amidi -S` run (`midi_out.gd` joins a pump's queue). The APC was still
  answering the first with its fader dump and dropped the second, so it stayed in Generic mode.
- **Proof:** I sent `F0 47 7F 29 60 00 04 41 08 02 01 F7` by itself (`amidi -p hw:3,0,0 -S`) and repeated the capture while
  the owner pressed Sel. Results: `Select 1 → Select layer 1`, `Select 2 → next pad adds layer 2 on top`,
  `Select 3 → next pad adds layer 2 on top` (empty tracks with a one-layer bank, WO-1047). Device knob 1 then reported
  normally.
- Clear layer (WO-913) was the default binding on note 92, the **APC40 mk1's Stop**. The mkII's transport row is
  Play 91 / Record 93 / Session 102, so the button never existed on the owner's unit. `apc40_layout.gd` still drew a
  "Stop" for it in the virtual controller.

## What was done

- `features/visuals/visuals_midi.gd`: `_port()` sends only the Generic hello. The Ableton Introduction goes out when the hello
  window ends (`tick`, 1.5 s later, after the fader dump), and `_lit` is reset so every light is sent again in the new mode.
  The `_leds_changed` path, which sends Ableton alone, is unchanged.
- `features/midi/midi_map.gd`: Clear layer's default is now `CLEAR_NOTE` 62 (Dev on/off, unused until now).
  `without_phantoms()` moves a stored note-92 binding to 62 when 62 is free, otherwise drops it. `_load` runs it before
  `with_new_defaults`, so the owner's saved `clear` on 92 moves to Dev on/off at the next load.
- `features/midi/apc40_layout.gd`: the virtual controller drops the phantom Stop button.

## What was verified

- On the hardware: Sel selects with the APC in Ableton mode (status-line capture above). That mode was set by hand with amidi.
  After the GUI relaunch, the GUI's own delayed switch still needs a check.
- Godot suite: `[tests] 28228 passed, 0 failed`. This includes a new `test_phantom_stop_moves_to_dev_on_off` and the
  updated `test_stored_map_gains_the_new_buttons` (a note-92 binding the operator owns stays, and Clear goes to Dev on/off)
  and Stop→Dev on/off in the clear test. `run-client.sh --check` boot OK.
