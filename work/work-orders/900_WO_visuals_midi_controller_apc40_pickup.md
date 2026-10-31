# WO-900 — Visuals: MIDI controller (APC40 mkII map, Learn, fader pickup / soft takeover, opt-in pad lights)

**Area:** godot-client
**Status: DONE (31.10.26 — 25290-test runner, Xvfb probes with the real APC40; owner physical fader QA: good)**
**Source:** owner 31.10: *"for visuals id like to be able to connect a midi device for control. i have and connect soon an akai
apc40 (mk2 i think). the thing that is a must is a fader sync. meaning that a physical fader doesnt move the in app fader until
the irl fader is brought to the current value of the digital one."*
**Related:** WO-738 (§control: "MIDI built in"), WO-858 (MIDI/OSC mappings estimate), WO-876/877/878/895 (Visuals show, looks,
autopilot, playlists — the targets bound here), WO-890 (Visuals Inspector page)

## 1. Investigation

### Godot's MIDI on Linux (4.7.2, `drivers/alsamidi/midi_driver_alsamidi.cpp`, read from the 4.7.2 tag)
- It is ALSA **rawmidi**, not the sequencer. `OS.open_midi_inputs()` enumerates `snd_device_name_hint(-1, "rawmidi")` **once**,
  opens every input `SND_RAWMIDI_NONBLOCK` and starts one reader thread (1 ms poll). **No hot-plug**: a controller plugged in
  later is unseen until close + open; one unplugged while open makes the thread print `snd_rawmidi_read error` until closed.
  Calling open twice without a close starts a second thread → always close first.
- `OS.get_connected_midi_inputs()` also lists **"Virtual RawMIDI"** (alsa.conf `rawmidi.virtual`, a seq port) — not a device.
- **Crash, measured:** `OS.open_midi_inputs()` SIGSEGVs under the Dummy audio driver (`--headless`, the test runner,
  `--check`). libasound is dlopen'd only by the ALSA or PulseAudio audio driver (the Pulse driver calls `initialize_asound`
  under `ALSAMIDI_ENABLED`). → guard on `AudioServer.get_driver_name()` ∈ {ALSA, PulseAudio} and a non-headless display.
- Events: `MIDIDriver::send_event` builds `InputEventMIDI` (note on/off: pitch + velocity; CC: controller_number/value) →
  `Input.parse_input_event` → the display server hands non-window events to **every** window; a window with an exclusive /
  modal child gets none.
- **No MIDI output API** in Godot (no `OS.send_midi`), so LEDs need another path: `amidi` (alsa-utils, installed:
  `/usr/bin/amidi`) writes raw bytes to the rawmidi *output*.
- **Rawmidi input is single-open** (measured: with a Godot probe holding the APC40, `amidi -p hw:4,0,0 -d` → *Device or
  resource busy*). The output side opened concurrently fine (`amidi -S`, rc 0). Godot skips a busy input without a word.
- `Range.value_changed` is emitted **only inside the tree** (measured: `s.value = 0.3` out of tree → no signal). The Visuals
  Inspector page is out of tree until the Inspector first presents it (`app/inspector_panel.gd` keeps it in the tree, hidden,
  afterwards) → a MIDI move must emit `value_changed` itself when the slider is not in the tree.

### APC40 mkII protocol (Ableton's APC40_MkII script, hepp/akai-apc40-mk2, forum dumps; the Akai PDF is unreadable here —
`poppler-utils` missing)
- Track faders CC 7 on ch 1–8, master CC 14, crossfader CC 15, track knobs CC 48–55, device knobs CC 16–23 (generic mode:
  channel = the selected track), cue level CC 47 / tempo CC 13 (relative encoders). Clip grid notes 0–39 (top row 32–39),
  scene launch 82–86, stop all 81, clip stop 52 per track channel, select 51, activator 50, solo 49, arm 48, tap 99, shift 98,
  bank arrows 94–97, device buttons 58–65.
- Intro sysex `F0 47 7F 29 60 00 04 4m 08 02 01 F7`: m=0 generic (power-on), 1 Ableton live, 2 alternate. Generic: pads lit
  only while held, buttons toggle locally, knobs absolute. Mode 1: buttons momentary, all LEDs host-driven (pad velocity =
  128-colour palette, Note On channel = solid/blink/pulse; single LEDs 0/1/2).
- **Measured on the real unit (USB 09e8:0029, `hw:4,0,0`, seq client 32):** Device Inquiry reply
  `F0 7E 00 06 02 47 29 00 19 00 01 00 01 00 7F 7F 7F 7F 41 31 31 37 30 36 31 35 37 31 32 34 37 31 31 00 F7`; no idle traffic
  in 2 s. **The generic-mode intro (0x40) makes the APC report every position** (CC 7 ch 1–8, CC 14, CC 15 = 62); the
  Ableton intro (0x41) reports nothing (measured twice). That report is what lets the app show where each fader physically is
  before anyone touches it.

## 2. What was done

New `godot/client/features/midi/` (pure helpers unit-tested; every file < 500 lines):
- `midi_pickup.gd` — the fader sync. A binding starts **waiting**; a physical move sets nothing until the physical value is
  within 1.5/127 of the target's value **or crosses it** between two messages (a fast flick skips 7-bit steps); then it is
  **live**. Whenever the target's value is no longer the one the binding last set (UI drag, look recall, playlist, autopilot)
  it waits again (`observe`, checked every 0.1 s and on each move). `seen()` records a reported position without moving
  anything. `took()` reads the value back after the set so a slider's own step never counts as "moved elsewhere".
- `midi_map.gd` — message decode (Note On vel 0 = off), bindings `{kind, ch|ANY, num, target}`, exact channel before ANY,
  learn / unbind, APC40 control names, the default `apc40()` map (45 bindings, table in §4).
- `midi_input.gd` — open/close with the crash guard; **hot-plug** by polling `/dev/snd/midiC*` names + mtimes every 0.5 s and
  re-opening on change; `held_elsewhere()` (more MIDI nodes than opened inputs → another program reads one).
- `midi_leds.gd` + `midi_out.gd` — **pad lights, opt-in** (⋯ menu "APC40 pad lights", default off because it switches the APC
  to Ableton mode, where pads no longer self-light): a frame of the wanted LED state (looks: available grey / showing green;
  mute/blackout/auto/audio: on/off; knob rings follow their values) diffed against the last one, sent as one `amidi -S` per
  change on a WorkerThreadPool task (never blocks the frame). Missing amidi → note "install alsa-utils".
- `midi_ghost.gd` — the waiting indicator: an amber tick on the slider at the physical position.
- `midi_panel.gd` — MIDI block at the end of the Visuals Inspector page: device line, Learn / Unmap toggles, ⋯ menu
  (load APC40 map, clear all, pad lights), one note line (amber while a fader waits: *"Fader 1 → Layer 1 opacity waits: it is
  at 79 %, bring it to 25 %"*). Learn: move a control, then click the target in the Inspector (refuses pad → slider).
- `features/visuals/visuals_midi.gd` — the controller: decodes, finds the binding, drives the **existing** controls (slider
  `ratio` = the same path as a drag; buttons via `pressed` / `button_pressed` / `button_down`, Auto off↔last via the option),
  ghosts, the 1.5 s **hello window** after greeting the APC (positions → `seen`, no moves, no notes), LEDs. Storage:
  **ui.cfg `[midi]`** (`core/ui_cfg.gd`) — the controller is plugged into this machine, not part of the show; a project load or
  factory reset must not wipe it, and two clients may have different controllers.
- `features/visuals/visuals_midi_probe.gd` — dev probe (`--probe-midi=<dir>[:real]`), see §3.

Existing files (small edits): `visuals_tab.gd:52,106-107` (create the controller) and `:159-160` (probe flag);
`visuals_page.gd:9,44,154-155,159` (MIDI block + `control(id)`); `visuals_show.gd:187,192` (`control(id)`, `look_button(i)`).
Tests: `tests/test_midi_pickup.gd`, `tests/test_visuals_midi.gd` (auto-discovered by `tests/run_tests.gd`).

## 3. What was VERIFIED

- `./run-client.sh --test`: **25290 passed, 0 failed** (incl. 15 new tests: pickup from below/above, crossing, tolerance and
  7-bit steps, re-arm on app change, seen-report, decode, bindings/learn/unbind, APC map, LED frames/diffs, input helpers;
  synthetic `InputEventMIDI` into a built Visuals tab: fader pickup drives the layer, master/param/buttons, Learn + Unmap +
  store round-trip in a temp cfg, click-to-pick, lights frame, hello = positions not moves). `--check`: boot OK.
  `node tools/ci/check-max-file-lines.js`: 0 over 500.
- **Synthetic probe on Xvfb :97** (own XDG_DATA_HOME copy, `--visuals-ring=probe900`, project broadcasts ignored, nothing
  saved), events through `Input.parse_input_event`, screenshots in
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo900/`:
  `01-waiting` (fader 8 % under 60 %: opacity stays 0.60, ghost), `02-picked` (40→60→90: picked at the crossing, 0.71),
  `03-rearmed` (look recall to 25 %: waiting again, ghost at 79 %), `03b-panel` (amber note), `04-learned` (Learn → CC 21 ch 10
  → click on Pulse: bound, value untouched), `05-pad-look` (note 33 → look 2).
- **Real APC40 mkII** (probe client on :97, never the owner's GUI): Godot listed `["Virtual RawMIDI", "APC40 mkII"]`; the
  client opened it, found the output port `hw:4,0,0`, greeted it and got the position report: all 3 layer faders + master
  at 0 → *"Controller ready — 4 faders wait"*, ghosts at 0 (`real-01-report.png`). amidi bench: Ableton intro, pad colours,
  clip-stop LEDs and ring CCs sent rc 0, then cleared and generic mode restored (seeing the colours needs the owner).
- **Owner checks (physical, not doable here):** (1) push fader 1 slowly up: the in-app opacity must not move until the
  fader reaches the amber tick, then follows; (2) same with a fast flick across the value; (3) drag a layer slider in the
  UI, then move the fader: waits again; (4) recall a look, same; (5) track knobs 1–8 → Pulse…Fade, absolute; device knobs
  1–3 → cam yaw/pitch/zoom on any selected track; (6) top-row pads → looks 1–8, scene 1 → Burst, scene 2 → Auto, stop-all →
  Blackout, clip stop → layer mute; (7) ⋯ → pad lights: look pads grey, showing look green, mute/blackout lit; off again →
  pads self-light; (8) unplug + replug: device line updates within 0.5 s and faders report again.

## 4. APC40 mkII default map

| Control | MIDI | Target |
|---|---|---|
| Track faders 1–8 | CC 7, ch 1–8 | Layer 1–8 opacity (pickup) |
| Clip stop 1–8 | note 52, ch 1–8 | Layer 1–8 mute |
| Master fader | CC 14 | Master (pickup) |
| Track knobs 1–7 | CC 48–54 | Pulse, Spin, Hue, Glow, Flash, Speed, Amount (pickup) |
| Track knob 8 | CC 55 | Fade time (pickup) |
| Device knobs 1–8 | CC 16–23, any ch | `dev:1–8`: the selected layer's page — a shader's key controls, else Cam yaw, pitch, zoom, Burst (pickup; WO-909) |
| Track select 1–8 | note 51, ch 1–8 | Select layer 1–8 (the device knobs follow; WO-909) |
| Clip pads top row | notes 32–39 | Looks 1–8 |
| Clip pads row 2, 1–4 | notes 24–27 | Looks 9–12 |
| Scene launch 1 / 2 / 3 / 4 / 5 | notes 82 / 83 / 84 / 85 / 86 | Burst / Auto on-off / Tempo Audio / A/B AUTO / A/B CUT (4, 5: WO-908/909) |
| Tap tempo | note 99 | Tap |
| Stop all clips | note 81 | Blackout |
| Crossfader | CC 15 | A/B crossfader (pickup; only while A/B is on, WO-908) |
| Cue level, tempo | CC 47 / 13 | unmapped (relative encoders: not supported) |

## 5. Follow-ups / known limits
- Relative encoders (cue level, tempo knob) are not supported by Learn.
- A modal dialog in the window blocks all MIDI (engine behaviour).
- An unplug prints `snd_rawmidi_read error` lines for ≤ 0.5 s until the re-open.
- One reader per controller: a second client on this box (or any other MIDI app) cannot read it while the GUI holds it.
- `sudo apt install poppler-utils` to read the Akai protocol PDF on the box.
- Run `node tools/wo/build-index.js` and `node tools/wo/check-wos.js` for this WO (not run by the implementing agent: INDEX.md
  was off-limits).

## Owner QA

Owner 31.10.26: "good" — physical QA on the real hardware passed.
