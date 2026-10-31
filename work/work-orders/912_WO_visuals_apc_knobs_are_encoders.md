# WO-912 — Visuals MIDI: APC40 knobs are endless encoders — they never picked up; now relative, rings always sent

**Area:** godot-client
**Status: IN PROGRESS (31.10.26 — Godot suite 25498/0, owner GUI relaunched; the physical knobs are untested by me)**

## Owner report (31.10.26)
"the encoders show that they recive values but dont drive the encoders."

## 1. Investigation
- The 8 track knobs (CC 48–55) and 8 device knobs (CC 16–23) of the APC40 mkII are endless encoders that send an
  absolute 0..127 position the APC keeps itself. WO-900 / 909 bound them like faders, through soft takeover
  (`midi_pickup.gd move()`): nothing moves until that position comes to the app value or crosses it.
- The box's `ui.cfg [midi] leds=false` (pad lights off) → the APC stays in its Generic mode and the app never sends the
  ring CCs (`visuals_midi.gd tick()` sent the lights frame, rings included, only when `leds`). So the knob's own position
  is unrelated to the app value: the Controller view showed every turn (flash, amber "waiting" tick) and the MIDI line
  "… waits: it is at N %, bring it to M %", and the parameter stayed put. A knob at its own 0 or 127 can't even cross a
  value on the far side in one direction.
- Device knobs re-target as the selected layer changes (WO-909), so with pickup every layer switch re-armed every knob.

## 2. What was done
- `midi_pickup.gd turn()`: an encoder moves the target by its step since the last message (`hw` − previous), from
  wherever the target is; the first message primes, a jump > 10 steps (the APC took a ring value, or the knob turned while
  nobody listened) primes again; always live → no ghost, no "waits" line.
- `visuals_midi.gd`: `_encoder(b)` = an APC is plugged in and the binding is a ring CC → `_move` uses `turn()`, `tick()`
  skips the pickup observe for it; the knob rings are sent even with the pad lights off (`midi_leds.gd rings()`: only the
  CC part of the frame, so Generic mode keeps its own button lights). With the APC taking a ring value its position follows
  the app value — the jump guard covers both cases (taken or not).
- Faders (CC 7, master, crossfader) keep soft takeover: they are real absolute positions.

## 3. Verified
- Godot suite 25498 passed, 0 failed: `test_encoder_turn` (prime, step down / up from the app value whatever the knob's
  own position, never waiting, jump re-prime, clamp), `test_rings_only`.
- Owner GUI relaunched with the change. **Open:** turning the physical knobs (track knobs → Pulse…Fade time, device
  knobs → the selected layer's page) and whether Generic mode draws the rings the app sends.
