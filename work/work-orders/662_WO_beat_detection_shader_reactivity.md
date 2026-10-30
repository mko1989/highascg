# WO-662 — Beat detection woven into shader audio reactivity

**Area:** audio, engine
**Status: DONE (21.10.2026: offline 2730/0 + Godot 20773/0, detector checked on real music, shader runtime checked in headless Chrome, save → store → export checked on the box). Owner QA: a shader on air with the FFT source routed (no FFT source is routed on the box right now).**

Owner, 21.10: *"Add beat detection and a way to weave it into shaders audio reactivity. This is for both webui and Godot"* (the categorisation half of the same message is [WO-661](661_WO_template_categories_shader_gpu_warning.md)).

## Investigation

**What shaders had before**
- The audio path (WO-333; see [WO-335](335_WO_SHADER_AUDIO_PROGRAM_PATH_WS_TIER_PRIORITY.md)) is `src/audio/audio-capture-fft.js`. It reads a UDP s16le tee from the routed live-audio slot (or its own `arecord`), keeps a 1024-sample mono ring and emits `{freq, wave, rms}` at 30 Hz. The WS sends that as `audio_fft`, and `template/shaders/player.js` writes it into a 512×2 texture that shaders read as `iChannelN = audio`.
- No beat, onset or tempo code existed anywhere (`rg -i "beat|bpm|onset"` over `src/`, `template/` and `client/`).
- Shader parameters are GLSL literals, so changing one means a recompile (Shader Live, WO-606).

**Detector, first attempt (rejected)**
- Design: low-band energy (two one-pole low-passes at 150 Hz), onset when the level rises over the last 1.5 s mean + k·std, tempo from the median inter-onset interval.
- Synthetic kicks passed. Real audio failed. The box has `media/testowe/…/PK BACK TRACK.wav` (a 47-minute show backing track) plus its `PK CLICK.wav`, which gives the true tempo.
  - 20–80 s: the low band is −63.5 dB mean (ffmpeg `volumedetect` after the same low-pass), under any sane gate, so 2 beats in 25 s.
  - 2200 s: click 107 BPM, detector 73 BPM at confidence 0.27.
  - The backing track is for a live band: the drummer plays live, so the track has little or no kick. A kick-only detector cannot work on music like that.
- Interval medians were also fragile. At 174 BPM, hop jitter puts intervals both sides of the fixed 333 ms (180 BPM) fold edge, so half of them doubled.

**Detector, second design (kept) — the standard pipeline**
1. Onsets come from spectral flux, not low-band energy.
2. Tempo comes from autocorrelation of the onset envelope.
3. A phase-locked beat grid ignores off-grid onsets.

Bugs found in it while measuring, all fixed:
- A beat that fired before any tempo existed set `nextBeat = t + 60000/0` = Infinity, so the grid never fired again (4 beats in 20 s at 181 BPM).
- The parabolic peak refinement ran away (BPM −14, 26). It is now clamped to ±0.5 lag.
- A tempo switch kept the old grid's `nextBeat`.
- On spiky flux with a fractional period, 174 BPM locked at 69.5. Smoothing the envelope with [1 2 3 2 1] before the autocorrelation fixed it.
- Plain noise produced onsets via mean + 1.5·std. Onsets now also need 1.5× the mean.

## What was done

**`src/audio/beat-detect.js` (new)**
- `createBeatDetector({ sampleRate })` is fed every raw sample from `pushSamples`, so it does not run off the 30 Hz frames. Hop is 512 samples (10.7 ms).
- Each hop: a 1024-point FFT, log-magnitude flux up to 10 kHz, and a −60 dBFS gate.
- Onset: flux > max(mean + 1.5·std, 1.5 × mean) over the last second, one per rise, 100 ms refractory.
- Tempo:
  - every 32 hops, autocorrelate 6 s of smoothed flux, with half the double-lag added in;
  - range 70–180 BPM, with a log-Gaussian prior around 120;
  - a new tempo must be seen twice before it replaces the current one.
- Grid, once confidence ≥ 0.12:
  - beats fire on the grid, so the flywheel covers a missed kick;
  - an onset within ±20 % of the grid point early is the beat;
  - an onset late by up to 20 % pulls the grid half-way;
  - off-grid onsets (hats, offbeats) are ignored;
  - the grid stops 2 s after the last onset.
- `snapshot()` returns `{ n, age, bpm, conf, phase, level }`.
- `bandsOf(freq)` returns bass / mid / high (≤ 250 Hz, 250 Hz–4 kHz, above) from the same freq bytes the texture carries.

**`audio-capture-fft.js` + `bootstrap/audio-capture-lifecycle.js`**
- Each frame now carries `beat` and `bands`; the WS `audio_fft` broadcasts them.
- A stale feed resets the detector (tempo and grid). The count keeps rising.

**`template/shaders/ShaderToyLite.js` (vendored; the "WO-662 patch" is marked, and `vendor/` stays pristine)**
- New uniforms for every pass:
  - `iBeat`: x = pulse 1→0, y = BPM, z = phase, w = count;
  - `iAudioBands`: bass, mid, high, level;
  - `iBeatFx`: the per-shader knobs. Image pass only; zero in buffers, so feedback buffers don't compound.
- `main()` wraps `mainImage`:
  - **bump** zooms toward the centre by up to 12 % on the pulse;
  - **flash** multiplies RGB by 1 + flash·pulse.
- `setBeat()` feeds the uniforms. `addTime()` implements **kick**: iTime surges on the beat, and `play()` keeps the offset.

**`template/shaders/player-beat.js` (new, lazily loaded; player.js is at 475 lines)**
- Extrapolates `age` from each frame's arrival time, then computes pulse = exp(−age / 180 ms) and phase from BPM. The pulse is smooth at any render rate even though frames arrive at 30 Hz.
- A stale feed (> 1.5 s) sends zeros.
- Kick adds `kick × 4 × pulse × dt` seconds of iTime, about 0.7 s per beat at kick = 1.

**`template/shaders/player.js`**
- Loads the companion only for audio-reactive shaders, and not in thumb mode.
- Forwards `audio_fft` frames to it and calls `update()` on each draw.
- `window.update({ beat })` changes the knobs live, with no recompile.

**Knobs, `config.audio.beat = { flash, bump, kick }` (each 0..1)**
- `shader-store.js` `normalizeBeatKnobs` clamps them and drops the key when all three are 0, so old configs keep their shape.
- On `POST /api/shaders`, `routes-shaders.js` `pushBeatKnobs` sends CG UPDATE `{ beat }` to every live instance of the shader, so a save reaches the shader on air without a re-take. A failed push never turns a good save into a 400. The response carries `live: { targets, errors }`.
- Web, `shader-fx-modal.js`: a "Beat" row with flash / bump / kick sliders, shown only while "audio reactive" is ticked. The tooltip names the uniforms for shader authors. After a save, the status line says how many layers took the knobs live.
- Godot, `shader_fx_dialog.gd` + `shader_fx_model.gd` (Haiku agent, diff reviewed): the same row, using `beat_knobs` / `beat_of`, and `collect(..., beat)`.

**Why not alternatives**
- Server-side beat → texture row: it would need a texture-layout change that every existing shader reads.
- Knobs as GLSL literals: every drag would recompile.
- Beat detection in the page (Web Audio): it can't run, because Caspar's CEF has no audio input here (WO-335). The node already has the PCM.

## What was VERIFIED

**Offline suite**
- `npm run test:ci`: 2730 tests, 2730 pass, 0 fail, 2 skipped.
- `tools/smoke/smoke-wo662-beat-detect.test.js`: 14 tests.
  - Kicks + 8th hats at 96 / 120 / 128 / 174 BPM: tempo within 1.5 %, one beat per kick between 6 and 14 s. At 174 BPM, half time (87) is accepted, with beats that follow it.
  - A dropped kick is bridged; noise gives no beats; a held bass note gives ≤ 2; silence stops the grid.
  - Bands, wiring, ShaderToyLite uniforms, player companion, store normalisation, save push, modal sliders.
- Neighbour smokes wo333 / wo266 / wo268 / wo376: 44 pass.

**Other gates**
- Lint: 214 warnings, under the cap.
- Prettier `format:check` passes. The max-lines check passes; `08d-modals-shader-fx.css` was trimmed to stay at 500 or under.
- Unwired exports: no new ones.
- `build:client` passes.
- Godot `--test`: 20773 pass, 0 fail. `--check`: boot OK.

**Real music on the box** (ffmpeg decode → detector; 20 s segments)

| Input | Result |
|---|---|
| Click track, 10 points across 47 min | Locks on every one (conf 0.86–1.0); beats on the 500 ms grid ±1 hop at 120 BPM after the lock |
| Backing track + click mixed (a stand-in for a band with drums) | Same tempo as the click alone, 10/10 |
| `SHORT JINGLE .mp3` | 110–111 BPM in every segment; 27 beats / 15 s |
| Long jingle, 300 s | 564 beats at 111 BPM |
| Backing track alone (drumless) | Matches the click at 5 of 10 points; the others land on related tempos (×1.25 / ×1.45). Expected without drums; this is not the FFT source in a show, where the DM3 mix carries the live drums |

- Octave choice is a judgment call: the click at 1500 s read 77 with one design and 154 with the other. Shaders get phase and pulse either way.
- CPU: 300 s of audio processed in 727 ms, which is 0.24 % of one core.

**Shader runtime, headless Chrome** (the thumbnailer's `headless-chrome-cdp.js`)
- Setup: a scratch copy of `ShaderToyLite.js` / `player.js` / `player-beat.js` plus exported test pages, with a fake WS sending `audio_fft` beat frames at 120 BPM. Pixels were read inside rAF right after the draw.
- Uniforms page (`c = vec4(iBeat.x, iBeat.y/240, iAudioBands.x, 1)`):
  - R cycles 194 → 122 → 77 → 49 → 30 → 19 every 500 ms (the pulse);
  - G = 128 (120 BPM);
  - B = 204 (bass 0.8).
  - This proves the patched header compiles and the uniforms flow.
- Flash 1 on flat grey 64: peaks at 107–117 on the beat and decays to 64. After `window.update('{"beat":{"flash":0,...}}')` it holds 64 flat, so knobs change live with no recompile.
- Bump 1 (`c.r = fragCoord.x / width`, sampled at x = 300 of 320): 239 → 231 on the beat; constant 239 after the knobs go to 0.
- Kick: not measured; it is pinned by source asserts only.

**Box**
- Node restarted on the final code. `GET /api/shaders` returns 190 shaders.
- `POST /api/shaders` of `sh-test` with `audio.beat {0.6, 0.3, 0}`: stored config and exported `sh-test.html` both carry `beat`. Re-posting the original removes it again (the key is dropped when absent).
- Not verified live: the beat fields on the real WS and a shader on air. The node logs `[AudioFFT] no source routed … and config.audioCapture disabled`, so no `audio_fft` frames flow on the box right now (0 frames in 10 s).
- **Owner QA:**
  1. Route the FFT source (DM3 slot) in the live-audio inspector.
  2. Put an audio-reactive shader on air.
  3. Set flash / bump in Shader FX and save. The shader on air should start pulsing without a re-take.
  4. Check that the Godot Shader FX dialog's Beat row looks right; it has not been seen on screen.

## Follow-ups (not done)
- Show the live BPM / confidence somewhere (e.g. the live-audio inspector next to the FFT source). The data is on the WS already.
- Shadertoy imports that use `iChannelN = audio` get `iBeat` for free; a few library shaders could be re-authored to use `iBeat.z` (phase) for on-beat motion.
