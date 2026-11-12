# WO-1048 — APC40 hardware Sel: the device knobs' bank resend nudged parameters and rings showed another bank

**Area:** godot-client
**Status: IN PROGRESS (12.11 — built; suite 28116/0, `--check` boot OK; needs a GUI relaunch + the owner on the hardware)**

Owner, 12.11 (after WO-1047, which works from the virtual controller): *"on the real apc it seems to shift the encoders on
the right to some other values."*

## Investigation

- The right-hand encoders are the 8 **device knobs** (CC 16–23), mapped `dev:1..8` with `ch: -1` (any channel). They
  drive the selected layer's page (WO-909) and are read as **relative encoders** (WO-912 `midi_pickup.gd turn()`): the
  step since the last position, with a jump of more than 10 steps re-priming. Pickup state is keyed per binding, not
  per channel.
- APC40 mkII protocol (via github.com/hepp/akai-apc40-mk2, the reference of WO-913): in **Generic mode** the device
  knobs "will output on a different MIDI channel based on the current Track Selection" (track 1–8 = ch 0–7, master = 8),
  and "upon pressing one of the Track Selection buttons, the current position of the 8 Device Control knobs will be
  sent". In the Ableton modes they are not banked.
- So a hardware Sel (in Generic mode) makes the APC send the new bank's 8 stored positions:
  - each lands as an encoder **turn** measured against the old bank's position, so a difference of 10 steps or less
    moved the parameter;
  - `midi_leds.gd frame()` sends every ring as `0xB0` (ch 0), so the APC shows bank N's own old ring values, never the
    app's.
- The virtual controller (WO-946) has no banks and sends no resend, which is why it behaved.
- The box sends the Ableton-mode sysex when pad lights are on (`ui.cfg leds=true`, `_port()` → `SYSEX_ABLETON` via
  `amidi`, which reaches hw:3,0,0). An APC back in Generic mode (re-plugged, power-cycled) banks as above. The fix holds
  in both modes: in Ableton mode the knobs stay on ch 0 and nothing changes.
- Also by design (WO-909), not part of this bug: Sel on a layer re-targets the device knobs to that layer's parameters,
  so their rings and labels change to that layer's values. Sel on an **empty** track (WO-1047) changes no selection, so
  the knobs must not change.

## What was done

- `visuals_midi.gd`:
  - `dev_bank` is the channel the device knobs last used. A hardware track select (note 51, or master 80) opens a
    300 ms resend window. A device-knob CC inside that window, or on a channel other than `dev_bank`, is a position: it
    primes the encoder (the `hello` path, `Pickup.seen`) and moves nothing.
  - The virtual controller is not affected.
- `midi_leds.gd frame(…, dev_ch)`: device-knob rings go to `0xB0 | dev_bank`, so the bank the APC shows takes the app
  values. Track-knob rings (CC 48–55, not banked) stay on ch 0.

## What was verified

- `tests/test_visuals_midi_clips.gd test_track_select_bank_resend_moves_nothing`:
  - With the knob primed at 60 on bank 1, a hardware Sel 2 followed by the bank's 64 on ch 1 moves nothing; the old
    code read that as +4 steps. `dev_bank` becomes 1.
  - The next turn (66) moves 2 steps.
  - A CC on yet another channel primes and never steps.
  - Device rings go out on `0xB2` for bank 3, not `0xB0`; track rings stay on `0xB0`.
  - Godot suite 28116 passed / 0 failed. `run-client.sh --check` boot OK.
- **Open (owner, hardware):** after a GUI relaunch, Sel on the APC leaves the right-hand knobs' values alone, apart from
  the designed re-target to the picked layer.
