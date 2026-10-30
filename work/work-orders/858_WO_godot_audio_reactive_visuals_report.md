# WO-858 — Godot as the live-visuals engine: audio analysis → visuals (FlowKit, audio parts), relayed to CasparCG

**Area:** engine, audio, godot-client
**Status: DONE (30.10) — report delivered and acted on: the owner chose the in-house analysis (WO-861 audio parts buses) and the in-client Visuals tab (WO-863 canvas, Flow, Send to screen; WO-866 drum alignment, sensitivity, Sync) instead of the detached VJ process of §9; §9 P0/P1 stand as reference for a later VJ process**

Owner, 30.10: "has the report about using godot for creating audio reactive visuals been made?"

Owner, 30.10 (follow-up): "i want to move away from shader (unless they can be esily displayed from the godot engine) and dive
into using godot as an engine for the live visuals with audio reactivity. ive added a project that does an analysis of audio and
catogorizes it so different "parts" of audio can drive different parts of visuals. there was also a project linked that enabled
visual flow programming for godot."

It had not been made. The nearest text was [WO-738](./738_WO_godot_vj_engine_relayed_to_caspar.md) §2 (one table row) and §6 (FlowKit,
"Not installed"). Transport is settled by WO-738 §7: shared memory, [WO-742](./742_WO_caspar_shm_producer.md) producer,
[WO-743](./743_WO_godot_shm_writer.md) Godot writer, [WO-744](./744_WO_shm_ring_live_source.md) Live-tab source. This report is the plan for
what rides on it: **Godot becomes the live-visuals engine and the HTML/Shadertoy path is retired**.

Labels: **[repo]** read in this tree (file:line), **[doc]** Godot docs (URL), **[measured]** a number a WO recorded, **[gh]** read from
GitHub on 30.10, **[estimate]** my order of magnitude, nothing measured on this box. P0 (§9) replaces each estimate with a measurement.

## 0. Answers in short

| Question | Answer |
|---|---|
| Can the existing shaders be shown from Godot easily? | **Mostly yes, not "for free".** Two routes (§5): a text translator to a `canvas_item` shader, or a real-GLSL compute wrapper. Neither is proven. P0 gates it on a pass rate over 20 shaders. Lost or re-done: the 6 multi-pass ones (hand-built viewport chains), the beat knobs (re-implemented), the thumbnailer |
| Where does audio come from? | The server's existing `audio_fft` WS frame (FFT, waveform, RMS, bands, beat). One audio truth. Not Godot's microphone path (§1) |
| Audio "parts" project | **Owner sent 5 links (30.10), evaluated in §3.2: none is a Godot audio classifier.** Two are not analysers at all (BarelyMusician = synth, Resonate = playback), one is a Reddit post on Godot 4.3 adaptive *playback* (post itself unread), one is a thin offline librosa script (volume + beat flags), one (music-reactive-lighting) is a Python live+file MIR engine with mood/energy/harmonic-percussive split, in-process only. Use its ideas for `energy`/`mood` buses, not its code as a dependency; kick/snare/vocals "parts" still need our own onsets (§3.3) or stems. Integration stays generic named feature buses |
| Visual flow programming | FlowKit: MIT, Godot 4.5+, editor-authored `.tres` event sheets, young. Usable for audio→visual rules with a custom provider pack (§4). It is the rules layer, not the render engine |
| Recommendation | Build it, detached, as a separate Godot "VJ" process. Start with a 3-day P0 with a pass/fail test (§9) |

## 1. Audio input into Godot

### 1.1 What the server already produces **[repo]**

| Item | Detail | Where |
|---|---|---|
| Source | The live-audio slot routed as FFT source (`audio_fft_source_slot`, DM3 = slot 1). The slot's bridge ffmpeg tees raw s16le/48 kHz/stereo PCM to `udp://127.0.0.1:5222<slot>` | `src/audio/live-audio-bridge.js:13`, `:183-191` |
| Listener | Node binds that UDP port on 127.0.0.1; only one process can own it | `src/audio/audio-capture-fft.js:254` |
| Analysis | 1024-sample ring, 512 freq bytes (smoothing 0.6, -100..-30 dB), 512 waveform bytes, RMS, 30 Hz | `audio-capture-fft.js:64-66` |
| Beat | Spectral-flux onsets, autocorrelation tempo 70-180 BPM, phase-locked grid: `{n, age, bpm, conf, phase, level}` | `src/audio/beat-detect.js:224-232`, WO-662 |
| Bands | bass (<=250 Hz), mid (<=4 kHz), high | `beat-detect.js:257-263` |
| Delivery | `_wsBroadcast('audio_fft', {freq, wave (base64), rms, device, beat, bands})` to **every** WS client, no subscription | `src/bootstrap/audio-capture-lifecycle.js:75-84` |
| Stale | No PCM for 2 s: one zeroed frame, detector reset | `audio-capture-fft.js:140-158` |
| CEF consumer | `template/shaders/player.js`: fresh WS frames beat getUserMedia (WO-335) | `player.js:238` |
| Godot | `Ws.on(type, handler)` exists (`godot/client/core/ws.gd:41`). Nothing in `godot/client` listens for `audio_fft` yet | |

Box state 30.10: `arecord -l` shows card 0 (ALC1220) and card 2 (Sennheiser SC60); **no DM3 enumerated right now**. No PipeWire or
PulseAudio daemon runs (`pgrep` empty, `pactl` missing). WO-662 (21.10) noted no FFT source was routed. Setup facts, not code gaps.

### 1.2 Options

| Option | How in Godot | Latency | Conflict / risk | Verdict |
|---|---|---|---|---|
| **A. Server WS `audio_fft`** | `Ws.on("audio_fft", ...)` in the VJ process's own WS client; base64 -> `PackedByteArray`; upload to a 512x2 `ImageTexture` (`Image.FORMAT_R8`) | ~35-90 ms to Godot **[estimate]** | None; opens no device; same numbers as the CEF shaders, so ported shaders react identically | **Chosen** |
| B. Own UDP listener on the tee | `PacketPeerUDP.bind(52221)` | lowest (~25 ms) | Node owns the port (`:254`); needs a second ffmpeg tee output on the on-air bridge | Only if A is too slow; add a tee, never share a port |
| C. Godot microphone path | Bus + `AudioStreamMicrophone` + `AudioEffectSpectrumAnalyzer` / `AudioEffectCapture` | ~40-60 ms **[estimate]** | Opens ALSA itself; the DM3 is single-open and held by the bridge (WO-335 constraints; warning at `audio-capture-lifecycle.js:19-33`); the default input is the silent ALC1220; needs `audio/driver/enable_input` [doc: [AudioStreamMicrophone](https://docs.godotengine.org/en/stable/classes/class_audiostreammicrophone.html)] | No (test bench with a USB mic only) |
| D. OSC dBFS meters | `osc` WS snapshot (`godot/client/features/live/osc_mirror.gd:13`) | ~25 Hz | level only | Fallback when A is stale |

API names if C is ever needed: `AudioServer.add_bus_effect()`, `AudioEffectSpectrumAnalyzer`, then
`get_magnitude_for_frequency_range(from_hz, to_hz, mode)` on its instance, returning linear energy per channel
([doc](https://docs.godotengine.org/en/stable/classes/class_audioeffectspectrumanalyzerinstance.html)); `AudioEffectCapture.get_buffer(frames)`
returns `PackedVector2Array`, empty when too few frames are ready ([doc](https://docs.godotengine.org/en/stable/classes/class_audioeffectcapture.html)).
The class pages say nothing about latency or ALSA device choice, so C needs its own spike. **Unverified.**

### 1.3 Latency chain, sound at the tee to pixel on the output (all **[estimate]**)

| Hop | Cost |
|---|---|
| PCM to node ring (1024 samples = 21 ms) | ~10 ms |
| Wait for next 30 Hz emit | 0-33 ms |
| WS loopback + base64 decode | 1-3 ms |
| Godot `_process`, then render at 50 fps | 0-20 ms + 20 ms |
| Async readback, up to 2 in flight (`viewport_publisher.gd:12,62`; WO-743: result "lands a frame later") | 20-40 ms |
| Caspar producer polls once per channel tick (WO-742) | 0-20 ms |
| Caspar mixer and consumers | 1-3 frames, **unknown** |
| **Total** | **~100-180 ms** |

The CEF path has the same first three hops plus rAF, CEF paint and the HTML producer buffer, so Godot via shm is not slower than what is
on air. The sound the audience hears is Caspar's program audio with its own bridge latency (unmeasured), so the picture may land before or
after it. Controls: (1) beat prediction from `bpm`/`phase`, as `template/shaders/player-beat.js` already does (header lines 9-15), plus one
calibrated `lead_ms`; (2) P0 measures the offset with a click track and stores `lead_ms`.

### 1.4 Gaps in the audio source (not Godot's fault)

- **Only live-input slots can be the FFT source.** Media clips, DeckLink embedded audio and Caspar's PGM mix have no PCM tap, so a set over
  played-back tracks falls back to option D. Candidate fix, **untested**: an audio-only channel (WO-237) fed by `route://` with an FFMPEG
  consumer writing s16le to a UDP port the FFT engine already reads (`source: 'slot'`). Only one PortAudio consumer is allowed (WO-683). Effort M.
- **Resolution.** 46.9 Hz per bin: 5 bins below 250 Hz. Fine for kick/bass energy, coarse for pitch. If finer bass is needed, add a second
  4096-point stream on the server, not in Godot.

## 2. What Godot adds over the Shadertoy/HTML path

The HTML path is one fragment shader per CEF page, with no particles, 3D, compute or feedback beyond buffers A-D (WO-738 §1); with GPU off CEF
renders on the CPU (`src/config/config-generator.js:97,120`). Godot 4.7.2 (`~/.local/opt/godot/godot --version`) drives the RTX PRO 4000
Blackwell (24 GB) directly. GPU ms are **[estimate]**; the budget at 50 fps is 20 ms for everything, shared with Caspar's mixer.

| Capability | Godot API | Audio hook | 1080p | 4K |
|---|---|---|---|---|
| Fragment-shader scenes | `canvas_item` shader on a `ColorRect` in a `SubViewport`; `FRAGCOORD`, user `sampler2D` ([ref](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/canvas_item_shader.html)) | audio texture, band uniforms | 0.2-1 ms; raymarchers 2-6 | 1-4; raymarchers 8-25 (over budget) |
| GPU particles | `GPUParticles3D` (`amount`, `process_material`, `trail_enabled`, `sub_emitter`; [doc](https://docs.godotengine.org/en/stable/classes/class_gpuparticles3d.html)), `shader_type particle`, attractors | band -> emission/speed, onset -> `restart()` / `emit_particle()` (Forward+ only) | 0.3-2 for 0.1-1 M | 0.5-3 |
| Many instances | `MultiMeshInstance3D`, per-instance data from a texture | 512 bins -> 512 bars | 0.3-1 | 0.5-2 |
| Compute | `RenderingDevice.compute_list_*`, GLSL `#[compute]` | fluid, boids, reaction-diffusion | 0.5-2 at 1024^2 | 1-4 at 2048^2 |
| 3D | `Camera3D` on `Path3D`, glTF, `Environment` fog/glow | dolly speed, light energy | 2-6 | 6-20 (render 1080p, Caspar scales) |
| Post | `Environment.glow_*`, `CompositorEffect` (Forward+) | bloom on beat | 0.3-1 | 1-3 |
| Feedback | two `SubViewport`s ping-ponged, `use_hdr_2d` | zoom/rotate per beat | 0.3-1 per pass | 1-3 |
| Typography | `Label3D`, `TextMesh`, `RichTextEffect` | per-glyph jitter from bands | <0.5 | <1 |
| Stage content | previs model in `godot/client/features/previs`, Art-Net tap WO-693 | fixtures from bands | scene-dependent | |

Readback **[measured]**, WO-594, 1080p50: ~7 % of one core copy + ~3 % readback; 4K is 4x the pixels (33 MB/frame, 1.7 GB/s), ~40 % of a core
**[estimate]**. A ring need not match the channel size: render 1080p, let Caspar scale with `MIXER FILL`. The ring carries video only (WO-738 §9);
Godot plays only Theora, so clips stay in Caspar and re-enter as `pgmN`/`chN`/`inN` surfaces when a scene wants to process them.

## 3. Audio analysis and "parts"

### 3.1 What exists

| Feature | Server today | Add |
|---|---|---|
| Bands (3), 512-bin FFT + waveform, RMS | yes (§1.1) | server: 6 bands (sub, bass, low-mid, mid, high-mid, air) |
| Onset | internal only (`beat-detect.js` header) | export `onset` events with strength, plus `flux` |
| Beat / BPM / phase | yes; tempo within 1.5 % on kicks at 96-174 BPM, ~50 % on drumless tracks (WO-662) | none |
| Centroid, rolloff | no | compute in Godot from the 512 bytes |
| Attack/release envelopes, running-max normaliser | no | **Godot side**, per binding (per-scene taste, free) |
| Downbeat / bar | no | P2: `n` modulo 4 with a "bar one" tap |
| Kick / snare / hats / vocals / pads, sections | no | the owner's project, or §3.3 |

### 3.2 The owner's links (30.10)

First pass (before the links): `~/Downloads` (listing and zips), `~/bridge`, `~/Documents`, `~/show`, `~/highascg/godot` (client, extensions,
retro, spikes, `addons/`: only `hshm`), `~/highascg/work` and any `.gd`/`plugin.cfg`/`.gdextension`/`.zip` newer than 27.10 held no audio analyser
(`~/Downloads/kategoria` and `visuale` are media). The owner then answered the open question with five links. Read on 30.10; nothing was
installed or run. Labels as above; **[gh]** = GitHub API / raw files, **[doc]** = asset-library page or Godot docs.

**Bottom line: none of the five is a ready "categorise audio into parts" classifier for Godot.** Only #5 analyses audio live and also extracts
mood/energy; it is Python, in-process, and Windows-only for live capture as shipped.

| Question | 1. BarelyMusician (asset 4958) | 2. Reddit "Adaptive music made simple..." | 3. Resonate (asset 4673) | 4. kessoning/Audio-Offline-Analysis | 5. CanYuzbey/music-reactive-lighting |
|---|---|---|---|---|---|
| What it is | Real-time music **generation** engine (oscillator instruments + beat-scheduled performers). Asset page: "generating and playing musical sounds from scratch"; "experimental, may contain bugs" [doc, gh] | **Post not read:** reddit.com refused WebFetch and a web search did not surface it. Title/URL slug only: Godot 4.3's new adaptive-music feature. The class it must mean is `AudioStreamInteractive` ("Audio stream that can playback music interactively, combining clips and a transition table") [doc: [class page](https://docs.godotengine.org/en/stable/classes/class_audiostreaminteractive.html)] | Sound/music **management** addon: pooled `AudioStreamPlayer`s, 2D/3D detection, polyphony, "stemmed music tracks", crossfading; `SoundManager` + `MusicManager` [doc, gh] | Python scripts "for beat detection and sound-reactive animation... offline"; README says explicitly: no real-time analysis. Built to feed Processing / openFrameworks / Stable Diffusion Deforum keyframes [gh] | Python "music-reactive lighting system": MIR pipeline (librosa HPSS, onset, BPM, key, mood) mapped to RGB + brightness for a desktop player UI (pygame / customtkinter) [gh] |
| Author, repo | anokta, [github.com/anokta/barelymusician](https://github.com/anokta/barelymusician), 52★, created 2018, pushed 30.10.2026 [gh] | r/godot user (unread) | WidgitLabs, [gitlab.com/widgitgaming/godot/resonate](https://gitlab.com/widgitgaming/godot/resonate), 6★, created 12.01.2026, last activity 28.03.2026. Its README links asset **2546** as its Asset Library entry; the owner's link is **4673** [gh, doc] | kessoning, 7★, created 13.05.2023, last push 30.09.2023 [gh] | CanYuzbey, 1★, created 20.01.2026, last push 14.03.2026 [gh] |
| Licence | MIT [doc, gh] | n/a | MIT [doc, gh] | MIT [gh] | MIT [gh] |
| Godot version | 4.6 (asset page) [doc] | 4.3+ (class added in the 4.3 cycle; the doc page does not state it, PR #64488 per a web search) | 4.4 on the asset page; README: builds for 4.3+ [doc, gh] | none, not a Godot project (a Processing example only) [gh] | none, not a Godot project [gh] |
| Language | C++ core, **GDExtension** for Godot; repo also holds C#, JS, 7.6 KB GDScript [gh] | engine feature (resource, no addon) | addon; language not checked (source not read) | Python (librosa 0.8.1, moviepy, numpy 1.21 pinned) + a Processing sketch [gh] | Python 3.12+; numpy 2.4.1, librosa 0.11.0, scikit-learn 1.8.0, pygame, customtkinter, `pyaudiowpatch` (Windows WASAPI loopback) [gh] |
| Live or offline | **Neither: it analyses nothing.** It makes sound | **Neither: playback.** The docs page has no level, spectrum or beat analysis; beats/bars appear only as transition points [doc] | **Neither: playback.** Stems are tracks to play and fade, not analysed | **Offline only** (whole file to text) [gh] | **Both.** `app.ui.live_player`: WASAPI loopback, ~`1/fps` chunks (`chunk_size = sample_rate/fps`) over a 3 s ring, HPSS on a 4096-sample window each chunk. `app.ui.modern_player`: whole file analysed ahead of time, then played back at 60 fps. Live capture is Windows-only as written [gh] |
| Features ("parts") | none. (Has an instrument/performer clock a generative scene could use) | none | none (stems = pre-split tracks you supply; it does not separate them) | Per-frame **mean-abs volume** (`audio_to_params.py`: mono, abs, mean per video frame, normalised to the file max, user `--formula` run through `eval`) and **beat flags** (`beat_detection.py`: `librosa.beat.beat_track` onsets). No bands, sections, stems, mood [gh] | Loudness (adaptive-normalised RMS), **harmonic/percussive split** (HPSS; not vocals/drums stems), onset (a simple derivative+RMS proxy, fixed floor/ceiling 0.032/0.045, **not** spectral flux), BPM 60-180 via a resonator bank + inter-onset density check, 3 energy bands, `arousal` and `valence` (heuristic from band "exertion" = energy / rolling mean), key (README: Krumhansl-Schmuckler; the key code was not read, `song_key` defaults to "C Maj"), pulse, a "drop boost" dynamics state (`dynamics.py` not read), a 20-track "memory bank" tuning the mood baselines [gh] |
| Output format | n/a | n/a | n/a | One text file: `0:(0.31),1:(0.28),...` per frame (Deforum keyframe syntax). `beat_detection.py` writes one `i:(1\|0)` line per entry of `range(len(y))`, i.e. **per audio sample at librosa's load rate, not per video frame** (read from source; not run) [gh] | In-process Python `FrameAnalysis(time_sec, rgb, brightness, bpm, bpm_confidence, arousal, valence, raw_rms, onset, key, debug_data)`. The only "output" module read (`lighting/output.py`) prints RGB to the console. **No OSC/WS/UDP/DMX sender seen** in the file list [gh] |
| Maturity | active, "experimental" | n/a | small; asset v2.4.1 [doc] | stale since 09.2023, pinned 2021 libs, no tests seen | 1★, 5 months, one test file (`tests/test_color.py`); hand-tuned constants; Windows-first |
| Fit with WO-858 | **None for analysis.** At most a clock/synth if the VJ ever generates sound; Caspar owns audio, so no | **Not relevant to analysis.** Relevant only if Godot *played* music; WO-738 keeps clips in Caspar | **Not relevant to analysis.** Stem playback is useful only for the stems idea in the recommendation below | Weak. See recommendation | Best of the five as a reference for `energy` / `mood` / harmonic-percussive buses |

How each would meet the design (§1.1 server `audio_fft` frame = the one audio truth, §3.3 named buses, §4 FlowKit):

- **#5 live** would need its `pyaudiowpatch` capture replaced by our s16le/48 kHz PCM (the bridge tee, §1.1) and a sender added; as a *second* consumer of the PCM it hits the "Node owns the UDP port" constraint (§1.2 option B: needs its own tee output). Its HPSS-per-chunk cost on this box is **unmeasured**. Its mapping to buses: `onset` -> `onset`, `arousal` -> `energy`, `valence` -> a new `mood` bus, `bpm`/`bpm_confidence` -> cross-check only (the server beat detector, WO-662, stays the beat truth), harmonic/percussive energy -> `tonal` / `perc` buses. It does **not** produce `kick`, `snare`, `hats` or `vocals`.
- **#5 file mode / #4** fit the "played-back clip" case (§1.4: media clips have no PCM tap, so there is no live FFT for them). A pre-analysis job would write a **JSON timeline keyed by clip time** (`t`, `bus` values, `beats`), and the VJ process would replay it against the clip's playhead. That adds a new input: the clip position from Caspar, plus sync error; not designed here.
- **FlowKit rules** consume buses, not these projects: any of them only matters through the bus names and event pulses (`On Onset`, `On Section Change`) in §4.

**Recommendation.**

1. **Do not adopt any of the five as a dependency.** None is a Godot addon with a usable classifier, and #5 (the only live one) is Python, Windows-first, 1★ and has no network output.
2. **Live shows (DM3): build ourselves**, as §3.3/§9 already say: server exports `onset`, `flux`, 6 bands; Godot shapes them into buses. Borrow from #5 (MIT, keep the notice in the repo-root `THIRD_PARTY_NOTICES`) three **ideas** to implement in JS on the server or in `AudioFeatures`: arousal = `0.5*loudness + 0.4*density + 0.1*onset`; "exertion" = band energy / rolling mean for relative mood; a refractory/strobe debounce (its 120 ms) on flash bindings. Constants there are tuned by its author's music; ours need P0 measurement.
3. **Played clips: offline pre-analysis is valid** and cheap: a node-spawned Python job (librosa, which #4 and #5 both use; whether it is installed on the box is **not checked**) writing a JSON timeline per media file. Use `librosa.beat.beat_track` / HPSS directly rather than #4's scripts (thin wrapper, sample-rate output quirk, stale pins). #5's `TrackAnalyzer.analyze_file` is the template for a richer one (it already returns a per-frame list). For true parts (`vocals`, drums) the options stay the §3.3 stem separators; a cheaper variant, **untested**: owner-supplied pre-split stems played muted in Godot through per-stem `AudioEffectSpectrumAnalyzer` buses (here Resonate's stem layers or plain `AudioStreamSynchronized` would do the playing), at the price of keeping a second player in sync with Caspar.
4. **#1, #2, #3: out of scope for WO-858.** #2 and #3 are about *playing* music (adaptive/stem playback), which is not analysis and not what the box does (Caspar plays; Godot is silent video, §2). Revisit #2 only if the owner wants Godot to *score* a show; #1 only if Godot ever generates sound.
5. Open point for the owner (updates §8 Q1): which "parts" matter most, drums as separate hits (needs our onsets or stems), or mood/energy sections (#5-style)? That decides whether P1's "owner's project" item (2-4 d) is the JS port above or a clip pre-analysis job.

### 3.3 Generic design: feature buses

An autoload `AudioFeatures` in the VJ project owns named **buses**. Each bus has `level` 0..1 (smoothed), `onset` (pulse 1->0), `env`
(attack/release), `energy_avg` and a `source` tag:

| Bus | Meaning | Built-in source (no extra project) | Better source |
|---|---|---|---|
| `kick` | low transient | bass-band onset | classifier |
| `snare` | mid transient | mid-band onset (weak: guesses) | classifier |
| `hats` | high transient | high-band onset | classifier |
| `bass`, `mid`, `high`, `level` | sustained energy | server bands/RMS | stem energy |
| `vocals`, `pads`, `lead` | tonal parts | **none** (needs the owner's analyser) | stem/classifier |
| `beat` | pulse, phase, BPM | server beat | same |
| `energy`, `section` | slow loudness trend, build/drop | rolling RMS vs. 30 s mean | analyser |

Wire format, so any analyser can feed it: `{"t":"audio_parts","bus":{"kick":{"level":0.7,"onset":1}, ...},"bpm":124,"section":"drop"}`.
Source adapters: (1) built-in, from `audio_fft`; (2) **external process** that reads the same PCM and posts to the server, which re-broadcasts in
the same `audio_fft` envelope (additive fields; `player.js` ignores unknown ones); (3) a Godot addon that writes into the buses directly.
Rule: heavy analysis lives in a process or the node (one set of numbers), shaping lives in Godot.

Other candidates, not in the owner's list (§3.2 evaluates those) **[gh, 30.10]**:

| Project | What it gives | Licence / maturity | Fit |
|---|---|---|---|
| [MTG/essentia](https://github.com/MTG/essentia) | onsets, beats, tempo, key, descriptors, pretrained TF models (instrument, mood); C++/Python, streaming mode | AGPL-3.0, 3.8k★, pushed 22.10.2026 | Strongest "categorize" toolkit; run as a **separate process** because of AGPL |
| [aubio/aubio](https://github.com/aubio/aubio) | real-time onset, tempo, pitch, MFCC; small C library | GPL-3.0, 3.8k★, last push 04.2026 | Light real-time onset source; separate process or GDExtension (GPL binds the extension) |
| [deezer/spleeter](https://github.com/deezer/spleeter) (also [open-unmix](https://github.com/sigsep/open-unmix-pytorch); Demucs is archived) | stem separation: vocals / drums / bass / other | MIT, 28k★, pushed 28.10.2026 | The only route to `vocals`; **not real-time friendly** (window latency, GPU), so best for pre-analysis per track |
| [CPJKU/beat_this](https://github.com/CPJKU/beat_this) | beats and downbeats (neural) | MIT, 455★ | Bars/downbeat; offline |

Godot side search found only toy visualisers (GitHub search, 30.10: three repos under 3★), so no ready Godot audio-classification addon. A real-time
classifier would be a sidecar, not a Godot plugin.

## 4. Visual flow programming: FlowKit

[LexianDEV/FlowKit](https://github.com/LexianDEV/FlowKit) (WO-738 §6 had the first look) **[gh, 30.10]**:

| Fact | Detail |
|---|---|
| What | Event-sheet visual scripting (Clickteam Fusion / Construct style): rows of events -> conditions -> actions, pure GDScript addon |
| Licence | MIT |
| Asset Library (owner link, 30.10) **[doc]** | [asset 4506](https://godotengine.org/asset-library/asset/4506) is **the same project**: "FlowKit: Godot Visual Scripting", author LexianDEV, repo link github.com/LexianDEV/FlowKit, MIT, Godot 4.5, asset version **v1.0**, category Tools, support Community. Only date shown: 2025-11-25 (submission line; no "modified" date listed). Page says node support is still limited, it has an automatic generator for events/conditions/actions, and the author writes it is "probably best not to use this addon for production yet". |
| Library vs GitHub | The asset-library copy (v1.0, Nov 2025) is **stale against GitHub** (`plugin.cfg` "2.0", push 23.10.2026, re-checked 30.10: 205★, 10 open issues, 0 releases, 0 tags). **Vendor from a pinned GitHub commit, not from the Asset Library.** The "generator for events, conditions and actions" is worth a look when writing the §4 provider pack (not read beyond the page text) |
| Godot | README: Godot 4.5+, badge says 4.5; `plugin.cfg` version "2.0". **4.7.2 is untested** |
| Maturity | Created 21.11.2025, 205★, 10 open issues, pushed 23.10.2026 (a refactor week: sheets migrating to a `flowkit_local` folder). **No tags or releases.** README says generative AI helped; it has a GUT test config |
| Storage | Sheets are `.tres` resources, edited in a Godot **editor** bottom panel |
| Extension | Providers are small GDScript classes: `FKEventProvider.poll(event_id, node)` (polled each frame, true = fires), conditions, `FKAction.execute(node, inputs)` (e.g. `set_property` is 25 lines). Variable types: bool, number, string, color, vector, node, audio stream |
| Built-in | Dozens of game-oriented providers (movement, input, scene, audio-bus volume, `set_max_fps`, `set_vsync`, timers). Nothing audio-analytic |

**How it would wire audio features -> visual parameters.** Write a HighAsCG provider pack (about 5 files, <200 lines):

- Events: `On Onset (bus)`, `On Beat`, `On Beat Count (n mod 4)`, `On Section Change`, `On Signal Lost`.
- Conditions: `Bus level > x`, `BPM in range`, `Section is`.
- Actions: `Set Shader Param (with envelope)`, `Pulse Param`, `Burst Particles`, `Switch Camera`, `Set Palette`.

Example rules an operator can read: "On kick -> pulse `bloom` 0.8 over 120 ms", "When section = drop -> particles burst, camera cut",
"Every 4 bars -> next palette". A sheet belongs to a scene, so the scene carries its own audio logic.

**Where it fits and where not.** It is a good rules layer for discrete reactions. It is a poor fit for continuous mapping (a bus -> a
uniform every frame with smoothing); a data-driven binding table (§6.2) is simpler and cheaper. Costs and risks: the polling engine runs
per frame; the editor is for developers, since operators run an exported client and never the editor (WO-738 §6), so operator editing needs
our own sheet editor or stays developer work; it is young and mid-refactor, so **pin a commit** and vendor it under `godot/vj/addons/`.
Verdict: use the binding table for the 90 % case from day one; add FlowKit in P1 for event rules, behind a spike on 4.7.2 (load the addon,
run a demo sheet, confirm the runtime works in an exported or `--headless`-free project).

## 5. Existing shaders in Godot (the owner's condition for keeping them)

### 5.1 What they are **[repo]**

`data/shaders/` holds 190 configs: **118** `sh-sa-*` (ShaderAmp import, WO-586) and 72 others (Shadertoy-style paste). Counted in the
`sh-sa-*` set: **6 multi-pass; all 118 use the writable global `sa_FragColor`** (the WO-586 wrapper keeps ShaderAmp's `main()` as `sa_main()`);
61 use `texelFetch`; 39 mention `iMouse`; 11 use `dFdx/dFdy/fwidth`; 4 `iFrame`; 2 `iDate`; 6 `gl_FragCoord`. In the other 72: 14 `iMouse`,
3 `precision`, 1 `dFdx`. Audio is a 512x2 R8 texture (row 0 FFT, row 1 waveform) bound to a pass channel (`player.js:76,123`). Beat uniforms
`iBeat`, `iAudioBands`, `iBeatFx` and the flash/bump/kick wrapper are ShaderToyLite patches (`ShaderToyLite.js:38-47`).

### 5.2 Route R1: translate to a `canvas_item` shader

Mapping, from Godot's own migration page ([doc](https://docs.godotengine.org/en/stable/tutorials/shaders/converting_glsl_to_godot_shaders.html)):

| Shadertoy | Godot |
|---|---|
| `mainImage` body | `fragment()`; `fragColor` -> `COLOR` |
| `fragCoord` (y up) | `vec2(FRAGCOORD.x, iResolution.y - FRAGCOORD.y)` (origin is top-left) |
| `iTime` | own `uniform float iTime` (`TIME` wraps at 3600 s and cannot take our beat "kick") |
| `iResolution`, `iFrame`, `iMouse`, `iDate` | uniforms |
| audio `iChannelN` | `uniform sampler2D iAudio : filter_linear, repeat_disable;` fed by `ImageTexture.update()` |
| `iBeat`, `iAudioBands`, `iBeatFx` | uniforms, set from the feature buses |
| buffers A-D / feedback | one `SubViewport` per buffer; a self-feedback buffer needs a **pair**, swapped each frame |
| `#define F(x)`, `#if`, `out`/`inout`, `texelFetch` | supported ([preprocessor](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shader_preprocessor.html)) |
| **writable globals** (`sa_FragColor`, `vUv`) | **the docs list only `const`, `uniform` and varying globals** ([language](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shading_language.html)); assume unsupported until P0 shows otherwise |
| implicit int/float casts, mixed swizzles, use-before-define | errors in Godot; common in Shadertoy code |

An automated translator rewrites the wrapper (globals -> `inout`/locals), inserts casts it can detect, and flags the rest. It works for
single-pass shaders only after text surgery, so the **118 ShaderAmp wrapper must be re-generated from the original sources**, not translated from
the current JSON. **[estimate]** 60-70 % pass untouched; the rest need a manual fix. Compile each in a harness and read the Godot log, like
`tools/shaders/validate-shader-configs.js` does for Chrome.

### 5.3 Route R2: real GLSL in a compute wrapper

`RenderingDevice` takes Vulkan GLSL (`#[compute]`, `RDShaderFile`) and reports compile errors. A fixed wrapper declares `iTime` etc. as a uniform
block, sets `fragCoord` from `gl_GlobalInvocationID`, includes the shader text **verbatim** and writes `mainImage`'s result to an image shown
through `Texture2DRD`. Writable globals, casts and forward use are all legal GLSL, so most of §5.2's blockers vanish, and multi-pass is just
more dispatches. Costs: `precision` lines and ES-only syntax need stripping; **derivatives do not exist in compute** (11 of 118 use them); it is
more code than R1; the audio and buffer plumbing is hand-written. **Unproven.**

### 5.4 Verdict and what is lost

- **Keep them as one source type inside Godot**: `ShadertoySource` = a scene that loads `data/shaders/<id>.json` (the library stays the source of
  truth, `/api/shaders` unchanged) and builds R1, falling back to R2 where R1 fails. P0 decides on the pass rate.
- **Shader Live parameters survive**: the web scanner finds GLSL literals (`shader-param-scan.js`, WO-606). The translator can turn them into
  real `uniform`s once, so a slider is `set_shader_parameter()` with no recompile and no `CG UPDATE`.
- **Lost or re-done**: the 6 multi-pass shaders (hand-built chains); the flash/bump/kick wrapper (re-implemented in the translator wrapper);
  the thumbnailer (headless Chrome, WO-344), which Godot replaces with a one-frame render; the shaders needing webcam/images (already skipped in
  WO-586); anything using `iMouse` loses its input unless mapped to an LFO.
- **Retirement order**: Godot parity first, then freeze the HTML path (the 190 `template/shaders/sh-*.html`, Shader FX modal, Shader Live
  endpoints). Saved looks that reference those templates keep working until migrated, so do not delete them in P0-P1.

## 6. Authoring workflow for the operator

### 6.1 Scene library
A "visual" is a `PackedScene` under `godot/vj/scenes/<id>/` with a `scene.json` manifest: `id`, `name`, `category`, `cost` (light / medium /
heavy, from P0's harness), `size`, parameters (`name`, `type`, `min`, `max`, `default`, `group`, default audio binding) and optional FlowKit sheet.
Sources: native scenes, `ShadertoySource` (one per library shader), later `.pck` packs (`ProjectSettings.load_resource_pack()`).
Parameters are shader `uniform`s or `@export`s; the manifest can be generated from `get_shader_uniform_list()`. Today's Shader Live rewrites
GLSL literals and pushes `CG UPDATE` per change (`src/shaderfx/shader-live-session.js`); Godot sets a uniform.

### 6.2 Binding table (audio -> parameter)
| Field | Values |
|---|---|
| `source` | any bus (`kick`, `snare`, `hats`, `bass`, `vocals`, ...), `band[0..5]`, `level`, `beat_pulse`, `beat_phase`, `onset`, `fft[lo..hi]` |
| `gain`, `offset`, `curve` | linear / exp / log |
| `attack_ms`, `release_ms` | envelope |
| `mode` | `add` to the slider, `multiply`, `replace` |

The slider stays the base value, so with no audio the scene still shows the operator's setting. This generalises the WO-662 knobs
(`flash`/`bump`/`kick`).

### 6.3 Preview vs program, takes
| Need | How |
|---|---|
| Thumbnails | one render at 320x180 per scene, served like WO-344 |
| Audition (PRV) | ring `vj-prv`, 960x540 / 25 fps, rendered only while auditioning (`SubViewport.render_target_update_mode = UPDATE_DISABLED` otherwise) |
| Program | rings `vj-a` / `vj-b`, 1080p; **Caspar does the transition** between them as two layers (looks/timelines already live there) |
| Stack | Shader Live runs several shaders on PGM layers 10-20 (WO-357). One ring per layer multiplies cost, so set a budget: a stack renders in-Godot into one ring above N rings |

### 6.4 Plugging into looks and takes
- WO-744 already lists rings in `GET /api/shm/sources` and plays `shm://<name>` (`SHM NAME`). `vj-a`/`vj-b` appear in the Live tab with no look code.
- Missing: a control channel. The VJ process is a normal WS client (own `Ws`, never the operator client). New: `POST /api/vj/scene {ring, scene}`,
  `POST /api/vj/param {ring, name, value|binding}`, `GET /api/vj/scenes`, modelled on `routes-shader-live.js`.
- Lease (deferred by WO-744): node starts and supervises the process like `godot/retro/run-retro.sh`; "no frames" comes from `signal` (500 ms).
- A look layer must carry `{scene, params, bindings}`, not just a pixel source: a schema change, its own WO in P1.

## 7. Risks

| Risk | Detail | Mitigation |
|---|---|---|
| Frame clock | Godot and the channel clock are unlocked (WO-738 §3); the producer takes the newest frame per tick, so a frame repeats or drops | cap `Engine.max_fps` at channel rate; frame counter in corner pixels so P0 can count; if visible render at 2x. The kiosk sets `vsync_mode=1` (`godot/client/project.godot:29`); the VJ project turns vsync off |
| Shared GPU | WO-500: at 100 % GPU the PGM ran at 72.8 % of realtime. `nvidia-smi` read 35 % when checked (idle show) | `cost` class in the manifest; governor lowers `SubViewport.size` or particle `amount_ratio` (which does not free memory) from its own frame time |
| Everything in one process | If Godot is THE engine, a crash stops all visuals, not one shader | separate process, node restarts it, layer holds the last frame (WO-742); ring per output so a bad scene cannot starve the others; keep a pre-rendered fallback loop (Movie Maker -> HAP) |
| Hang, not crash | live ring with no new frames | `signal` flag (`routes-shm-sources.js`); kill and restart; operator warning |
| Headless | `--headless` draws nothing (WO-738 §4) | own Xvfb display: WO-743 `tools/e2e/godot-shm-writer.sh` ran Forward+/Vulkan on this NVIDIA that way, 460 frames in 4 s, pixels exact |
| Renderer | `CompositorEffect`, compute, `emit_particle()` need Forward+ | the VJ project is Forward+ (`project.godot:33`) |
| No FFT source | DM3 absent or unrouted (§1.1) | scenes run silent: osc levels, then idle animation, with a "no audio" badge |
| `libhshm` overwrite | `cp` over a mapped `.so` crashes the process (WO-743) | VJ uses `libhshm_sink` only |
| Syncthing | caches and thumbnails written at runtime | add to `.stignore` first |
| Licences | AGPL/GPL analysers (§3.3); third-party shader authors (WO-586 kept per-shader headers) | analysers as separate processes; same header convention |
| FlowKit churn | mid-refactor, no releases | pin a commit, vendor it |

## 8. Questions for the owner
1. ~~The audio-analysis project~~ answered 30.10 with five links (§3.2); none is a classifier. Remaining: which "parts" matter (separate drum hits, vocals, or mood/energy sections), and do you have pre-split stems? That decides the feature-bus adapter (§3.2 recommendation 5).
2. Source material: a live band through the DM3 (FFT source exists), or played-back tracks (needs the §1.4 audio tap or per-track pre-analysis)?
3. Is 1080p render with Caspar upscaling acceptable for a 4K canvas?
4. Retire the HTML shader path only after parity (this report's order), or on a date?

## 9. Recommendation and phased plan

**Do it: a detached Godot VJ process, fed by the server's audio frame and feature buses, over the WO-742/743/744 ring. Existing shaders come
along as a `ShadertoySource` if P0's converter gate passes.**

### P0 — spike with pass/fail (about 4 days)
`godot/vj/` on an Xvfb display, one 1080p ring `vj-a`, audio texture + beat + 3-bus `AudioFeatures` from `Ws.on("audio_fft")`, frame counter in
corner pixels, `viewport_publisher.gd`; one native scene (tunnel + 100k particles) and a **translator/harness run over 20 library shaders**.

| # | Test | Pass |
|---|---|---|
| 1 | 120 BPM click into the FFT source; Caspar records output (`ADD 1 FILE`, audio+video in one file); flash-to-click offset over 100 beats | median known, p95 jitter <= 25 ms; stored as `lead_ms` |
| 2 | 10-minute run with a clip on another layer | PGM >= 99.5 % of realtime (WO-500 method); published >= 99 %; duplicate+dropped frames <= 0.5 % |
| 3 | `nvidia-smi dmon` | VJ <= 25 % GPU, total <= 70 %; per-frame ms logged per scene, particles, readback |
| 4 | CPU | VJ <= 40 % of one core |
| 5 | `kill -9` the VJ process mid-run | Caspar unaffected; restart and new frames <= 5 s |
| 6 | no FFT frames for 3 s | scene decays to idle, no errors |
| 7 | **Shader gate**: 20 library shaders (10 `sh-sa-*`, 10 others) through R1 | >= 12 compile and animate with audio; failures categorised (global, cast, forward-use, derivative, multi-pass); R2 tried on the failures |
| 8 | FlowKit on 4.7.2: load the addon, one sheet pulses a uniform on `On Onset` | runs, or the failure is recorded |
| 9 | Replace the §2 estimates with measured ms | table updated |

Fail on 1 or 2: fix transport first (2x render, or option B). Fail on 3: 1080p-only and a cost cap. Fail on 7: keep the HTML path longer and
reduce the Godot shader scope to the native scenes.

### P1 — usable by an operator (about 3 weeks)
| Item | Effort |
|---|---|
| Launcher, supervisor, lease, `routes-vj.js`, health from `signal` | 3 d |
| Manifest, `GET /api/vj/scenes`, param push, panel (extend the Shader Live panel: sliders, binding editor, presets) | 5 d |
| Rings `vj-a`/`vj-b`/`vj-prv`, take via Caspar transitions, thumbnails | 3 d |
| Server: export `onset`, `flux`, 6 bands (additive, smoke beside `smoke-wo662-beat-detect`) | 1 d |
| Feature-bus adapters: built-in + the owner's project (or a placeholder sidecar) | 2-4 d |
| FlowKit provider pack + pinned vendor copy | 3 d |
| `ShadertoySource` for the passing library shaders, literal -> uniform lift, beat wrapper | 5 d |
| 5 native scenes: tunnel, particles, FFT skyline, typography, feedback kaleidoscope | 3 d |
| Look/project schema carries `{scene, params, bindings}` (own WO) | 2 d |

### P2 — breadth and retirement
| Item | Effort |
|---|---|
| Remaining shaders via R1/R2, multi-pass chains, CI compile gate | 1-2 w |
| PGM/clip/DeckLink audio tap (§1.4) | 3-4 d, untested |
| Compute scenes (fluid, boids), `CompositorEffect` post pack | 1 w |
| Previs fixtures driven by buses | 1 w |
| MIDI/OSC mappings for the same parameters | 3 d |
| Pre-render fallback loops (Movie Maker -> HAP) | 2 d |
| Retire the HTML shader path (templates, Shader FX modal, Shader Live endpoints) after migration of saved looks | 1 w |

## What was done
Research only. Read WO-738, 742, 743, 744, 266, 335, 586, 606, 662; the audio capture, beat and bridge code; the Godot WS client and shm
publisher; the Godot class, shader and preprocessor pages cited; FlowKit's README, `plugin.cfg`, file tree, a provider and the event base
class through `gh api`; candidate analysers' licences, stars and push dates through `gh api`. Counted the `data/shaders` configs by
feature. Searched `~/Downloads`, `~/bridge`, `~/Documents`, `~/show` and `~/highascg` for the owner's audio project. No file changed except this WO.
Later 30.10: evaluated the owner's five links and the FlowKit asset page (§3.2, §4): asset pages 4958, 4673, 4506 by WebFetch; GitHub/GitLab
metadata via `gh api`/curl; READMEs of kessoning/Audio-Offline-Analysis and CanYuzbey/music-reactive-lighting, `audio_to_params.py`,
`beat_detection.py`, and in the latter `live_analyzer.py`, `onset.py`, `tempo.py` (first 150 lines), `emotion.py`, `features.py`,
`output.py`, `FrameAnalysis`; BarelyMusician and Resonate READMEs; the `AudioStreamInteractive` class page. Nothing cloned, installed or run.

## What was VERIFIED
- Repo claims: read at the cited lines. FlowKit and analyser facts: read from GitHub on 30.10.
- Godot docs did not describe: microphone device choice, audio latency, mutable shader globals, or `texelFetch` on that page; marked unverified.
- Not verified: every GPU and latency figure, the converter pass rate (R1 and R2), FlowKit on 4.7.2, the audio-tap design.
- Link evaluation (§3.2): **the Reddit post (link 2) was not read** (reddit.com blocked the fetch tool; a web search did not find it), so
  its row rests on the URL slug and the Godot class page. Not read: Resonate's source and language, `dynamics.py`, the key detector and
  `tempo.py` past line 150 in music-reactive-lighting, Godot's `AudioStreamSynchronized`/`Playlist` pages. Not run: any script. Not
  checked: whether librosa is installed on the box, HPSS cost per chunk, and the BarelyMusician GDExtension (asset page and README only).
