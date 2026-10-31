# WO-878 — Visuals autopilot: looks on the beat, the next look every N bars and on drops

**Area:** godot-client, audio
**Status: DONE (31.10: Godot suite incl. a tab-level beat → look → fade test; live on the box with test music — every 4 bars on the beat, a pick lands on the next beat)**

Loop task (owner 31.10): visuals "in a very good shape and ready for a show". Follows [WO-877](./877_WO_visuals_show_looks_crossfade_master.md).

## 1. Investigation

- WO-877 gave looks and a fade, but a picked look started whenever the key was hit — off the music — and nothing changed
  unless the operator did it. A VJ set needs the cut / fade start on a beat, and an unattended mode for long sets.
- The box already sends what is needed in every `audio_fft` WS frame: `beat` = `{n, age, bpm, conf, phase, level, locked}`
  (`src/audio/beat-detect.js:94`) — `n` counts beats fired **at predicted instants** by the WO-872 grid, so a change of `n`
  between two 30 Hz frames is a beat that just happened (≤ 33 ms late) — and `parts.drop.n` counts drops (WO-861).
- There is no downbeat: bars are counted as 4 beats from the last change, not from a detected "1". Phrase-true bar alignment
  would need downbeat tracking (not in the box's analysis); the counted bars still land every change on a beat.
- `locked` is false through silence and breakdowns (WO-872: the grid mutes, the tempo is held) — a quantised pick must not
  wait forever then.

## 2. What was done

- `visuals_autopilot.gd` (new, pure): `cfg_of` (`project.visuals.auto` = `{bars ∈ 0/4/8/16/32, drops, quantise}`,
  quantise on by default), `pick()` (now, or `pending` for the next beat when quantise is on and a tempo is locked), `step()`
  per frame (a beat = `n` changed while locked, else a 500 ms = 120 BPM free clock; a pending look goes on the beat or as
  soon as the lock is lost; every bars × 4 beats or on a new drop → the next look, wrapping), `bars_left()`.
- `visuals_show.gd`: Auto row (Off / Every 4–32 bars + Drops), "Picked looks land on the beat", a status line (tempo, the
  waiting look, bars to the next change). Show buttons never take keyboard focus (a clicked Blackout kept the focus and
  Space would have toggled it instead of bursting).
- `visuals_tab.gd`: the WS handler keeps the newest `beat` and drop count; buttons and keys 1–9 go through `pick()`;
  `_process` steps the autopilot and recalls with the look's fade; the 1 s tick refreshes the status line.
- `visuals_model.gd`: the slice carries `auto`.
- 31.10 later: the show logic (looks, autopilot, master, keys) moved out of `visuals_tab.gd` (485 lines, near the CI limit)
  into `visuals_show_ctl.gd`, a child node of the tab (`tab.show_ctl`); the tab is 381 lines.

## 3. What was VERIFIED

- Godot suite 24064 / 0. `test_visuals_show.gd`: quantise (waits for the next `n`, once; no lock / quantise off → at once; lock
  lost while waiting → goes), bars (every 16 beats at 4 bars → the next look; bars left; a change restarts the count), drops
  (the first count only arms; a new drop → the next look, wrapping; one look → nothing), the 120 BPM clock (4 bars ≈ 8 s
  of 60 fps frames), and through the real tab: a pick waits, the next beat fades look 2 in on the mixer, 16 beats later the
  autopilot fades look 1 back; the status line reads "Tempo 128 BPM".
- Xvfb screenshot of the Inspector's Show block (scratchpad `w877/ui.png`).
- Live, 31.10: `gtzan-disco.00010.wav` via `POST /api/audio/test-music` (beat locked 106.8 BPM, conf 0.99, 30 Hz, no
  doubled beats on the WS). The real client on Xvfb with `--probe-visuals-auto=40` (`visuals_probes.gd` `autopilot`;
  a probe client, `project_gone` so it never saves the box's project): three looks, 4 bars → look changes on beats
  n 432 / 448 / 464 / 480 (every 16 beats, ~9 s), each 0 ms after that beat reached the client; then autopilot off and
  a pick 0.25 s after a beat → not on stage at once, pending, landed on the next beat (n 496).
- Drops: suite only (the test clip has no drop worth the name); the drop path reads the same beat frames.
