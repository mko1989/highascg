# WO-1046 — Audio meters read far too hot: 16-bit scaling of Caspar's int32 peaks + frozen layer levels

**Area:** audio, caspar-build
**Status: DONE (12.11 — on the box: node scaling + Caspar 8a2e29372 deployed; quiet peaks read true, frozen layer meters gone, PGM restored, feed 21 Hz; smoke 6/6)**

Owner, 12.11 (after WO-1045): *"check if the levels of audio are adequate. they seem pretty huge."*

## Investigation

Raw values sniffed from the full OSC copy on UDP :6250 (`/channel/N/mixer/audio[/layer/L]/volume`, 16 ints):

| channel / layer | raw | true dBFS (÷2³¹) | shown before |
|---|---|---|---|
| ch 8 L10, R | 19698 | −100.8 | **−4.4** |
| ch 7 L3, c13 | 5888 | −111.2 | **−14.9** |
| ch 7 L3, c1 | 115536 | −85.4 | −85.4 |
| ch 2 L111 | 1640497152 (identical for 2 s) | −2.3 | −2.3, frozen |

Two separate bugs:

1. **Node scaling (`src/osc/osc-state-audio.js` `intMeterSampleToDbfs`).** Our Caspar build sends the peak |sample|
   of each frame as **int32** (`~/caspar-build/src-v2/src/core/mixer/audio/audio_mixer.cpp:276-302`; Caspar's audio
   is int32, and the clipping check compares against `INT32_MAX`). The converter guessed formats: any value
   1…65535 was divided by **32767**, as if 16-bit. Every peak below about −90 dBFS (dither, noise floor, a quiet input
   channel) was therefore drawn up to 90 dB too loud, and the meters sat near the top on near-silence. A guessed
   "millibel" branch for negative values also turned `abs(INT32_MIN)` (Caspar's overflow on a negative full-scale
   sample) into −120, so that kind of clip showed as silence.
2. **Caspar frozen layer meters (`src-v2/src/core/mixer/mixer.cpp:85`).** The line was
   `state_["audio"] = audio_mixer_.state()` on a member `state_`. `monitor::state_proxy::operator=(const state&)`
   (`core/monitor/monitor.h:87`) **inserts** keys under the prefix and never removes any. WO-800 rebuilds the
   audio-mixer state each frame so that a layer without audio drops out, but the mixer-level merge kept every
   `audio/layer/<L>/volume` key ever written, holding its last value. Live: ch 2 played only 2-110 [shm] (channel
   volume all 0), yet layers 10, 111 and 112 kept sending −9.9 / −2.3 / −83 dBFS, identical in every packet. ch 3's
   layers 10 and 12, and the route on 1-11, did the same. So strips showed loud, unmoving levels for layers that
   were silent or gone.

The channel bus meters (`…/mixer/audio/volume`) were rebuilt correctly, so bug 2 only affects layer strips. Bug 1
affects every meter.

## What was done

- `src/osc/osc-state-audio.js`: `intMeterSampleToDbfs` now has one rule, `20·log10(n / (2³¹−1))`, with a floor of
  −120. 0 means silence. `n ≤ −(2³¹−1)` (the abs overflow) is 0 dBFS. Any other negative value is −120, since Caspar
  cannot produce it. The function is exported for tests.
- `~/caspar-build/src-v2/src/core/mixer/mixer.cpp`: the mixer builds a fresh `monitor::state` each frame
  (`state["audio"] = …; state_ = std::move(state)`), so a layer that stops contributing audio leaves the OSC state on
  the next frame.

## What was verified

- `tools/smoke/smoke-wo800-per-layer-audio.test.js`, plus 2 tests: quiet peaks (19698 → −100.75, 65535 → −90.31, no
  jump at the old 16-bit boundary), full scale 0, half scale −6.02, 0 → −120, INT32_MIN → 0. The file passes 6/6;
  the OSC smokes (stale-audio, WO-830a parsers, WO-715 bundle-once) pass 24/24.
- On the box, after a node restart, `/api/osc/audio-layers` shows ch 8 L10 R at −93.1 (was drawn about −4) and ch 7 L3
  at −85.4. Layers still frozen hot (1-11, 2-10, 2-111, 3-10, 3-12) are bug 2, waiting for the Caspar deploy.
- Caspar `8a2e29372` (`src-v2` `highascg-main`, built with `build-26.sh`; VERSION `2.5.1 8a2e29372`). Deployed 12.11
  23:10 with the owner's OK. The old binary is kept as `bin/casparcg.pre-wo1046` (5c3373ec5). After
  `systemctl restart casparcg-server` and a node restart:
  - `/api/osc/audio-layers` lists only layers that are playing: 5-1, 6-2, 7-3 and 8-10 (−19.3 / −93.4). The frozen
    1-11, 2-10, 2-111, 2-112, 3-10 and 3-12 entries are gone.
  - PGM ch 2 came back on the same look (e9772b27, `shm://visuals`), restored by node.
  - The WS meter feed runs at 21.4 Hz, gap max 55 ms.
  - The new binary's log shows only startup noise: DeckLink 3 `EnableVideoInput` failed once while the old process
    still held the card (ch 7 plays since), and the http_request error the old binary also logged.
- Not done: the WO-1022 publish (fork push, tag `highascg-8a2e29372`, `publish-caspar-build.sh`). Until then, server
  releases still carry 5c3373ec5, which has the frozen-meter bug; the node scaling fix ships with the next release.
