# WO-875 — Spectrum smoothing after GLava for every shader + a Spectrum scene in the Visuals

**Area:** audio, engine, godot-client
**Status: IN PROGRESS (31.10: smoothing in player.js + the Godot Visuals, Spectrum scene, offline-verified; on-box shots pending a server restart)**

Owner, 31.10: *"Check this project and see if anything from it would be beneficial https://github.com/jarcode-foss/glava"*,
then, on the review: *"Yep, smoothing is something we need. Add this to the visuals engine and to any existing shader etc."*

## 1. Investigation

- **GLava** (`6fc0e32`, 2021-06-17, GPLv3, dormant), cloned read-only to the session scratchpad. What makes its bars look
  clean is the chain between FFT and drawing, not the drawing:
  - `glava/render.c:720` `transform_gravity`: a bin rises at once, then drops a fixed `gravity_step` per second
    (rate-independent: `g = gravity_step / ur`).
  - `glava/render.c:739` `transform_average`: the last `avg_frames` (default 5–6) frames averaged with a raised-cosine
    window (`window_frame` = 0.6 − 0.4·cos, `window_shallow` = 0.7 − 0.3·cos for 3 frames, `shaders/glava/util/common.glsl`).
  - `shaders/glava/util/smooth.glsl` `smooth_audio`: each displayed point averages a neighbourhood whose width is fixed on a
    log scale — wide at the top of the spectrum, narrow in the bass; average / maximum / hybrid (0.65) sampling.
  - `render.c:845`: a linear high-frequency boost (`fft_scale`) so the treble is not flat.
  - Not useful here: glfft (GPU FFT; ours is 512 bins at 30 Hz on the CPU, trivial), PulseAudio input (we have ALSA + the
    bridge UDP tee), X11 transparency / WM env files, glava-obs, its `#request` shader preprocessor.
- **Our texture** (`src/audio/fft.js:104` `analyserFreqBytes`): AnalyserNode semantics — Blackman, one symmetric
  exponential smoothing (0.6), dB → bytes, linear bins, emitted at **30 Hz** (`audio-capture-fft.js` `emitHz`). Every
  renderer runs at 50/60 fps, so each byte holds still for one rendered frame and jumps on the next: a 30 Hz staircase.
  Renderers: Caspar's `template/shaders/player.js` (WS tier B, plus the getUserMedia / OSC fallbacks), the Godot Visuals'
  Shader scene (WO-874, the same WS frames). The Visuals' bus envelopes (Flow "Shape" attack/release, WO-861/873) already
  smooth the *summary* levels; nothing smoothed the per-bin spectrum.
- **The texture contract stays.** 190 library shaders are tuned to AnalyserNode bytes and linear bins (bin k = k·46.9 Hz),
  so smoothing must not re-map frequencies. Spread is therefore a box average in linear bins whose radius grows with k
  (GLava's log-scale idea without moving any frequency), and it runs in the renderers, per rendered frame — the node keeps
  emitting the raw frame (beat / bands / parts still read the raw spectrum).
- **Measured offline** (scratchpad `w875/sim.js`: real tracks → the node's own `analyserFreqBytes` at 30 Hz → 60 Hz
  renders; bins 1–399; "frozen" = render frames where a bin did not move; lag = cross-correlation of bins 1–7 vs raw):

  | track | config | jitter (mean abs Δ/frame) | frozen | direction flips /bin/s | bass lag |
  |---|---|---|---|---|---|
  | disco.00010 | raw | 4.03 | 52 % | 13.1 | 0 |
  | | fall 240, frames 3, spread .02 | 2.66 | 12 % | 10.7 | 17 ms |
  | | fall 150 | 2.31 | 12 % | 9.6 | 17 ms |
  | | frames 5 | 2.34 | 14 % | 8.7 | 33 ms |
  | rock.00003 | raw | 4.93 | 52 % | 11.0 | 0 |
  | | fall 240, frames 3, spread .02 | 3.71 | 8 % | 8.7 | 17 ms |
  | | fall 150 | 3.09 | 7 % | 7.3 | 17 ms |

  hiphop.00012 matches disco (raw 4.16 → 2.82). Default chosen: **fall 200 B/s (≈ 55 dB/s), frames 3, spread 0.02** —
  between the two fall settings, one frame of lag (frames 5 doubles it for little more).

## 2. What was done

- `template/shaders/player-smooth.js` (new, ~100 lines): `create(n).step(raw, dt, params)` — spread (prefix-sum box,
  radius floor(k·spread)) → gravity (instant rise, ≤ fall·dt drop, dt clamped to 0.1 s, fall 0 = off) → windowed average
  of the last `frames` outputs (GLava's windows). `frame(raw, p)` takes dt from `performance.now()`. Browser:
  `window.__SHADERFX_SMOOTH__`; Node: `module.exports` (tests, config clamping). A companion like `player-beat.js`
  because player.js is at the 500-line limit.
- `template/shaders/player.js`: loads the companion (not in thumbnail renders), keeps `msg.data.smooth` from each WS
  frame, and uploads `smoother.frame(freqBytes, smoothCfg)` — every tier (WS, analyser, OSC levels) goes through it;
  thumbnails keep the raw bytes (deterministic library thumbs). Missing companion = the raw spectrum, as before.
- `src/audio/audio-capture-fft.js`: config `audioCapture.spectrum` (`false` = off, or a partial `{fall, frames, spread}`)
  → `cfg.spectrum`, clamped by the companion's own `params()`; `src/bootstrap/audio-capture-lifecycle.js` sends it as
  `smooth` in every `audio_fft` frame, so one setting drives Caspar and Godot alike.
- `godot/client/features/visuals/spectrum_smooth.gd` (new): the GDScript twin (same steps, float32 state, same rounding).
  0.13 ms per step (600-step bench, headless).
- `visuals_stage.gd`: smooths row 0 once per frame (only while a layer reads audio) and hands it to the Shader and Spectrum
  scenes; a stale feed now falls away under gravity instead of cutting to black.
- `scenes/spectrum.gd` (new) "Spectrum", after GLava's radial module: a mirrored ring of up to 160 bars around a thin
  circle, bass at the bottom, treble at the top on both sides; bins on a log scale 40 Hz–16 kHz, hybrid average/peak per
  bar (0.65), a noise floor (0.35 of the byte range) and a treble tilt (+0.18). amount = bar count, pulse = length,
  spin = rotation, speed = colour drift, hue/glow = colour/HDR, burst = all bars jump. Model SCENES + picker.
- Probe: `--probe-visuals-shots` adds spectrum, spectrum+shader, tunnel+spectrum (no burst on the spectrum shots).
- Written from GLava's documented behaviour, no code copied; credited in the file headers.

## 3. What was VERIFIED

- Node: `tools/smoke/smoke-wo875-spectrum-smooth.test.js` 7/7 (off = raw, gravity, dt clamp, spread, the frame window step
  22/78/100, config clamping incl. `spectrum:false`, the parity golden, the wiring). Related smokes unchanged: WO-662 14/14,
  WO-333 16/16, WO-266 10/10, WO-861 15/15. Curated list updated.
- Godot suite 23987/0, incl. `test_spectrum_smooth.gd`: the same parity golden as the JS (GDScript and JS produce
  identical bytes for 8 frames of the same input), the stage hand-off (smoothed row reaches the scene; a stale feed falls
  200/s × 0.05 s = 10 bytes), Spectrum `level()` (silence, full scale, the bass bins, the tilt).
- Pending: on-box screenshots with test music (the node service was stopped by the 00:33 eggs build and needs the owner's
  `sudo systemctl start highascg`), and a Caspar template replay to pick up player-smooth.js on air.
