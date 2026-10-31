# WO-879 — Tap tempo: the operator's beat when the tracker cannot lock (and when the feed dies)

**Area:** audio, godot-client
**Status: IN PROGRESS (31.10: built; node smoke 5/5 incl. the real FFT engine on silent frames, Godot suite 24070/0, UI on Xvfb; taps against live music on the box wait for the server — stopped by the eggs build)**

Loop task (owner 31.10): visuals "in a very good shape and ready for a show". Follows [WO-878](./878_WO_visuals_autopilot_beat_quantised_looks.md).

## 1. Investigation

- Every beat consumer — the Caspar shaders (`template/shaders/player-beat.js`), the Godot Visuals scenes and the WO-878
  autopilot — reads one thing: `beat {n, age, bpm, conf, phase, level, locked}` in the `audio_fft` WS frames, made by
  the detector (`src/audio/beat-detect.js`, WO-662/872) in `src/audio/audio-capture-fft.js` `emitFrame`.
- Nothing lets the operator give the beat. `rg -i "tap.?tempo"` over src/, client/ and godot/client: no hits. A live
  band, a quiet / rubato passage or a room mic leaves `locked: false` — the autopilot then runs a 120 BPM clock
  (WO-878) that has nothing to do with the music, and the beat-reactive shaders only fire on onsets that agree with the
  grid.
- A dead feed is worse: `emitFrame` sends ONE stale frame (`staleFrameSent`) and then nothing, so every beat stops.

## 2. What was done

- `src/audio/beat-tap.js` (new, pure): `createTapTempo()`.
  - `tap(t)`: taps more than 2 s apart start over; a tap < ½ beat at 240 BPM after the previous one is a bounce. Two or
    more taps → the tempo is the mean interval of the last 8 (40–240 BPM) and the tapped grid takes over the beat.
    Every tap is a beat and the grid restarts on it; a tap within ¼ beat after a grid beat is that beat (late tap, no
    double). One tap more than 2 s after the last re-phases ("the beat is here") and keeps the tempo.
  - `auto()`: the detector's beat again.
  - `merge(det, t)`: the frame's beat — the detector's snapshot, or the tapped grid (`locked: true, conf: 1, tap: true`,
    the detector's `level`). `n` is rebased so it only ever counts up by real beats across every switch (consumers read
    a change of `n` as a beat): the tap that starts the tempo is one beat, the way back to the detector adds none.
- `src/audio/audio-capture-fft.js`: both frame paths send `tapTempo.merge(beat.snapshot(), Date.now())`; while tapped,
  a dead or silent feed keeps sending silent frames with the tapped beat (the detectors reset once); `engine.tap(b)`.
- `src/bootstrap/audio-capture-lifecycle.js`: `appCtx.audioTap`. `src/api/routes-audio-parts-capture.js` `handleTap` +
  `src/api/router.js`: `POST /api/audio/tap` — `{}` a tap, `{ auto: true }` the music's beat; 503 without a capture.
  Server-side taps on purpose: one tempo for every consumer, and Companion / a Stream Deck can post the same request.
- Godot Show block (`visuals_show.gd`): a Tempo row — Tap (fires on the press, not the release) and Audio (pressed =
  the music's beat; click to leave the tapped tempo). `visuals_show_ctl.gd`: key T taps; `tap()` posts through the
  `/root/Api` autoload (looked up at runtime so the test runner compiles it); `status()` says "Tapped N BPM" and
  releases Audio from the frames' `beat.tap`, so a tap from elsewhere (another client, Companion) shows too.

Taps travel over HTTP, so a remote client's network jitter lands in the tap times; the mean over up to 8 taps evens the
tempo, a constant latency shifts the phase (re-tap one beat to fix it by ear).

## 3. What was verified

- `tools/smoke/smoke-wo879-tap-tempo.test.js` 5/5: 2 taps 500 ms apart → 120 BPM, the second tap is a beat, then one
  beat per 500 ms each within a frame of the grid; the mean of 4 taps → 120.8 BPM; a late tap is the grid beat (no
  double); an off-grid tap is a beat on the tap and the grid runs from it; bounce ignored; >2 s gap starts over;
  40 / 240 limits; back on auto the detector's beats count on from the tapped `n`; the route (503 / 200 + state); the
  REAL engine (UDP source, no PCM) keeps sending silent frames carrying the tapped, locked beat and stops after auto.
- Godot suite 24070 passed / 0 failed, incl. `test_tap_row` (signals, Audio state, "Tapped 124 BPM" note).
- UI: the client on Xvfb :377 — the Tempo row under "Picked looks land on the beat", T pressed, no script errors.
- NOT yet: taps against music on the box (server inactive since the eggs build): tap along to test music with the
  autopilot on bars, check the Caspar shaders' beat flashes follow the taps, pull the feed and check they go on.
