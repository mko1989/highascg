# WO-1041 — Visuals: APC40 faders did not move layer opacity (fader 1 re-learned to Pulse, one-layer stack)

**Area:** godot-client
**Status: DONE (12.11 — map restored, fader 1 → layer 1 opacity proven on the running client by injected MIDI)**

Owner, 12.11: *"in the visuals tab and akai controller the faders were suppose to control layers opacity"*

## Investigation

- Controller and input fine: `amidi -l` → `hw:3,0,0 APC40 mkII`; client log `[midi] inputs: APC40 mkII`; the pads were
  firing clips earlier the same evening (`visuals_midi_clips.gd:56` in the log backtraces).
- The stored map (`user://ui.cfg` `[midi] map`, HighAsCG Operator) had **no `layer:1` binding**: track fader 1
  (`cc 7 ch 0`) was bound to `param:pulse`, appended last — the shape `MidiMap.learn()` leaves (unbind the source, append
  the new target; `features/midi/midi_map.gd:57`). Pulse stayed on track knob 1 (cc 48) as well, so it was a Learn onto
  the fader, not a move of Pulse. Who / when is not recorded (Learn writes no log line).
- The Visuals stack (`project.visuals.layers`) has **one layer**, so faders 2–8 (`layer:2…8`) resolve to "not there"
  (`visuals_midi.gd` `control_of`). Net effect: no fader reached any layer.
- Not a code regression: `MidiMap.apc40()` still maps track faders 1–8 → layers 1–8 (WO-900 table).

## What was done

- Client stopped, `ui.cfg` backed up, the one binding `cc 7 ch 0 → param:pulse` rewritten to `layer:1`, client
  relaunched (setsid run-client.sh). Every other binding (clip pads, edit, clear, looks 6–12) left as the owner had it.
  (Load APC40 map in the panel would have done the same for fader 1 but dropped the clip-pad bindings.)

## What was verified

- Relaunched client: `[midi] inputs: APC40 mkII`, `[visuals] on air before this client started — sending again`.
- MIDI injected into the client's ALSA input (`aseqsend -p 128:0 B0 07 <v>`, the seq port Godot opens as
  "Virtual RawMIDI"): 7F,7C,78,74 → `visuals.layers[0].opacity` 1 → **0.91** (rev 415 → 416); 78,7C,7F → back to **1**
  (rev 417). Pickup held as designed (picked at 127 = the current opacity).
- Note for the owner: with opacity at 100 % fader 1 picks up only once pushed to the top (soft takeover, WO-900);
  faders 2–8 act once the stack has that many layers.
