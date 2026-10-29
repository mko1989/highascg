# WO-800 — Per-layer audio monitoring (levels per layer, not per channel)

**Status: IN PROGRESS (29.10) — option A built, deployed on the box and proven on the wire + node route (see "Verified" under Implementation); Godot per-layer lane built + unit-tested (glass look = owner QA); web display built 29.10 (Audio tab lane, offline suite + sandbox/headless-Firefox screenshots; see "Web display (29.10)"); Caspar frozen-level bug fixed + deployed 29.10 (see "Caspar fix: frozen level"); open: owner commits of both trees. · live e2e 29.10: Godot lanes PASS on the glass**

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

**Not verified / follow-up (at the time of the Caspar pass):** Godot or web per-layer VU display (nothing renders the new route yet); interlaced
channels (second field overwrites the state, same as the channel meter; no interlaced channel on the box); the
route's levels are a 50 Hz sample of the latest tick, not a ballistics meter (WO-604 open item).

## Godot display investigation (29.10, Opus)

**Endpoint on the box (curl, read-only).** `GET /api/osc/audio-layers` →
`{ channels: { "2": { "10": { nbChannels: 16, levels: [{ dBFS, peak } ×16], updatedAt }, "11": …, "12": … }, "5": { "11": … },
"6": { "1": … } }, updatedAt }` — channel and layer keys are strings; each layer entry also carries its own `updatedAt`
(`src/osc/osc-state-audio.js:164-168`). `dBFS` is the current value, `peak` is the node's peak hold (layer 11: dBFS −27.3,
peak −15.4); silent audio channels read −120. `/api/osc/audio-layers/1` → `{ channels: {} }` (ch 1 had no audible layer).
Entries older than `osc.staleTimeoutMs` (default 1000 ms) are dropped (`osc-state-audio.js:150-160`), so "absent" = the
layer contributes no audio.

**Where the console's meters come from today.**
- `features/live/osc_mirror.gd:12-30` — the shared OSC mirror (`Ws.on("osc")`, snapshots + deltas). The per-layer store is
  deliberately outside `_channels` (`osc-state-audio.js:119`), so it is **not** in the WS payload: the Godot client must poll.
- `features/audio/audio_tab.gd:339-371` — the meter loop: 20 Hz (`AM.TICK_S`) while the tab is visible; one bar per strip
  (`_meter` → `AM.read_key` → `AM.smooth` → `s.meter.set_bar`), one bar per bus channel on a master.
- `features/audio/audio_meter_model.gd:198-205` `layer_peak`: a layer strip shows the **channel bus** peak while the layer is
  on air (it first looks for `osc.channels[ch].layers[L].audio.levels`, which the node never fills — `osc-state-layer.js:298`
  is `file/audio/*` stream info, not levels). So today every layer strip on one channel shows the same summed level.
- Scale + ballistics: `AM.smooth` (`audio_meter_model.gd:268-270`: −60…0 dBFS → 0…1, instant rise, 0.45 fall per 50 ms tick)
  and `AM.colour` (`:274-275`: green, red above −1 dBFS). Bars are drawn by `meter_bank.gd:37-51`.
- Strip layout: `audio_strip.gd:47` (master 100+, dense 64, else 84 px), body = meter (`meter_bank.gd:25`, min 10 px) + scale
  (20 px) + fader (`FaderCap.WIDTH` 26 px) + 2 × 3 px separation + 2 × 8 px panel margin (`theme_builder.gd:64`) = 78 px — the
  dense strip is already content-bound at 78 px, the 84 px strip has 6 px spare.

**Layer row → Caspar (channel, layer).** Rows come from `audio_rows.gd`: scene look rows (`_scene_rows`, `:166-194`, key
`pgm:<ch>:layer:<L>`, `audioScreens` set only here), timeline rows (`:149-163`, L = 210 + idx), live-audio slot rows (`:124-132`),
the audio-only look (`:133-145`, L = 200), dedicated input rows (`input_rows`, `:243-256`, `ch` = the input channel, `layer`
= its producer layer). `row.ch` / `row.layer` is the physical pair for all of them **except scene look rows on a PGM channel in
bank B**: physical = L + 100 for look layers 10–99 (`src/engine/look-layer-ranges.js:9-11`); the bank per channel is
`scene.programLayerBankByChannel` (on the box `{1:a,2:a,3:a,4:a}`), as `pgm_timer_model.gd:174-186` reads it. The
live-audio scene row has `hostChannel` set, but its meter belongs on the program channel layer (that is where the routed audio
is mixed), so the lane uses `row.ch`, not `hostChannel`. Masters have no layer → no lane.

**Decision.** Poll `GET /api/osc/audio-layers` (all channels, one request) every 200 ms while the Audio tab is visible and at
least one strip has a layer; no WS change (the server side is committed; adding it to the 25 Hz WS snapshot would put 16
levels × every audible layer into every client's stream). The layer level = the max `dBFS` over the layer's audio channels,
through `AM.smooth` / `AM.colour` at the existing 20 Hz tick (same scale, same ballistics; a 5 Hz source under a 20 Hz falling
meter). The display is a thin lane (4 px) inside the strip's existing meter control, so the strip does not get wider; the lane
is drawn only while the layer is in the response (no audio → nothing, no empty bar). The wide bar keeps its current
meaning (channel level while the layer is on air) — replacing it was not asked for and is left to the owner.
Known gaps: `switcher_bus` transition model remaps the PGM channel (`pgm_timer_model.gd:180-183`) — not followed here;
PRV is bank-less, so preview rows (none exist in the console today) would need no shift.

### Godot display — what was done (29.10, Opus)

- `godot/client/features/audio/layer_levels.gd` (new, 68 lines, static): `target(row, banks)` → physical [ch, layer]
  (bank B look layers +100; masters / rows without a layer → []), `entry` / `peak` (max `dBFS` over `nbChannels`), `read`
  → `{present, level}`, `lane_tick(prev, read)` → `[AM.smooth(...) or −1 = hidden, AM.colour(...)]`. `PATH`, `POLL_S` = 0.2.
- `meter_bank.gd` (78): `enable_lane()` (single-bar banks only) reserves a 3 px lane + 1 px gap on the right inside the same
  10 px control (no wider strip); `set_lane(v, colour)`; `_draw` paints the lane only when `lane >= 0`. The meter takes a
  tooltip (mouse PASS) when it has one.
- `audio_strip.gd` (304): layer strips (any row `LL.target` maps) call `meter.enable_lane()` + tooltip
  "Wide bar: the channel's level · thin bar: this layer's own audio (only while it has any)".
- `audio_tab.gd` (405): `_poll_layers()` every `LL.POLL_S` from `_process` (which returns early while hidden), one request at
  a time, skipped when no strip has a lane; a failed read or a hidden tab clears the data. `_lane()` runs in the 20 Hz meter
  tick next to `_meter()` and keeps its smoothing under `<key>:lane` in `_smooth`. Bank map:
  `Store.get_value("scene.programLayerBankByChannel")`.
- Why a lane and not a new widget: the dense strip is already content-bound (78 px, see the investigation); a separate control
  would widen every layer strip. Why poll: the per-layer store is outside the WS payload by design.

### Godot display — verified (29.10)

- Godot suite (`run-client.sh --test`): 22029 passed, 0 failed (new `tests/test_audio_layer_levels.gd`, 6 tests: row → layer
  incl. bank B / live-audio host / masters, level from the box's response shape, scale + ballistics = `AM.smooth` / `AM.colour`,
  lane hidden until audio, no wider meter, poll only while visible).
- `run-client.sh --check`: boot OK; a second headless boot on the Audio tab (`--tab=3`, 8 s): no script errors.
- Live data through the real code (scratch probe: `audio_rows.program_rows` over the box's `/api/state` with ch 2 as program,
  `layer_levels.read` over the live `/api/osc/audio-layers`): `pgm:2` master → no lane; L10 → [2,10] −8.5 dBFS (lane 0.86, ok);
  L11 → [2,11] −33.1 dBFS (0.45); L12 → present, silent (lane 0). On the box the console's program channels are 1/3 and their
  looks carry no audio layers right now, so no lane is on screen yet.
- `check-max-file-lines`: 0 over.
- **Not verified:** the look on the glass (lane width / legibility at the dense 64→78 px strip), a bank-B take live, the
  `switcher_bus` remap, the GUI's polling against the server under load. Owner QA.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**Godot lanes PASS; one bug in Caspar.** The Audio tab draws per-layer lanes with live levels for Intro
(L10 INTRO_HAP, L11 PK BACK TRACK, L12 PK CLICK) on PGM ch1 (q800_lanes.png).
- **Finding (Caspar C++, not fixed):** a layer that has ended or is empty keeps showing its last level. The level freezes
  because of the "hold last sample" branch with `item_size == 0` in `~/caspar-build/src-v2/src/core/mixer/audio/audio_mixer.cpp`
  (per-layer meter code, about lines 140–235 and 282–297). Suggested fix: skip the layer accumulation when `item_size == 0`.
- The web display is not built, so it was not checked.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).

## Web display (29.10)

### Investigation (before any code change)

- **Where the web draws the Audio tab's meters.** `client/lib/app-tabs.js:25` → `initAudioMixerView`
  (`client/components/audio-mixer-view.js`) → `mountAudioMixerViewConsole` (`client/components/audio-mixer-view-console.js:18`).
  Rows come from `collectProgramAudioRows` (`client/lib/audio-mixer-rows.js`; look rows carry `audioScreens`, `:188`, timeline
  rows L = 210 + idx, audio-only look L = 200, live-audio slot rows, dedicated inputs keyed `input:<ch>`, `:284`). Layer strips are
  drawn by `client/components/audio-mixer-console-input-groups.js` (meter markup `:119`, `meterFills.set` `:145`).
- **One meter loop for everything:** `createAudioMeterLoop` (`client/lib/audio-mixer-meter-loop.js`, created at
  `audio-mixer-view-console.js:25`): 50 ms interval (`:42`), −60…0 dBFS → 0…1 (`:103`), instant rise, `SMOOTH_FALL = 0.45` per tick
  (`:43`), green `#22c55e` / red above −1 dBFS (`:120`; the console passes the colours). The Godot `AM.smooth` / `AM.colour` are
  this same model, so "same scale, same ballistics" means reusing this loop.
- **What a layer strip shows today:** `readLayerPeakDbfs` (`client/lib/audio-mixer-peaks.js:133`) → the channel bus level while the
  layer is on air (it first tries `osc.channels[ch].layers[L].audio.levels`, `:144`, which the node never fills) — the same summed
  level on every layer strip of a channel, as in Godot.
- **Data:** the per-layer store is outside the WS snapshot (see the Godot section), so the web must poll `GET /api/osc/audio-layers`
  like Godot. The box now enforces the WO-811 API token (plain `curl` → 401); `apiGet` (`client/lib/api-client.js:19`) sends the
  session cookie, so the web needs nothing extra. Live read 29.10 (token, read-only): ch 1 is in **bank B** and reports layers
  `111`/`112` (look layers 11/12 + 100), ch 2 reports `10`/`11`/`12` — the bank shift is live, not theoretical.
- **Staleness (correction to the Godot section):** `osc.staleTimeoutMs` is **5000** on the box (`config/osc.json:7`,
  `src/config/defaults-core.js:81`); 1000 is only the fallback in `getLayerAudioLevels`. So when Caspar stops sending a layer, the
  node keeps returning its last level for up to 5 s. The response's `updatedAt` is the node's `now` (`src/osc/osc-state.js:237`,
  `src/api/routes-osc.js:85`) and each entry has its own `updatedAt` (same clock), so the client can age entries itself.
- **Room for a lane.** Strip 98 px − 2 × 10 px padding (`07c3-audio-mixer-view-channel-strip.css:8,12`) = 78 px; dense 80 px
  (`07c2-audio-mixer-view-console-layout.css:98`) → 60 px. Content: meter 7 px (`07c3:117`) + scale 22 px (`:177`) + fader 18 px
  (`:190`) + 2 × 6 px gap (`:73`) = 59 px, `justify-content: space-between`. A lane in the flex flow would widen or shift the dense
  strip; an absolutely placed 3 px lane at x = 9…12 px sits inside the meter→scale gap (≥ 6 px) without moving anything.
- **Existing web bug seen on the way (not fixed, out of scope):** the wide bar's on-air test `isLayerStripOnAir`
  (`client/lib/audio-mixer-meter-eligibility.js:69`) looks up the **logical** layer, so in bank B a look layer strip's wide bar
  stays dark unless it is the only media layer (seen in the sandbox: `bankb/audio-strips.png`, wide bar 0 %, lane live).

### What was done

- `client/lib/audio-layer-levels.js` (new, 123 lines, pure — the web twin of `layer_levels.gd`): `layerLevelTarget(key, meta, banks)`
  → physical `[ch, layer]` for `pgm:<ch>:layer:<L>` strips only (look rows +100 in bank B; masters and `input:<ch>` strips →
  none), `layerLevelEntry` / `layerLevelPeak` (max `dBFS` over `nbChannels`), `readLayerLevel` → `{ present, level }`,
  `createLayerLevelPoller({ get, wanted })` (200 ms, one request at a time, failed read or hidden view → no data, `stop()` drops
  the last reading). `LAYER_LEVELS_FRESH_MS = 500`: an entry older than that against the response time counts as absent.
- `client/lib/audio-mixer-meter-loop.js` (181): optional `laneFills` + `layerLevels()`; each tick, after the bars, a lane per
  layer strip through the **same** `smooth()` / `colourFor()` the bar uses (factored out of the loop, maths unchanged); the
  lane is `hidden` while the layer is absent, and its smoothing key `<key>:lane` is dropped.
- `client/lib/audio-mixer-rows.js` (+2): `meterMetaForInputRow` adds `lookLayer` (row has `audioScreens`) for the bank-B shift.
- `client/components/audio-mixer-console-input-groups.js` (+8): every layer strip gets
  `<div class="audio-mixer-view__meter-lane" hidden>` after the meter and registers it in `laneFills`; the meter gets the Godot
  tooltip text ("Wide bar: the channel's level · thin bar: this layer's own audio (only while it has any)").
- `client/components/audio-mixer-view-console.js` (+19): owns `laneFills` and the poller (`wanted` = tab active and a lane exists),
  starts/stops it with the meter loop on render, tab hide and `stop()`.
- `client/styles/07c3-audio-mixer-view-channel-strip.css` (+26): the lane — absolute, `left: 9px`, 3 px, meter background,
  `pointer-events: none` (no pointer handling at all, so nothing for Firefox drag to break).
- `tools/smoke/smoke-wo800-web-layer-levels.test.js` (new, 5 tests) + one line in `tools/ci/offline-test-files-2.js`.
- **Same as Godot:** endpoint, 5 Hz poll only while visible, max over `nbChannels`, the bar's scale / ballistics / colours, lane
  hidden when the layer has no audio, wide bar keeps its meaning, strip width unchanged.
- **Different from Godot, on purpose:** (1) no lane on dedicated input strips (`input:<ch>`): their wide bar already meters that
  input's own channel, so the lane would repeat it (minimalism); Godot gives them one. (2) the 500 ms freshness rule above, so a
  layer Caspar stopped sending disappears in ≤ 0.7 s instead of holding for 5 s — Godot could take the same rule
  (`layer_levels.gd` `entry()`). It does **not** cover the Caspar frozen-level bug recorded under "Live e2e" (Caspar keeps sending
  the old value, so the entry stays fresh); that needs the C++ fix.
- Only the Audio tab console. The inspector's compact mixer (`client/components/audio-mixer-panel*.js`, horizontal meters) has
  no lane.

### What was verified

- New smoke: 5/5 — strip → channel/layer (bank A/B, look vs fixed layers, masters/inputs none), level from the box's recorded
  payload (ch 1 bank B `111` = −24.59 dBFS), freshness 480 ms present / 520 ms absent, the **real meter loop** driving fake lanes
  (−24.59 dBFS → `59.0%` green, −18.06 → `69.9%`, > −1 dBFS → red, present-but-silent → shown at `0.0%`, absent → hidden,
  0.45 fall per tick, smoothing dropped when the layer leaves), the poller (no request while unwanted, one GET of
  `/api/osc/audio-layers`, `stop()` and a failed read clear the data), and source guards on the markup / wiring / CSS.
- Full curated offline suite (`node tools/ci/run-offline-tests.js`): **3639 tests, 3637 pass, 0 fail, 2 skipped**.
  `check-max-file-lines` 0 over; `check-unwired-exports` no new orphans; `check-tdz-reads` clean; `npm run -s format:check`
  passes; eslint on the touched files: 0 errors, 2 warnings, both present at HEAD (`audio-mixer-console-input-groups.js` empty-state
  `innerHTML`, `audio-mixer-meter-loop.js` `busKey`). `npm run build:client` OK.
- **Rendered, end to end through the node:** WO-719 sandbox server (`tools/e2e/sandbox-server.js`, `--no-caspar`, own port; the
  live :4200 untouched) + the built `dist-web/` (the sandbox is API-only, so a scratch proxy served `dist-web/` and forwarded
  `/api` + WS) + headless Firefox 140 ESR over WebDriver BiDi (no display used). A look with L10 `e2e_bars.mp4`, L11/L12
  `e2e_tone.wav` was taken on ch 1; fake Caspar OSC went to the sandbox's OSC port at 25 Hz: `layer/<10|11 (+100 in bank B)>/volume`
  (16 × int32; L10 −18 / −18.5 dBFS, L11 −6 ± 3 dBFS), nothing for L12. DOM probe + screenshots:
  - bank A (layers 10/11): L10 lane `70%` green (= −18 dBFS), L11 `89.3%` → `93.7%`, L12 lane hidden; strip width 98 px.
  - bank B (layers 110/111): the same lanes on the L10/L11 strips (so the +100 shift works in the real page).
  - feed stopped: all lanes hidden 2.5 s later (freshness rule; the node still held the entries for its 5 s).
  - Screenshots (looked at): scratchpad session 03d195b7 `wo800web/banka/audio-view-a.png` (whole page),
    `wo800web/banka/audio-strips.png` (strips with lanes), `wo800web/banka/audio-strips-silent.png` (after the feed stopped),
    `wo800web/bankb/audio-strips.png`, `wo800web/audio-strip-L10-zoom.png` (meter + lane at 4×). Script: `wo800web/shot.js`.
- **Not verified:** real Caspar levels in the web page on the box (the live server is in use by another session; the node route and
  wire were proven in the Caspar pass, and the page reads the same response), the look on the owner's Firefox at the box's
  zoom, `switcher_bus` remap (as in Godot, not followed).

### Web follow-up: bank-B wide bar (29.10, Opus)

Found by the web-display agent: a look-layer strip on a bank-B channel kept its WIDE bar dark while its lane was live
— `readLayerPeakDbfs` (`client/lib/audio-mixer-peaks.js`) passed the logical layer (11) to `isLayerStripOnAir` and the
OSC layer lookup, but Caspar plays it on 111. Fixed by mapping through the lane's own `layerLevelTarget` (same meta +
`scene.programLayerBankByChannel`), so bar and lane agree. `isSoleLiveSceneMediaLayer` keeps the logical number (it
reads the scene state). Smoke `smoke-wo800-web-layer-levels` +1 case (6/6; fails with the logical layer forced back);
offline 3638/0; client rebuilt.

### Godot follow-up: 500 ms freshness (29.10, Opus)

The web lane already treated an entry older than 500 ms (response `updatedAt` − entry `updatedAt`) as absent; Godot did
not, so an ended clip kept its last level for the node's 5 s `osc.staleTimeoutMs`. `features/audio/layer_levels.gd`
`entry()` now applies the same window (`FRESH_MS := 500`); entries with no timestamps stay present. Godot suite 22813/0
with the new `test_entry_older_than_fresh_ms_is_absent`; it fails when the window is widened 100×.

### Caspar fix: frozen level on audio-less layers (29.10, Opus)

**Investigation.** Live `INFO 2` before the fix: `mixer/audio/layer/audio/layer_10` and `layer_13` both reported
268369920 (−18.1 dBFS) on every read, while the channel bus showed 313344 (−76.7 dBFS). Layer 10 was `INTRO_HAP.mov`,
which has a video stream only (`streams_0` fps 25, no audio stream). Cause, in `src/core/mixer/audio/audio_mixer.cpp`
`mix()`: a producer with no audio still queues an item whose sample buffer is empty (`visit()` only skips a null
`audio_data()`). With `item_size == 0` the upstream "hold the last sample value" branch computes
`offset = channel_pos` and reads `ptr[channel_pos]`, out of bounds of an empty buffer. Every frame read the same stale
memory, so the layer's meter showed a constant level. It went into the channel mix too; two such layers can cancel there,
which is why the bus stayed low.

**What was done.** Two guards in the same loop (`caspar/patches/wo800-per-layer-audio-meters.patch` regenerated from the
worktree; the rest of the patch is unchanged):
- An item with `item_size == 0` contributes 0.0 instead of the out-of-bounds hold. This also fixes the channel mix.
- A layer gets a meter buffer only when the item has samples (`item_size > 0 || last_size > 0`). A layer with no audio
  therefore drops out of the state, and so out of `/api/osc/audio-layers`, and its lane hides.

Build `~/caspar-build/build-26.sh` rc=0 → `bin/casparcg` md5 bbe75049. Rollback is `bin/casparcg.pre-wo800-mixfix`
(edd5c8e7, the NotchLC build it replaced; the only source change since that build is a comment rewording in
`av_util.cpp`). The swap used AMCP `RESTART`, then a node restart.

**Verified (box).**
- `INFO 2` after the swap, with the same Intro look (L10 INTRO_HAP, L11 PK BACK TRACK, L12 PK CLICK): no `layer_10` meter
  at all. L11 matches the bus on every sample (−47.7/−47.5 = bus −47.7/−47.5, −73.4 = −73.4, …), and L12 stays at
  −121 between clicks.
- After a take to PGM 1: the same on `INFO 1` over 6 samples. L11 equals the bus throughout (−53.9 → −98.7 → −39.4 dB);
  there is no L10 entry.
- Godot Audio tab on the glass (`scratchpad/mixfix/strips3.png`, `crop.png`): L10 INTRO has no lane, the L12 lane jumps
  on a click (−10 dB), and the wide bars follow the bus.
