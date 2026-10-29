# WO-800 — Per-layer audio monitoring (levels per layer, not per channel)

**Status: OPEN (29.10) — decision needed from the owner before build (option A vs B below)**

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

## Owner decision needed

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
