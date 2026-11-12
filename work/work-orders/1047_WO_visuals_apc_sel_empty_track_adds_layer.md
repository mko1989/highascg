# WO-1047 — Visuals Controller: Sel on an empty track arms a new layer, so the pads can fill layers 2–8

**Area:** godot-client
**Status: DONE (12.11 — suite 28109/0; owner relaunched the GUI 23:33 and confirmed on the virtual controller: "i can do it from the virtual controller now"; on the real APC the right-hand knobs then shifted → WO-1048)**

Owner, 12.11: *"i cant change select slot/layer on the controller to set different layer with a visual from the pads."*

## Investigation

- The saved map (`ui.cfg [midi] map`) is intact. Track select 1–8 (note 51, MIDI ch 0–7) → `select:1..8`, ◀/▶
  (97/96) → `edit:1/2`, and pads 24/25 and 32–39 → `clip:N` (WO-913). The APC is open in Godot
  (`/proc/<godot>/fd` → `/dev/snd/midiC3D0`).
- Screenshot of the operator screen (Visuals ▸ Controller): A/B on, **Edit B** (PGM B ✎), and bank B holds **one**
  layer (Shader · Mind flowers). The drawing shows "Sel Mind fl…" then Sel 2–8 for tracks with no layer.
- Code path: `visuals_midi.gd handle_msg` → `control_of("select:N")` → `visuals_midi_apc.gd control_of` returns
  `rows[n].panel` **only for an existing layer**, else null. A null control means "Sel N → …: not there" and nothing
  happens. Pads (`visuals_midi_clips.gd fire`) go to `tab._target()`, which is the selected layer, else the top one.
  So with a one-layer bank, every pad replaced layer 1, and the controller had no way to put a visual on a second
  layer. Adding one needed a mouse drop onto the canvas.
- `Layers.drop(…, target -1)` already appends a new layer on top (limit `MAX` = 8, with a note at the limit).

## What was done

- `visuals_midi_clips.gd`: `new_slot` (-1 = none). `fire()` drops with target -1 while a slot is armed (a new layer
  on top), then disarms. `drop_visual` selects the new layer, so the next pad replaces that one, as a normal Sel
  would.
- `visuals_midi_apc.gd`: `control_of("select:N")` for an empty track returns the surface (a control exists, so the
  press is handled). `select()` arms `new_slot = n` on an empty track and disarms on an existing one.
- `visuals_midi.gd`: the MIDI line reads "Sel 5 → next pad adds layer 2 on top". The empty track's Sel light is ON
  while armed (other empty tracks stay dark), and the selected layer's light goes to AVAIL meanwhile. Switching the
  edited bank (◀/▶) disarms.
- `visuals_tab.gd`: picking a layer with the mouse (`layer_selected`) disarms.

Why "any empty track adds on top" rather than "Sel N makes layer N": layers are a stack without gaps (Layers.drop
appends; delete moves the ones above down). Track N with fewer than N-1 layers below it cannot exist, so the next free
layer is the only place a new visual can go. The MIDI line says which layer it will be.

## What was verified

- `tests/test_visuals_midi_clips.gd test_sel_on_an_empty_track_adds_a_layer`:
  - Sel 5 on a 3-layer bank arms; its light is ON, Sel 6 OFF, Sel 1 AVAIL.
  - A pad adds a 4th layer on top and selects it; the next pad replaces that layer.
  - Sel on an existing layer disarms, and so does a mouse pick.
  - A full stack (8): Sel 8 picks layer 8.
  - Godot suite 28109 passed / 0 failed. `run-client.sh --check` boot OK.
- **Not yet on the hardware:** the operator GUI (pid running since 22:47) renders the Visuals on PGM (`shm://visuals`
  on ch 2). It picks this up on its next relaunch, then: Sel 2 → a pad → layer 2 added.

## Owner QA

Owner 12.11, after relaunching the GUI: *"i can do it from the virtual controller now, but on the real apc it seems to shift
the encoders on the right to some other values"*. The hardware side is WO-1048.
