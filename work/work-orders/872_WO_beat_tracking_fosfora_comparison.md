# WO-872 — Beat tracking: compare with fosfora, adopt its grid/tempo/benchmark ideas

**Area:** audio
**Status: OPEN (30.10) — investigation + ranked proposal written; step 1 (benchmark harness) is the next unit, owner may re-rank**

Owner 30.10: "I also found the vj visual app I want to take inspiration from for beat detection etc.
https://github.com/kevinraymond/fosfora".

## 1. Investigation

### 1.1 Sources read
- fosfora `82633d7` (2026-10-23), cloned read-only to the session scratchpad. A subagent wrote the full report and I spot-checked the load-bearing constants in the source. Paths below are relative to `crates/fosfora-app/src/audio/`.
- **License verified:** `LICENSE-MIT` + `LICENSE-APACHE`, `Cargo.toml:8 license = "MIT OR Apache-2.0"` (© 2025-2026 Kevin Raymond). The shipped tree models (`kick_model.json`, `beat_model.json`) are trained on CC-BY/CC0 Free Music Archive tracks. Credits are in `kick_model_tracks.md`, so reusing them needs that attribution.

### 1.2 Ours today
- **`src/audio/beat-detect.js`** (WO-662, 269 lines). It runs per 512-sample hop on the raw samples.
  - **Onset:** plain log-magnitude flux over one 1024-pt FFT up to 10 kHz, against the last second's `mean + k·std`, `RATIO·mean`, with a 100 ms refractory (`:150-180`).
  - **Tempo:** ACF of 6 s of flux, plus `0.5·acf(2·lag)`, at 70-180 BPM. The prior is a log-Gaussian at 120 BPM, σ 1.2 oct (`:116-117`). Confidence is `acf(best)/r0` (`:125`). A new tempo must repeat twice within 4% (`:126-135`).
  - **Grid:** locks at `CONF_LOCK = 0.12` (`:25`). Phase correction is ad hoc: an early onset IS the beat, a late one pulls the grid half-way (`:194-197`). There is no frequency trim. The flywheel stops 2 s after the last onset (`:200`), so a breakdown drops the grid and it must re-acquire.
  - **No octave defence** beyond the prior, **no lock hysteresis**, and confidence is a single ACF ratio.
- **`src/audio/audio-parts.js`** (WO-861/866). Per-drum band flux with SuperFlux ±1 bin, causal HPSS (`HPSS_T 9`, `HPSS_F 8`), and an AGC against a decaying peak (`AGC_RANGE_DB 36`, `AGC_DECAY_DB_S 1.5`, `:25-26`, `:103-125`).
- **`src/audio/audio-mood.js`** (WO-861). Section, energy and drop at 30 Hz.
- **Evaluation.** We have `tools/audio/eval-drum-detector.js` (MDB Drums, per-drum F). **There is no beat-tracking or tempo benchmark**, so the WO-662 tuning was done on synthetic tests plus one backing track.

### 1.3 fosfora's pipeline (what differs, with evidence)

| Stage | fosfora | Ours |
|---|---|---|
| Onset function | SuperFlux on 64 log bands 20 Hz-16 kHz of a 4096 FFT. Partition weights low/mid/high **0.60/0.28/0.12** (`beat.rs:317-319`). Threshold `median + 2·MAD` over 0.5 s, 50 ms cooldown. | Flat log flux, mean + k·std, 100 ms |
| Tempo | FFT-ACF over 8 s, bias-corrected `n/(n-lag)`. Top-5 parabolic peaks × 9 metrical ratios, scored by comb (h=1..4, 1/h) × log-Gaussian prior × continuity. 40-300 BPM. Genre prior presets (House 127/0.35, DnB 172/0.3, `beat.rs:98-99`). | ACF + 2·lag term, prior 120 |
| Seed | conf ≥ 0.35 (`beat.rs:646`), or two readings within 5% over ≥ 2 s | 2 hits within 4% |
| Filter | Kalman in log2-BPM, divergence reset | EMA 0.7/0.3 |
| Lock | Support EMA τ 2.5 s, enter **0.6** / exit **0.35** (`beat.rs:657-659`). Exposed as `tempo_confidence` + `beat_locked`. | conf ≥ 0.12, no hysteresis |
| Octave errors | After an 8 s lock, a metrical anchor: related levels fold onto it and octave evidence never displaces it. 30 s probation, 60 s "ghost" veto. | prior only |
| Grid | PLL: beats fire on the predicted grid. PI correction with phase gain **0.3**, trim gain **0.02**, trim clamp ±2% (`beat.rs:1716-1718`). Gaussian-scored onset bids (σ 60 ms). Support EMA < 0.2 → **muted free-run**, > 0.4 → resume with no re-acquisition. | onset snap / half-pull, stops after 2 s |
| Phase arbiter | Fixes off-beat or quarter-off locks from kick events plus learned activation | none |
| AGC | Percentile P5/P95 over 344 hops ≈ 4 s, soft knee 0.85 (`normalizer.rs:9,22`) | decaying peak 36 dB |
| Silence | BS.1770 K-weighted momentary, opens -55 / closes -60 LUFS, 0.25 s hold | dB gate |
| ML | LightGBM kick (72 in) + beat activation (168 in), pure-Rust tree walker | none |
| Bench | Ballroom / Harmonix / GiantSteps through the live causal path, mir_eval (F ±70 ms, CMLt, AMLt, Acc1/2, 5 s trim), tune/holdout splits, frozen pre-registered targets | none for beats |

Their own causal scores (`docs/BENCHMARKS.md`): Ballroom F .549 / Acc1 .689, Harmonix F .737 / CMLt .543, GiantSteps Acc1 .739. Lock time is 11-18 s. Their drop detector is weak by their own numbers (recall ≈ .27, precision ≈ .23), and downbeat F is .18-.31.

## 2. Proposal (ranked; each step is a separate verified commit)
1. **Beat/tempo benchmark harness first** (`tools/audio/eval-beat-tracker.js`).
   - Run `createBeatDetector` causally over the decoded audio of Ballroom (698 × 30 s, public) and GiantSteps tempo. Score F ±70 ms with a 5 s trim, CMLt/AMLt, and Acc1/Acc2. These are a small pure-JS port of the mir_eval definitions.
   - Use a fixed tune/holdout split. Datasets stay outside the repo (download script + sha list), like the MDB Drums eval.
   - Without this, every step below is guesswork, and fosfora's own history shows several "obvious" changes that lost points.
2. **Grid PLL + lock hysteresis** in `beat-detect.js`.
   - PI phase/trim (0.3/0.02, clamp ±2%) with Gaussian onset bids.
   - Support EMA τ 2.5 s, enter 0.6 / exit 0.35, exposed as `locked` next to `conf`.
   - Muted free-run through breakdowns instead of the 2 s stop. Shaders and DMX keep phase through a breakdown, and the drop lands on the grid.
3. **Tempo estimator.**
   - Bias-corrected ACF, comb h=1..4, top-N candidates × metrical ratios.
   - Seed gate, plus the metrical anchor (fold related levels after an 8 s lock).
   - Widen to 60-200 BPM.
   - A genre prior setting (House/DnB/HipHop/Wide) as an operator choice next to the beat sensitivity.
4. **Onset function.** SuperFlux on log bands with the 0.60/0.28/0.12 partition weights, and a median+2·MAD threshold with 50 ms cooldown. This reuses `audio-parts.js`'s SuperFlux helper.
5. **Percentile AGC** (P5/P95 over 4 s, knee 0.85) for the bass/mid/high levels in `audio-parts.js`, plus a LUFS silence gate with hysteresis. This removes pumping after a loud hit and noise-floor triggers in quiet rooms.
6. **Later / not now.**
   - The LightGBM models: needs a tree-walker port and CC-BY credits; the gain is incremental.
   - Phase arbiter: only if the benchmark shows off-beat locks.
   - Downbeat/drop: their own numbers are weak; our WO-861 mood/drop stays.

**Porting rules.** Ports of fosfora code or constants note it in the file header and get a `THIRD_PARTY_NOTICES` entry at the repo root (MIT, © Kevin Raymond; `licenses/` is a generated symlink). The model JSONs are not copied without their CC-BY track credits.

## 3. What was done
- Investigation and proposal (this file).
- **Step 1, benchmark (30.10).**
  - **Dataset.** Ballroom's MTG mirror refuses downloads (403). I used GTZAN instead, which is also a standard beat-tracking set: 1000 × 30 s, from `huggingface.co/datasets/marsyas/gtzan`, with beat and tempo labels from `github.com/TempoBeatDownbeat/gtzan_tempo_beat`. It lives in `~/datasets/beat`, outside the repo, and is evaluation-only. `home/casparcg/datasets` is now in both ISO exclude fragments, so it never reaches a stick. One file, `jazz.00054.wav`, is GTZAN's known-corrupt clip; the eval reports it and skips it.
  - **`tools/audio/beat-metrics.js`.** A line-for-line port of mir_eval 0.8.2 `beat.py`: `trim_beats` (5 s), `f_measure` (±70 ms, maximum matching using the same `est ± w` edge test as its searchsorted), `continuity` (CMLc/CMLt/AMLc/AMLt), plus MIREX tempo Acc1/Acc2.
  - **`tools/audio/eval-beat-tracker.js`.** Decodes each clip to 48 kHz mono and pushes it 512 samples at a time, as live. A beat is timed when the tracker announces it, so scoring is causal.
    - Split: even clip numbers are **tune**, odd ones **holdout**.
    - Options: `--jobs` (fork pool; 1000 clips take 11 s at 12 jobs), `--opts`, `--out`, `--baseline` (prints the deltas).

## 4. What was VERIFIED
- `beat-metrics.js` against the real mir_eval 0.8.2 (wheel unpacked in the scratchpad, system numpy/scipy): **400 random cases, 0 mismatches, max diff 0**. The cases cover on-beat jitter, off-beat, double and half tempo, random clicks, dropped beats, and one pair exactly 70 ms apart (that edge case was the one difference before the edge-test fix). Seven of them are pinned in `smoke-wo872-beat-metrics.test.js` (curated, 10/10).
- **Baseline, the WO-662 tracker on all 998 readable GTZAN clips:**

| | F | CMLt | AMLt | Acc1 | Acc2 |
|---|---|---|---|---|---|
| WO-662 | .384 | .273 | .524 | .635 | .858 |

  Per genre: hip-hop F .233 with Acc1 .82, so the tempo is right and the phase is wrong. Metal is the best at F .568; classical is the worst at .333 (Acc1 .35).
- The fosfora constants cited above were checked in the source (`beat.rs:317-319, 646, 657-659, 1716-1718`; `normalizer.rs:9, 22`) and the license files were read. Our side was read at the cited lines.
