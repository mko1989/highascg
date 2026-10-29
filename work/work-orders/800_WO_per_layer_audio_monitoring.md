# WO-800 — Per-layer audio monitoring (levels per layer, not per channel)

**Status: IN PROGRESS (29.10) — option A built, deployed on the box and proven on the wire + node route (see "Verified" under Implementation); open: Godot/web per-layer VU display (follow-up), owner commits of both trees.**

Owner, 29.10:
> what are our options to finally get proper audio monitoring per layer? i know caspar is only sending per channel values.

## Problem

CasparCG reports audio levels per **channel** (the mixer output of a channel, OSC `volume`/meter
messages). A look puts several layers on one PGM/PRV channel, so the meters show the summed mix.
The owner cannot see or judge a single layer's level (for example one clip's audio under a loud
background).

Prior art: WO-284 (`284_WO_AUDIO_MIXER_INPUTS_VU_ROUTING.md`), WO-604 (Godot audio meters, slices 1–8
done, "meter ballistics side by side" open). Both meter per channel / per strip, not per layer.

## Options

**A — Caspar build with per-layer audio metering (true live levels).**
- In the Caspar mixer, each layer's frame audio is mixed into the channel. A per-layer peak/RMS can be
  computed in the same place (the layer's audio before it is summed) and sent out as an OSC/AMCP-readable
  value per `channel/layer`.
- Works for every source type: files, `route://`, live inputs, DeckLink, streams.
- Cost: a C++ patch in the owner's build tree (`caspar-build`, build-v2, 2.5.1-based — see the
  `caspar-build-v2-location` memory). Needs a rollback binary and a node restart after the swap.
- Pitfall (corrected 29.10 after the source lookup): the OSC-FLOAT-ENDIAN finding in OPEN_ISSUES was about
  an older deployed binary (WO-613 / build-v2 886998c). The 2.5.1 source tree in `caspar-build/src-v2`
  byte-swaps float32 to big-endian (`OscOutboundPacketStream.cpp:341-361`); int32 is big-endian too
  (`:55-58`). Check the deployed binary's wire bytes before choosing float or int32 for a new meter value.
- The existing `volume` value is an int32 sample peak per channel (`audio_mixer.cpp:250-262`), not dB or 0..1.
  A per-layer value needs the same unit decision.
- Also check the Caspar meter-null consumer path: a per-layer value must not be sent over AMCP per frame.

**B — Cheap: analyse the file once, store dB over time, drive the VU from file/time.**
- For each media file, precompute a dB curve (ffmpeg `astats` / `ebur128` per 10–20 ms) into a sidecar
  (`time_s → dBFS`). At runtime, the layer's `file/time` (already tracked in `src/osc/osc-state.js`,
  WO-252) indexes the curve; the VU shows the value.
- No Caspar build, no change to the audio path. Works today for file-backed clips.
- Limits: **file clips only**. Not `route://`, not live inputs, not DeckLink, not streams, not generated
  sources. The curve is the file's audio before the layer's volume/mixer gain — the layer gain must be
  applied in the UI. It is a playback-time reading, not a measurement (a seek or a pause is fine; a
  slow-motion or speed change needs the scale applied).

## Recommendation

- Do **B** now as the stopgap for the file-based clips that are most used. It is a few days of work
  and no risk to playout.
- Do **A** as the real fix for live and route sources. It needs the owner's go on touching the Caspar
  build; the decision is owner's, not this WO's.

## Owner decision (29.10)

Option A, per-layer metering in the Caspar build. Option B is not built. Dev mode until 03.11.26
(`work/DEV_MODE_UNTIL_2026-11-03.md`): Caspar binary swaps and node restarts are allowed; keep the rollback binaries.

## Owner decision needed (answered)

1. Build A (Caspar patch) — yes / later?
2. Build B now as the stopgap — yes / no?

## Acceptance (once the option is chosen)

- A layer's VU moves with that layer's audio only, verified on the box with two layers of different levels
  on one channel (probe value vs. the file's known level).
- For B: a curve generated for each media file in the project; VU at a known timestamp matches the
  `ebur128`/`astats` reading within 1 dB.

## Verified

_(none yet)_

## Caspar source lookup (29.10, Haiku read-only pass)

Source tree used: `/home/casparcg/caspar-build/src-v2/src` (CHANGELOG head = "CasparCG 2.5.1 Stable"; `build-v2/CMakeCache.txt` CMAKE_HOME_DIRECTORY = `.../src-v2/src`). The sibling `src-tree` also has the same mixer files; not compared. Binary-to-source match for the deployed build: UNVERIFIED (no build run, no diff).

1. **Layer audio is summed in `audio_mixer::impl::mix()`** — `core/mixer/audio/audio_mixer.cpp`.
   - `visit()` (l.86-92) queues each layer frame as `audio_item{frame.stream_tag(), transform, samples}`; it is skipped when volume < 0.002.
   - `mix()` (from l.~116) loops over items; the per-layer sum is `mixed[n] += sample_value * applied_volume;` at l.205. `applied_volume` is the layer's transform volume with ramping (l.189-202).
   - Master volume is applied once after the sum (l.239-241). No per-layer level is stored here.
   - Caller: `core/mixer/mixer.cpp:~70-77` (`audio_mixer_(format_desc, nb_samples)`).

2. **Levels already computed: per channel only.**
   - `audio_mixer.cpp:250-262`: peak `max[ch] = max(|result|)` over the summed buffer, stored in `state_["volume"]` (int32 per channel). Graph value at l.264. Clip tag at l.258-260.
   - No per-layer peak/RMS exists anywhere in the mixer (checked the `mix()` loop; no per-tag accumulator).
   - Emitter chain: `audio_mixer::state()` (`audio_mixer.cpp:284`) -> `mixer::state()` stores as `state_["audio"]` (`mixer.cpp:77`, `mixer.cpp:125`) -> `video_channel` builds `state["mixer"]` (`core/video_channel.cpp:180`) -> `tick_(state_)` (`video_channel.cpp:189`) -> OSC `client::send(const monitor::state&)` (`protocol/osc/client.cpp:187-196`, stores bundle) -> sender thread in `client::impl` (`client.cpp:~94-131`) writes each element through `param_visitor` (`client.cpp:46-63`) -> `OutboundPacketStream`. AMCP INFO path: `info_channel_command()` (`protocol/amcp/AMCPCommandsImpl.cpp:1650`) iterates the same `raw_channel->state()`.
   - The OSC address string is built at `client.cpp:127` (`BeginMessage(it->first)`); exact address form for `audio/volume` is UNVERIFIED (not traced beyond the key).
   - Note: the `volume` value is an int32 sample peak, not a dB or 0..1 float on the wire.

3. **OSC byte order.**
   - int32 (what `volume` uses): `OscOutboundPacketStream.cpp:55-58` `FromInt32` writes `caspar::big_endian(x)` — big-endian per OSC spec, regardless of host.
   - float/double: `OscOutboundPacketStream.cpp:341-361` `operator<<(float)` byte-swaps explicitly when `OSC_HOST_LITTLE_ENDIAN` is defined (the `#error` guard at l.40-44 forces a definition; WO-613 fix). `param_visitor` converts double -> float (`client.cpp:61`).
   - `OscHostEndianness.h:33` unconditionally `#define`s `OSC_HOST_LITTLE_ENDIAN 1` (before the l.42 detection block), so the float branch at l.341-353 takes the byte-swap path: the float is written big-endian on the wire. Conclusion: int32 and float args both big-endian in this source tree. The little-endian float finding in OPEN_ISSUES is UNVERIFIED against the deployed binary (not checked; no build or packet capture run).

Practical read for WO-800 option A: a per-layer value needs a new accumulator in `mix()` keyed by `item.tag` (before/inside the l.205 sum) and a new state key per layer. The tag is a stream pointer, not a layer index, so mapping tag -> layer index is UNVERIFIED (not traced in this pass).

## Implementation (29.10, Opus)

### Investigation (before any code change)

Source = `~/caspar-build/src-v2/src`, branch `wo742-shm-producer`, HEAD `4eab31c06`, worktree clean.

**Which binary is deployed.** `bin/casparcg` md5 `909fd24b` = `~/caspar-build/build-26/shell/casparcg` (native 26.04
build from src-v2 `4eab31c06`, `build-26.log`), NOT `build-v2/shell/casparcg` (md5 `b2bb40f5`, the 24.04 build, kept as
`bin/casparcg.pre-26build`). AMCP `VERSION` → `2.5.1 4eab31c06 Stable`. So the patch is built in **build-26**
(`cmake --build ~/caspar-build/build-26`); a build-v2 binary would need the noble compat libs and be a step back.

**Layer index → audio item: the stream tag is not usable; the index is dropped in the stage.**
- `stream_tag` is a producer/frame pointer (`core/frame/frame.cpp:87,179`; `route_producer.cpp:47-70` rewrites it so routed
  audio keeps cadence state). It never encodes a layer index, and one layer can carry several tags (a transition mixes
  two producers' frames inside one layer frame; `route://1` wraps every layer of the source channel).
- `core/producer/stage.cpp:124` collects `std::map<int, layer_frame> frames` keyed by layer index; `:202-206` pushes only
  `p.second.foreground1/2` into `stage_frames.frames/frames2` (`stage.h:57-63`) — the index is lost here.
- `core/video_channel.cpp:163,167` hands those vectors to `mixer_(…)`; `core/mixer/mixer.cpp:68-72` does
  `frame.accept(audio_mixer_)` once per layer frame, in layer order. `audio_mixer::impl::visit()` (`audio_mixer.cpp:86-92`)
  therefore sees the frames of one layer between two top-level `accept` calls but has no index.
- Cleanest carry: add `std::vector<int> layers` to `stage_frames` (parallel to `frames`, filled at `stage.cpp:202`), pass it
  to `mixer::operator()`, call `audio_mixer.begin_layer(index)` before each `accept`, and stamp `audio_item.layer` in
  `visit()`. All audio of a layer (transition pairs, nested route frames) then lands under that layer. Only `stage`
  implements `operator()` (`stage_delayed` does not), and `video_channel.cpp` is the only `mixer_` caller.

**Peak computation.** Channel peak = sum over items (`audio_mixer.cpp:205`) → × master volume, clamp to int32
(`:239-249`) → per audio channel `max |sample|` (`:251-256`) → `state_["volume"]` (`:262`). Per layer the same: a per-layer
`double` buffer summed with the same `sample_value * applied_volume` (layer transform volume + ramp), then × master,
clamped, per-channel abs max. With one audible layer the layer value equals the channel value exactly.

**OSC address.** `shell/server.cpp:290-292` wraps each channel tick as `state[""]["channel"][id] = channel_state`;
`video_channel.cpp:180` adds `mixer`, `mixer.cpp:77` adds `audio`; `client.cpp:127` writes the flat key as the address.
The `monitor::state` proxy joins keys with `/` (`core/monitor/monitor.h`). Live capture on :6250 confirms
`/channel/1/mixer/audio/volume ,iiiiiiiiiiiiiiii` (16 int32, one per audio channel). The new key
`state_["layer"][L]["volume"]` will therefore go out as **`/channel/<ch>/mixer/audio/layer/<L>/volume`** with the same
16 × int32 shape. The existing `…/mixer/audio/volume` message is untouched.

**Byte order on the deployed binary (wire bytes, 29.10).** Captured on :6250 (`osc_sniff.py --raw`):
`/channel/1/stage/layer/10/foreground/file/time ,ff [63.32, 63.32] 427d47ae 427d47ae` → `0x427d47ae` read big-endian
= 63.32 (correct), so float32 is big-endian on this binary (886998c fix is in). int32 is big-endian
(`…/file/streams/0/fps ,ii 00000019 00000001` = 25/1). Choice: **int32**, same unit as the channel `volume`
(int32 sample peak), so `intMeterSampleToDbfs()` (`src/osc/osc-state-audio.js:10`) converts both the same way.

**Traffic.** The per-layer key exists only for layers that queued an audio item this frame (a layer with
transform volume < 0.002 or no audio data is skipped at `audio_mixer.cpp:88`). `state_` is rebuilt per mix so a cleared
layer's key disappears. Silent channels (no audio layers) send nothing new. It rides the existing per-frame OSC bundle;
AMCP `INFO <ch>` lists it too (on request only); no per-frame AMCP traffic.

**Node side.** `src/osc/osc-state.js:163-164` routes `mixer/audio/*` to `_routeMixerAudio()`
(`src/osc/osc-state-audio.js:39`), which ignores unknown subpaths (`layer/10/volume` matches neither `volume` nor
`^\d+/dBFS$`), so older node code is safe against the new message. `src/api/router.js` is at the 500-line limit; the
read route goes through the existing `/api/osc/*` wildcard (`router.js:224` → `src/api/routes-osc.js`).

**Test material on the box (ch 1):** layer 10 `INTRO_v3.mov` (held at end, 63.32 s), layer 11 `PK BACK TRACK.wav`,
layer 12 `PK CLICK.wav` (11 and 12 play in sync, `file/time` 2845 s of 2858 s at capture).

### What was done

**Caspar (`~/caspar-build/src-v2`, uncommitted, base `4eab31c06`; diff also saved as
`caspar/patches/wo800-per-layer-audio-meters.patch` in this repo — owner commits both):**
- `core/producer/stage.h` (+1) / `stage.cpp` (+1): `stage_frames.layers` = layer index per entry of `frames/frames2`.
- `core/video_channel.cpp` (2 lines): passes `stage_frames.layers` to both `mixer_(…)` calls.
- `core/mixer/mixer.h` / `mixer.cpp`: `operator()(frames, format_desc, nb_samples, layers = {})`; calls
  `audio_mixer_.begin_layer(layers[i])` before each layer's `accept`, `begin_layer(-1)` after the loop.
- `core/mixer/audio/audio_mixer.h` (+3) / `.cpp` (+41/-3): `audio_item.layer`; `visit()` stamps `current_layer_`; `mix()`
  sums each item's `sample_value * applied_volume` into a per-layer buffer next to `mixed[n]`; after the master
  stage the per-layer peak = per audio channel `max |buf × master|` clamped to int32; `state_` is rebuilt per mix with
  `volume` (unchanged) + `layer/<L>/volume`.
- Why this way: the stream tag is a producer pointer and a layer can hold several (transition, routed channel), so
  the stage's own layer index is the only correct key; it costs one int vector per tick and no extra AMCP/OSC calls.
- Unit/type: int32 sample peak (same as the channel `volume`); float would have worked on this binary but would
  need a second conversion path.

**Build/deploy:** `~/caspar-build/build-26.sh` (native 26.04 build dir — the deployed binary's origin; see Investigation),
28 ninja steps, rc 0, no new warnings. New binary md5 `16a73673`; old one kept as `bin/casparcg.pre-wo800` (md5 `909fd24b`).
`casparcg.prev`, `.253c16c`, `.v1-shm`, `.pre-26build`, `.pre-wo742-…`, `.pre-wo790` untouched. Swap: `cp` →
`casparcg.new`, `mv -f`, AMCP `RESTART` (`202 RESTART OK`, AMCP back in 17 s, `/proc/<pid>/exe` md5 `16a73673`), then
`kill -TERM` node (journal: `[OSC] float byte order verified big-endian`). VERSION still prints `4eab31c06` (no commit).
casparcg.config not changed.

**Node (this repo):**
- `src/osc/osc-state-audio.js` (+61): `mixer/audio/layer/<L>/volume` → `_routeLayerAudio()` stores
  `{ nbChannels, levels: [{ dBFS, peak, peakAge }] }` per channel+layer in `this._layerAudio` (outside `_channels`, so
  `/api/state` and WS payloads are unchanged; never dirties the channel); `getLayerAudioLevels(ch?)` drops entries older
  than `osc.staleTimeoutMs` (Caspar stops sending a layer when it stops contributing audio).
- `src/osc/osc-state.js` (+3): `_layerAudio` init + reset in `clear()`.
- `src/api/routes-osc.js` (+8): `GET /api/osc/audio-layers` and `/api/osc/audio-layers/:ch` (via the existing `/api/osc/*`
  wildcard — `router.js` is at 500 lines).
- `tools/smoke/smoke-wo800-per-layer-audio.test.js` (new, 4 tests) registered in `tools/ci/offline-test-files-2.js`.

### Verified (29.10)

Probe scripts (scratchpad, session 03d195b7): `osc_sniff.py` (UDP :6250 + AMCP client sourced from :6250) and
`osc_layer_track.py` (groups messages per OSC bundle time tag = one channel tick).

1. **Wire format:** `/channel/2/mixer/audio/layer/11/volume ,iiiiiiiiiiiiiiii [...]` and `…/layer/12/volume` appear next to
   the unchanged `/channel/2/mixer/audio/volume`; ch 3/4/6 (no audible layer) send no layer messages; layer 10
   (`INTRO_v3.mov`, ffprobe: video stream only) never appears.
2. **Levels vs the files** (`osc_sniff.py 10 … --stats`, ch 2, file/time 14.44–24.44 s, 501 ticks) against
   `ffmpeg -ss 14.44 -t 10 -i <wav> -af astats=measure_overall=none:measure_perchannel=Peak_level -f null -`:
   - layer 11 `PK BACK TRACK.wav`: max 271315712 / 320672512 → −17.969 / −16.517 dBFS; astats −17.969098 / −16.517363 dB.
   - layer 12 `PK CLICK.wav`: max 966990336 / 966989312 → −6.930 / −6.930 dBFS; astats −6.930155 / −6.930164 dB.
   - channel max = 966990336 / 966989312 (= the louder layer).
3. **Layer gain, one layer only:** `MIXER 2-11 VOLUME 0.5 0` for 4 s (file/time 121.62–125.60 s), then restored to `1`
   (read back `1`): layer 11 max 57958784 / 73592448 = −31.376 / −29.302 dBFS = astats(121.60 s, 4.02 s) −25.356 / −23.281
   dB minus 6.021 dB; layer 12 unaffected.
4. **Per-frame tracking** (`osc_layer_track.py 10 2`): 498 ticks, 996 L/R checks all within
   `max_i(l_i − Σ_{j≠i} l_j) ≤ channel ≤ Σ l` (49 below the louder layer = partial cancellation of the two signals,
   physically correct); 504/504 single-active checks channel == layer exactly. `route://` layer ch 5-11:
   316/316 exact.
5. **Node route:** `GET /api/osc/audio-layers` → `ch 2 layer 11/12`, `ch 5 layer 11` (16 audio channels each); polled with
   `/api/osc/audio/2`: e.g. `L11 [-37.4,-36.6] L12 [-6.9,-6.9] CH [-7.0,-7.1]`.
6. **Offline:** new test 4/4; with the related OSC smokes 17/17; full curated suite `run-offline-tests.js` 3433 tests,
   3431 pass, 0 fail, 2 skipped; `check-max-file-lines` 0 over; `check-unwired-exports`, `check-tdz-reads` pass;
   `check-require-integrity` fails only on 11 pre-existing Syncthing `*.sync-conflict-*` files under `projects/` (June).

**Not verified / follow-up:** Godot or web per-layer VU display (nothing renders the new route yet); interlaced
channels (second field overwrites the state, same as the channel meter; no interlaced channel on the box); the
route's levels are a 50 Hz sample of the latest tick, not a ballistics meter (WO-604 open item).
