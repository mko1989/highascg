# WO-866 — Drum detection vs real music: measure against annotated drums, better detector, sync and sensitivity sliders

**Area:** audio, godot-client
**Status: DONE (30.10) — detector retuned and scored on MDB Drums (kick F 50→64, non-jazz 61→79); sensitivity + test-music routes live on the box; Godot Audio section (per-drum Sensitivity, Sync with prediction) — Godot suite 23686/0, GUI e2e 13_wo866_visuals_audio 3/3**

Owner, 30.10: "the detected snare kick etc doesnt really align with real music. need a slider there or something to align it
better. or better analyzis model."

Follows [WO-861](./861_WO_realtime_audio_parts_buses.md) (the kick / snare / hats buses, tuned on a synthetic kit) and
[WO-863](./863_WO_visuals_tab_canvas_flow_send_to_screen.md) (the Visuals tab that the buses drive).

## 1. Investigation

### 1.1 Capture of what the detector hears

`POST /api/audio/parts-capture {seconds}` (new, `src/api/routes-audio-parts-capture.js`) records the next 1–120 s of the
samples the detectors get (the FFT source; on this box live-audio slot 1's tee), writes a 16-bit WAV and replays it through a
fresh `audio-parts.js` 512 samples at a time. Each hit's time is when the live box decides it. Files go to
`~/.highascg/cache/audio-captures/`, never the repo.

30 s of the owner's live USB music (vocal pop, steady hats, half-time kick about every 0.9 s), 30.10 15:16:
- the detector fired kick 121, snare 105 and hats 161 times, about 4 kicks per second where the music has 1–2;
- the spectrogram with the hits drawn on it showed:
  - hats sitting on every visible hat transient;
  - snare hits on vocal note starts (the 1–5 kHz snare band is the vocal band);
  - kick hits on bass-line notes (40–120 Hz).

So the misalignment the owner sees is mostly **false hits**, not timing.

### 1.2 Ground truth: MDB Drums

To score instead of eyeballing: MDB Drums (Southall et al. 2017, github.com/CarlSouthall/MDBDrums). It holds 23 MedleyDB
full mixes (rock, jazz, disco, punk, …) with every kick (KD), snare (SD) and hi-hat (HH) annotated. Licence CC BY-NC-SA, so it
is used **for evaluation only**: it is never committed and no model is trained on it to ship.

`tools/audio/eval-drum-detector.js <dataset dir>` (new):
- decodes each mix to 48 kHz mono;
- replays it through `audio-parts.js` exactly as the live box does;
- matches hits to annotations one-to-one at ±50 ms (the usual onset tolerance, mir_eval style);
- prints precision / recall / F per drum and the median decision offset.

Baseline (the WO-861 detector as shipped):

| drum | precision | recall | F | false hits | median offset |
|---|---|---|---|---|---|
| kick | 35 % | 88 % | 50 % | 2565 | +31 ms |
| snare | 41 % | 63 % | 49 % | 2400 | +29 ms |
| hats | 56 % | 78 % | 65 % | 1639 | +34 ms |

- **Too eager.** About two out of three kicks are false: one threshold (mean + 1.5·std of the last second, ×1.5) for every
  band and every kind of music.
- **Timing is consistent.** The median offset is +30 ms with an inter-quartile range of a few ms. That is the WIN 2048
  window plus the 2-hop decision delay (`LOOK`, 21 ms). The rest of the chain to the screen adds more: the 30 Hz WS frames,
  the Godot render, the shm ring, the Caspar channel and the LED processor.

### 1.3 Test music from the box

Owner 30.10: "move to music from the server for tests as im disconnecting the laptop and live audio." The FFT engine had
only two sources: the live-audio slot tee (UDP) and its own ALSA capture, and a routed slot always wins. Feeding a second
sender into the tee port would interleave with the slot's silence.

## 2. What was done

- **Measurement**
  - `src/api/routes-audio-parts-capture.js` holds `POST /api/audio/parts-capture` (§1.1).
  - `audio-capture-fft.js` `record(seconds)` taps `pushSamples`.
  - `tools/audio/eval-drum-detector.js` is the MDB scorer (§1.2). It caches decodes with `--cache` and scores one subset
    with `--only`. Tuning knobs go in through `--opts`.
- **Detector** (`src/audio/audio-parts.js`, `TUNE`). Searched on 23 mixes: 234 configurations across 3 grids, 24 in parallel.
  - Per-drum flux thresholds: kick k 3 ×2, snare k 3.5 ×1.5, hats k 1.2 ×3. The old one-size rule was k 1.5 ×1.5.
  - SuperFlux: each bin is compared with the max of ±1 bin one hop back, so vibrato and pitch glides are no onset.
  - **Kick and snare read the percussive part only.** The causal HPSS that `tonal` already ran (WO-861) is widened to
    40 Hz–5 kHz, and the kick and snare flux are taken from `(1 − harmonic mask) · magnitude`. Bass notes and sung notes
    are harmonic (horizontal in the spectrogram) and fall out.
  - Near-peak gate 12 dB (was 24).
  - Snare band choices (0.8–4 / 1–5 / 1.5–8 / 2–10 / 2.5–6 kHz) were within 1 F point of each other, so the band is
    unchanged.
  - The `tune` option overrides any of this, for the scorer.
- **Sensitivity**
  - `GET/POST /api/audio/parts-sensitivity {kick, snare, hats}`, each 0..1, where 0.5 = the tuning.
  - It moves the flux threshold (0 → k×2, 1 → k/2) and the near-peak range (6 / 12 / 24 dB), so 1 also takes ghost notes.
  - Stored in `config.audioCapture.partsSensitivity` (`audio_capture.json`; the settings saves spread `...cur`, so it
    survives them) and applied live through `appCtx.audioPartsSensitivity`.
- **Test music**
  - `POST /api/audio/test-music {file}` takes a media-root relative id (`resolveMediaFileOnDiskExact`: no `..`, regular
    files only). It is decoded by `ffmpeg -re -stream_loop -1` into the same `pushSamples`, while the live PCM is ignored.
  - `{stop: true}` brings the live input back.
  - Not stored: a node restart is back on the live input.
  - Frames and status report `device: file:<name>`.
- The four routes are registered in `router.js` directly (routes-audio.js is at 498 lines).

Not chosen:
- **A trained drum-transcription model** (CRNN, ADTOF-style). The only annotated data at hand is CC BY-NC-SA, and weights
  trained on it would not be shippable in this public, commercially used repo. The box also has no pip or PyTorch.
- **librosa / madmom as an offline reference.** They are not installable here: no pip, no venv, no Debian package. MDB's
  human annotations are a better reference anyway.

- **Godot Visuals page, Audio section** (`features/visuals/visuals_page.gd`, `visuals_tab.gd`):
  - Kick / Snare / Hats sensitivity sliders, loaded from `GET /api/audio/parts-sensitivity` when the tab builds and posted
    (at most every 250 ms while dragging; the last value always goes out). They set the box, not the project: the detectors
    are one per box.
  - **Sync** −300..+300 ms, stored in `project.visuals.sync` (the `visuals` slice is client-owned, so the web autosave keeps
    it), with a ±ms label.
- **Sync model** (`features/visuals/visuals_sync.gd`, pure):
  - hit times come from the frames: `n` counts hits and `onset` decays over 150 ms, so a new hit happened
    (1 − onset) · 150 ms before its frame. That is better than the 33 ms frame grid;
  - **+sync** delays the drum pulses and every other bus (levels come from the frame sync ms ago);
  - **−sync** fires each drum's next pulse sync ms before it is due, from its steady period: the median of the last 8
    intervals, with 3 in 4 (and the last one) within ±15 %. A drum that stops pulses at most 2 more times, and a drum with
    no steady period (a syncopated kick) plays unshifted. Prediction is the only way to land on the beat, because the chain
    to the wall lags the room;
  - the `beat` bus shifts its phase either way (the beat tracker is periodic already);
  - sync 0 returns the buses untouched.

Not chosen: predicting a syncopated pattern one bar back (from the beat tracker's bpm). That is more state and more ways to
fire a wrong hit, and kick-on-every-beat and 8th/16th hats, the material the owner's sync complaint is about, are steady.

## 3. What was VERIFIED

MDB Drums, ±50 ms, F (precision / recall). The "non-jazz" set is 16 rock / pop / disco / funk / punk / reggae mixes; the
jazz brushes and ghost notes are 1668 of the 2654 annotated snares:

| | kick | snare | hats |
|---|---|---|---|
| before, all 23 | 50 (35/88) | 49 (41/63) | 65 (56/78) |
| **after, all 23** | **64 (54/78)** | 46 (57/39) | **68 (58/81)** |
| before, non-jazz | 61 (46/92) | 50 (36/81) | 72 (70/74) |
| **after, non-jazz** | **79 (75/83)** | **57 (57/57)** | **77 (76/78)** |

- False kicks drop from 2565 to 1014 (all 23 mixes). Jazz snare recall falls (brushes are quiet and
  noise-like), which is the trade for the owner's DJ / band material.
- Decision offset: +33 to +35 ms median, unchanged.
- CPU: 50 ms per second of audio, up from 34 ms (the wider HPSS); 5 % of one core.
- Box, test music (Run The Jewels "Legend Has It" from `media/projects/mhp_harder/`, laptop unplugged):
  - `test-music` answered `ok` and the WS frames carry the music (kick n rising, beat 124 bpm);
  - a `..` path is refused with 404;
  - a 20 s `parts-capture` gives kick 25, snare 20, hats 56, about 1.25 kicks per second (the laptop's music before the
    retune: about 4 per second);
  - the spectrogram with the hits drawn on it shows the snares on the backbeat stabs and the hats on the stab rhythm;
  - `parts-sensitivity` GET returns 0.5 / 0.5 / 0.5.
- `tools/smoke/smoke-wo866-drum-tuning.test.js`, 8 tests (curated CI):
  - the scorer's matching;
  - the shipped tuning, and that overrides merge;
  - each kick counted once;
  - sensitivity 0 / 0.5 / 1 → 6 / 15 / 20 kicks on a kit with ghost notes 18 dB down;
  - the WAV header and replay timing;
  - the route clamp, store and live apply;
  - test-music refusals;
  - route registration.
  - WO-861's 15 synthetic-kit tests still pass on the new tuning.
- Dropped: a "vocal glide is no snare" unit test. Synthetic sung syllables trip both the old and the new detector (a
  syllable *is* an onset), so it proved nothing. The real-music evidence is the MDB table.

- Godot (`tests/test_visuals_sync.gd`, 8 tests), suite 23686 passed / 0 failed:
  - hit times back-dated from 30 Hz frames to within 0.01 ms, and an engine reset clears them;
  - period: steady, jittered, syncopated, too fast;
  - delay: the hit fires at +200 ms; levels come from the right frame;
  - prediction: the 2500 ms hit fires at 2400 ms with sync −100, not before; a stopped drum stops; an unsteady drum is
    unshifted;
  - beat phase both ways; the slice clamp; the page emits nothing on load and sends all three drums on a drag.
- GUI e2e `13_wo866_visuals_audio` (sandbox server, private Xvfb, real mouse drags), 3/3:
  - the Kick slider shows the box's 0.5; a drag to 0.9 reaches `GET /api/audio/parts-sensitivity`, with snare untouched;
  - a Sync drag to −195 ms shows "-195 ms" and lands in the stored project's `visuals.sync`;
  - screenshot `scratchpad/wo866/e2e2/shots/02_…png`: the Audio section under the base parameters.

## 4. Left for the owner's ear

- Pick a Sync value against the real wall. Neither the e2e nor the box can measure the lag of the LED processor and the
  room.
