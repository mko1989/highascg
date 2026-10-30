# WO-861 — Real-time audio "parts" for live visuals: drum hits, tonal, mood/energy buses from the live input

**Area:** audio, engine, godot-client
**Status: DONE (30.10, offline smokes + RTJ track + the box's live USB input over WS audio_fft)**

Owner, 30.10, on [WO-858](./858_WO_godot_audio_reactive_visuals_report.md) §3.2's recommendation ("for live shows, build our own analysis on
the server's audio feed, borrowing CanYuzbey's mood/energy formulas"):
> yes this. it needs to be real time based on the audio input from a dj/band.

and on which parts matter (drum hits, vocals, or mood/energy sections): "not sure yet". So this WO builds every part that can be computed in
real time and names them as buses (WO-858 §3.3), so the choice can be made later by binding, not by rebuilding.

## 1. Investigation

### 1.1 The live input path today **[repo]**

- A DJ/band feed enters as a live-audio slot (DM3 = slot 1). The slot's bridge ffmpeg tees raw s16le/48 kHz/stereo PCM to
  `udp://127.0.0.1:5222<slot>` (`src/audio/live-audio-bridge.js`), the node's FFT engine listens there
  (`src/audio/audio-capture-fft.js`, source `'slot'`) — box 30.10: `config/caspar_server.json` `audio_fft_source_slot: 1`, journal
  `[AudioFFT] listening for bridge PCM tee on udp://127.0.0.1:52221 (30Hz frames)`. The DM3 itself is not enumerated right now
  (`arecord -l`: ALC1220, Sennheiser SC60 only), so the port is idle.
- `pushSamples` feeds every mono sample to the WO-662 beat detector (`src/audio/beat-detect.js`: 1024-point FFT per 512-sample hop,
  spectral-flux onsets, autocorrelation tempo, phase-locked grid). `emitFrame` (30 Hz) sends `{freq, wave, rms, beat, bands}`;
  `src/bootstrap/audio-capture-lifecycle.js` broadcasts it as WS `audio_fft` to every client. Bands are 3 means of the dB-mapped
  analyser bytes (≤250 Hz, ≤4 kHz, above).
- No drum-class onsets, no tonal/harmonic measure, no loudness normalisation, no mood or section. Nothing in `godot/client` reads
  `audio_fft` (WO-858 §1.1).
- So the hop clock and the PCM are already there; a second analyser on the same samples adds no I/O and no device contention.

### 1.2 CanYuzbey/music-reactive-lighting — what is borrowed **[gh]**

MIT, commit `68880191d8c232e92ec7e3a80bbe39941709d749` (14.03.2026). Read 30.10: `app/mapping/emotion.py`, `app/audio/live_analyzer.py`,
`loudness.py`, `onset.py`, `pitch_register.py`, `lighting/dynamics.py`, `tempo.py` (density), `utils/time_window.py`.

| Piece | Their formula | Port |
|---|---|---|
| Arousal | `0.5·loudness + 0.4·density + 0.1·onset`; + `(peak_exertion − 1.5)·0.1` when a band's exertion > 1.5 | as is |
| Valence | tri-band *exertion* = band share / its slow average (`lr 0.005`/frame); dominance = (mid+high)/(sum); `0.3·(0.5+(d−0.66)·1.5) + 0.7·(0.5+(d−0.66)·3)`, +0.15 on onset > 0.3 | as is (defaults; their "memory bank" baselines are learned from the author's songs — not ported) |
| Glide | per frame `0.05 + 0.15·arousal + 0.2·onset`, clamped 0.02..0.6; silence: valence → 0.5 at 0.01, arousal → 0 at 0.05 | as is, at their 30 fps |
| Bands | magnitude sums: low 20–250 Hz total, **mid 250–2000 Hz harmonic only** (HPSS), high 2–8 kHz total, as shares | same bands; HPSS made causal (below) |
| Density | `1 − (avg IOI − 0.1)/0.9` over the last 20 inter-onset intervals ≥ 0.2 s | as is, plus: the running gap counts once it exceeds the average, so a break lowers density (theirs freezes) |
| Loudness | RMS → fixed-threshold gate (tuned to the author's input: 0.056–0.06 RMS) → adaptive max → `x^0.45`, instant attack, release 0.012/frame | gate in dBFS (−60, like WO-662), not their fixed RMS; rest as is |
| Dynamics | drop = instant ≥ 0.65 ∧ (instant − 10-frame avg) ≥ 0.35 ∧ onset ≥ 0.55; minimal mode = 10-frame avg < 0.15 for 3 s, exit > 0.20 | as is → `drop` event + `quiet` section |
| Onset | mean \|dx\| + 0.6·RMS with fixed floor/ceiling (author's levels) | **not ported**: replaced by our spectral flux relative to its own last second (level independent, WO-662) |

Their live path runs librosa HPSS on a 4096-sample window per 30 fps frame (offline-style median filters). For the node: a **causal**
HPSS — harmonic = median of a bin over the last 9 hops (≈ 96 ms), percussive = median across ±8 bins of the current hop, mask
`H²/(H²+P²)` — costs ~150 bins × a 9-point median per hop.

### 1.3 What real time allows, per part

| Part | Real time? | How |
|---|---|---|
| kick / snare / hats | yes | band-limited spectral flux, each against its own last second (mean + k·std and × ratio, re-arm, refractory) — kick 40–150 Hz, snare 1–5 kHz with its body, hats 6–16 kHz. Kick and snare bleed into each other's bands; classification is a heuristic, measured on synthetic hits and a real track |
| bass / mid / high levels | yes | band energy against a decaying peak (AGC), so a quiet DJ and a loud band both use the 0..1 range |
| vocals | **no, only a proxy** | true vocal separation needs stems (spleeter/open-unmix: window latency, GPU — WO-858 §3.3). Real-time proxy `tonal` = harmonic energy 300–3400 Hz × harmonic ratio: rises with vocals, but also with leads/pads |
| mood (arousal/valence) | yes | CanYuzbey port above |
| sections | partly | `quiet` (their minimal mode), `drop` event (theirs), `build` (rising 1 s loudness over 6 s) — heuristics |
| beat / BPM | yes (exists) | WO-662, unchanged |

### 1.4 Found on the live input (box 30.10, owner's music on a USB Audio CODEC, slot 1 = `hw:3,0`)

- **Absolute sections saturate.** A steadily loud, compressed mix sat at loudness ≈ 0.87, energy 0.87 → `peak` for the whole
  90 s run. CanYuzbey's loudness is self-normalising (adaptive max), so an absolute "≥ 0.75 = peak" says nothing on a
  mastered mix. → `peak` is now relative: the 1 s loudness in the top fifth of the last 2 minutes' range, when that range is
  ≥ 0.15; a 10 s warm-up keeps a restart's fade-in out of the range.
- **Their drop rule fires on every hit in a sparse break**: 10 drops in 15 s (replayed from the run's WS frames:
  `drops 10 63.9 64.0 65.2 … 74.6 74.6 74.7`). → a drop also needs the 4 s before the 10-tick window to be ≥ 0.35 quieter,
  and at most one per 8 s. Replayed on the same frames: run 1 → 0 drops, run 2 → 1 (63.9 s, the break).
- **A node restart left the owner's live input dead** (`src/audio/live-audio-health.js`, `src/audio/live-audio-bridge.js`).
  Journal 13:46:20: the startup routing and the meter watchdog both ran `playLiveAlsaClipWithRecovery` for slot 1;
  `ensureLiveAudioBridge(force)` SIGTERMed the running ffmpeg and spawned the next one **without waiting for it to exit**,
  so the second open of the single-open USB card failed `cannot open audio device hw:3,0 (Device or resource busy)`
  (`ffmpeg exited 251`), each run tore down the other's bridge, both ended `all_variants_failed`. Then the producer check
  looked once, 450 ms after PLAY, and judged a fresh bridge dead that was playing a second later (`INFO 7-10`: udp
  producer, time 60 s) — so even a clean start bounced the bridge.
- **WO-662 beat grid on live music**: on the first track BPM wandered (79/92/115/130/158, conf ≤ 0.25, a beat every
  ~250 ms) while the hits' own autocorrelation said 92 BPM (period 1300 ms = 2 beats, kick/snare backbeat); on the second
  track it held 98 BPM, conf 0.5–0.7. Not changed here — a WO-662 follow-up if the owner binds visuals to `beat`.

## 2. What was done

- `src/audio/audio-mood.js` (new): the CanYuzbey port (MoodEngine, AdaptiveNormalizer, density, DynamicsController) on a
  30 Hz tick, departures listed in the header; relative `peak`, gated `drop`, warm-up (§1.4).
- `src/audio/audio-parts.js` (new): 2048-pt Hann spectrum per 512-sample hop on the WO-662 samples. Drum onsets per band
  (kick 40–120 Hz, snare 1–5 kHz + body, hats 6–16 kHz) = flux vs the band's last second, floor 0.5 (a steady tone's
  jitter < 0.1, a hit > 1), decided 2 hops later (21 ms; on the attack hop the energy is still climbing — the first
  near-peak gate dropped kicks), counted only within 24 dB of the band's own peak, and co-fire rules measured on a
  synthetic kit (kick click 44 dB under it in the snare band, snare on a kick 20–22 dB, hat 25 dB under itself in the
  snare band). AGC levels, causal HPSS `tonal`, mood tick from the sample clock. `reset()` clears pulses.
- `src/audio/audio-capture-fft.js`: pushes every sample to the parts, resets them on a stale feed, `parts` in each frame;
  `src/bootstrap/audio-capture-lifecycle.js`: `parts` in the WS `audio_fft` broadcast:
  `{kick|snare|hats: {level, onset, n}, bass, mid, high, tonal, loudness, onset, density, arousal, valence, energy,
  section, drop: {n, age}}` (`onset` = pulse 1 → 0 over 150 ms, `n` = hit counter: a 30 Hz consumer never misses a hit).
- Live-audio start (§1.4): `playLiveAlsaClipWithRecovery` is single-flight per slot (a second caller gets the running
  recovery's result); `ensureLiveAudioBridge` waits for the replaced ffmpeg's `close` (≤ 1.5 s) before spawning; the
  producer check polls INFO for 2 s after `verifyMs`.
- `THIRD_PARTY_NOTICES`: CanYuzbey/music-reactive-lighting MIT entry with the ported files and the licence text.
- No Godot view here: the owner asked (30.10) for a **Visuals** tab, where the buses get bound — WO-862.

## 3. Verified

- Smokes: `smoke-wo861-audio-parts.test.js` 15/0 (mixed kit → exactly 9 kicks / 5 snares / 18 hats; each drum alone →
  no cross-counts; held chord → no hits, tonal lit; sections; sparse break ≤ 1 drop — the old rule gives 14 and fails;
  mood formulas; wiring), `smoke-wo861-live-audio-single-flight.test.js` 3/0, WO-662 14/0 (regex now spans prettier's
  wrap), live-audio smokes 21/0. Cost: 9 s of analysis for 242 s of audio (≈ 4 % of a core).
- RTJ "Legend Has It" (offline, 242 s): BPM 120.9; hits folded on the fitted grid (16ths over a bar) are structured —
  61 % of kicks in the bar's first half, snares on 8th positions, hats on even 16ths.
- Box, RTJ streamed into `udp://127.0.0.1:52221` at real time: 876 WS frames in 32 s, all with `parts`; 98 kicks / 28 s.
- Box, the owner's live music (USB CODEC → slot 1 → tee): two 90 s runs, 29.4–29.7 frames/s all with `parts`.
  Run 2 (98 BPM): drum hits fold onto the beat grid on the beat and the "and" (kick 19/16/11/7/16/11/13/8 %), the
  60–80 s break shows loudness 0.38 → `build` on the way back.
- Box restart after the fix (13:50): `[live-audio] slot 1 capture running on 7-10 … repaired 1 input(s)`, no busy errors
  (before: `all_variants_failed`, no live audio).
