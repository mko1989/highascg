# WO-898 — Audio-only channels: tiny custom video mode at the rate of the channel they feed

**Area:** audio, devices-config
**Status: DONE (31.10.26, live on the box: ch 7 64x36@50, PGM audio clean; offline 25/29.97/59.94)**

## Owner request (31.10, verbatim)

> the audio only channel was supposed to be the most cheap possible, meaning probably pal or ntsc depending on the
> framerate of the project. unless there is a cheaper one. we could possibly create a video mode of 1x1.

Follow-up of WO-237 (which made only the *monitor* bus cheap) and WO-53 (one dedicated channel per live input,
"ALSA = cheap mode" — never true on a saved config, see below).

## Investigation

### What the box runs

`config/casparcg.config` (generated) — channel 7 is the live ALSA input (`Devices: Live audio input 1 · HOST · ch 7`):

```
<!-- HighAsCG: Caspar channel 7: Live audio input 1 (ALSA PLAY … alsa:// on layer 10; cheap channel, isolated VU) -->
<channel>
    <video-mode>1080p5000</video-mode>
```

`INFO` → `7 1080p5000 PLAYING`. The comment says "cheap channel"; the mode is a full HD raster. `INFO 7` shows the
channel carries the HighAsCG meter-null consumer (`port_720`, `udp://127.0.0.1:52007`) and plays
`udp://127.0.0.1:52201` on layer 10 — the capture tee (`ffmpeg -f alsa -i hw:3,0 … -f lavfi -i color=…320x240:r=25`).

### Root cause: the "cheap mode" default never survives a save

- `src/config/config-modes.js:311-324` `resolveLiveAudioInputChannelMode()` — empty setting → cheapest standard mode
  (PAL); ANY standard id in `live_audio_inputs_channel_mode` / `live_audio_input_channel_mode` wins.
- `src/config/defaults-caspar-server.js:96` — the factory default of `live_audio_inputs_channel_mode` is
  `'1080p5000'` (a leftover of the pre-WO-53 shared inputs host, which also hosted DeckLink inputs).
- Both clients round-trip that key with a hardcoded `'1080p5000'` fallback and write it into BOTH keys:
  `client/lib/live-audio-inputs.js:180,204-205`, `godot/client/features/devices/input_slots_model.gd:62,81`.
  Neither client has a picker for it (the web reader `str('#live-audio-host-mode', …)` at
  `client/components/settings-live-audio-panel.js:86` targets an element that no longer exists; Godot has no node).
  So the value is never an operator choice — it is a phantom default that every Devices save re-writes.
- `src/config/routing-map.js:255,285` puts that mode on the `live_audio` input entry; the generator emits it
  (`src/config/config-generator-consumer-attach-misc-channels.js:137`). Result on the box (`config/caspar_server.json:158`):
  `"live_audio_inputs_channel_mode": "1080p5000"` → ch 7 at 1080p50.

The "empty → PAL" fallback would have been wrong anyway: `route://` between channels of different rates chops the
audio (WO-237 follow-up, `getLowestStandardVideoModeIdForFps` doc at `config-modes.js:275-285`). The live input's
audio goes to the PGM buses (`src/engine/live-input-route-reassert.js:120-124`: `PLAY <pgm>-<layer> route://7` +
`MIXER … OPACITY 0`), so a 25 fps PAL channel feeding a 50 fps PGM would drop/duplicate every other frame's audio.
The owner's "PAL or NTSC depending on the project rate" therefore only holds for 25 / 29.97 projects — and even
there both are interlaced (`video_format.cpp:44-54`: PAL/NTSC `field_count 2`, field cadences), which pops the
route queue at field-pair rate (memory note route-fps-mismatch-chops-audio).

### Extra audio-only channels: same waste

`src/config/config-modes.js:244-251` `getExtraAudioModeDimensions()` defaults `extra_audio_N_video_mode` to
`match_screen1` = the full PGM raster (3840x1792@50 on this box). Rate-matched, but a full-raster channel whose
only output is an ffmpeg audio consumer. No UI writes `extra_audio_N_video_mode` (grep: only `config-modes.js` and
`config-compare.js:118` read it). Not in use on this box (`extra_audio_count` absent).

### What an audio channel's raster actually costs

The raster is composited and read back every tick for any channel with a consumer
(`src/audio/meter-null-consumer.js:67-71`: "costs a full frame fetch per tick"). Every channel carries the
meter-null consumer, so ch 7 downloads 1920x1080x4 = 8.3 MB × 50/s = 415 MB/s of black from the GPU for a channel
nobody looks at. A 64x36 raster is 9.2 KB/frame (~0.1 % of that).

### Caspar: are tiny custom modes legal? (source: `~/caspar-build/src-v2`, the build-26 tree)

- `src/shell/server.cpp:193-197` — width/height only need to be non-zero. No alignment or minimum.
- `server.cpp:229-241` — cadence must satisfy `sum(cadence) * time-scale == 48000 * duration * len(cadence)`;
  an empty cadence is computed as `round(48000 / fps)` (integer rates only).
- Fractional rates need the 1001 rational and a cadence list. Caspar's own lists (`core/video_format.cpp`):
  23.976 = 24000/1001 `{2002}`, 29.97 = 30000/1001 `{1602,1601,1602,1601,1602}`,
  59.94 = 60000/1001 `{801,800,801,801,801}`.
- **Latent bug found on the way:** `src/config/config-generator-custom-modes.js:19-20` emits every custom mode as
  `time-scale = round(fps*1000)`, `duration 1000`, `cadence round(48000/fps)`. For 59.94 that is 59940/1000 with
  cadence 801 → 801×59940 = 48 011 940 ≠ 48 000 000 → Caspar throws "Incorrect cadence in video-mode" and refuses
  to start. Any custom (non-standard) screen at 23.98/29.97/59.94 was unbootable; a tiny mode at those rates needs
  the fix too.
- ffmpeg producer does not scale to the channel size (only `util/av_util.cpp:304-309` / the consumer touch
  `format_desc.width`); the image mixer just creates a `width × height` target (`image_mixer.cpp:106`).

### Isolated test on the box (second Caspar instance, AMCP :5251, scratch config — live ch untouched)

Channels: 1 = `1x1`@50, 2 = `64x36`@50, 3 = `64x36`@25, 4 = `64x36`@60000/1001 (cadence list above),
5/6/7 = 1080p5000 sinks, 8 = 1080p5994 sink. A 1013 Hz sine (non-integer cycles per frame, so a dropped or
repeated frame is a phase jump — a 1000 Hz tone hid the control's chop, 20 cycles per 20 ms) was played on 1-4,
`route://` into the sinks with `MIXER OPACITY 0`, and each sink recorded with `ADD n-730 FILE x.wav`.
Caspar accepted every mode (incl. the 59.94 cadence list) with zero `[error]` lines.

| route | 5 ms silent windows | waveform discontinuities (20 s) |
|---|---|---|
| 1x1@50 → 1080p50 | 0 | 0 |
| 64x36@50 → 1080p50 | 0 | 0 |
| 64x36@59.94 → 1080p59.94 | 0 | 0 |
| control: 64x36@25 → 1080p50 | 0 | 870 |
| control: 64x36@50 → 64x36@25 | 272 | 406 |

The probe separates (both rate-mismatched controls chop, every rate-matched tiny route is clean). A JPEG ffmpeg
consumer (`scale=iw/2:ih/2,format=yuvj420p`) and `PRINT` also ran on the 1x1 channel without error.

### 1x1 vs 64x36

1x1 works in Caspar. 64x36 is chosen anyway: the cost difference against either is nil next to 8.3 MB/frame,
but 64x36 is (a) 16:9 — the input's resolution, read back from INFO CONFIG into `channelMap.inputChannels[].resolution`
(`src/config/channel-map-from-ctx.js:80`), drives the fit of live-audio / `route://` layers and multiview cells
(`client/lib/mixer-fill.js:317-321`, `src/engine/multiview-layout-helper.js:202-207`), so geometry stays what it was
at 1920x1080; (b) even in both axes, so a yuv420 recorder/stream someone attaches to the channel still opens
(x264 refuses odd sizes); (c) a `WxH` id, so the existing `WxH` parsers (`pixelSizeForVideoMode`,
`resolutionFromVideoModeString`) read it.

### Who reads the channel's picture

- Live thumbnails: audio-only channels already `no_picture` (`src/media/live-thumbnail-session.js:81`, WO-887).
- Compose preview (ffmpeg_jpeg mode): `collectComposePreviewChannelsFromMap` (`src/preview/compose-preview-mode.js:87-88`)
  adds EVERY input channel, live audio included — a JPEG consumer on a channel with no picture. Not active on the
  box (mode `canvas`) but wasteful when on.
- INFO CONFIG resolution: `resolutionFromVideoModeString` (`src/config/server-info-config.js:13-21`) returns
  fps 50 for any `WxH` id — a 25 fps tiny channel would be labelled 50 p.

## What was done

- **`src/config/audio-only-channel-mode.js` (new).** `videoModeTiming(fps)` → exact Caspar timing: integer rates
  `fps*1000/1000` with cadence `48000/fps`; 23.976 / 29.97 / 59.94 → `N*1000/1001` with Caspar's own cadence lists;
  `null` for a rate with no valid cadence. `audioOnlyModeDimensions(fps)` → plan-shaped dims for `64x36` at that
  rate (fallback 50) carrying the timing.
- **`config-generator-custom-modes.js` `pushCustomMode`** emits `videoModeTiming`'s time-scale / duration / cadence.
  Integer rates byte-identical to before; fractional custom modes are now Caspar-valid (fixes the latent
  unbootable-custom-59.94-screen bug above).
- **`config-generator-channel-plan.js`** computes ONE `plan.audioOnlyDims` from the same rate source the monitor bus
  already used (first screen's fps, else the operator-GUI channel's) — one `64x36` registration per config, so the
  shared id can never be registered at two rates.
- **`config-generator-channels.js`**: `live_audio` input entries register `plan.audioOnlyDims` and emit `64x36`
  (`buildInputChannel` now accepts a custom id only when it is in the registered set — an unregistered id would
  stop Caspar from starting). The monitor bus registers the same dims.
- **`routing-map.js`**: the `live_audio` entry's `mode` (→ channelMap, config-compare, clients) is `64x36`;
  `live_audio_inputs_channel_mode` is no longer consulted for ALSA channels (phantom value, see Investigation;
  it still drives only the legacy empty inputs-host channel, `buildInputsHostChannel`).
- **`config-generator-audio-xml.js` `buildMonitorChannelXml`**: monitor bus → `64x36` (was WO-237's
  `getLowestStandardVideoModeIdForFps`, i.e. 720p50 at 50 fps). Call site and its WO-406 pins unchanged.
- **`config-modes.js` `getExtraAudioModeDimensions`**: default `match_screen1` → tiny mode at screen 1's rate; an
  explicit mode is honoured. `config-compare.js` now uses the same resolver instead of its own copy.
  NB: extra-audio channels are dormant — `mergeAudioRoutingIntoConfig` forces `extra_audio_channel_count = 0`
  (`config-generator-audio-routing.js:108-109`, "removed from Settings UI"); covered at plan level only.
- **`server-info-config.js` `buildChannelResolutionMap`** reads custom-mode rates from INFO CONFIG's `<video-modes>`
  (a 25 fps `64x36` channel reports 25, not the `WxH` default 50; also fixes custom screens' reported rate).
- **`compose-preview-mode.js`**: live ALSA input channels no longer get a compose-preview JPEG consumer.
- Unwired export `getLowestStandardVideoModeId` dropped from `config-modes.js` exports (still used internally).

Why not PAL/NTSC: PAL/NTSC are interlaced (field cadence → route chop) and still 1.6 MB/frame; no standard mode is
cheap at 50/59.94/60. Why not 1x1: see Investigation (works, but no gain and loses 16:9 / even dimensions).

Smokes repointed (contract change, not weakened): `smoke-config-generator-routing.js` WO-53 test (ALSA = `64x36`;
the phantom `1080p5000` must NOT override any more), `smoke-wo237-monitor-channel-cheapest-mode.test.js` (rate now
asserted from the `<video-modes>` registration), `smoke-wo406-monitor-bus.test.js` (builder emits `64x36`; rate
asserted via `audioOnlyModeDimensions`). New: `tools/smoke/smoke-wo898-audio-only-tiny-mode.test.js` (50 / 25 /
29.97 / 59.94 projects, single registration, Caspar cadence rule, monitor share, explicit extra-audio mode,
custom-59.94 screen cadence, INFO CONFIG rate, compose-preview exclusion, source pins).
- `tools/smoke/fixtures/wo868/{off,on}.{caspar.xml,channel-map.json}` re-captured (diff reviewed: only ch 7 / ch 8
  modes → `64x36`, the `64x36`@50 registration, and the live-audio `mode` / `liveAudioInputMode` fields).

## What was VERIFIED (31.10.26)

**Offline.** New smoke 11/11; WO-237 / WO-406 / routing / compose-preview / WO-868 golden smokes green; every smoke
touching live audio / monitor / modes (239 tests) green. Curated suite `node tools/ci/run-offline-tests.js`: run 1
5070 tests, 5062 pass, 3 fail — two WO-868 golden tests (expected, re-captured above) and `smoke-wo846`
"INDEX.md stale" (this new WO); run 2 after the re-capture 5070 tests, 5064 pass, 1 fail (only the stale INDEX —
regenerated with `node tools/wo/build-index.js` by the queue owner). `check-max-file-lines` 0 over 500; `check-unwired-exports` no new orphans.

**Caspar, isolated instance** (second `casparcg` on AMCP :5251 from a scratch config, same binary as live): see the
table in Investigation — tiny modes incl. 1x1 and 64x36@59.94 accepted, rate-matched routes clean, both
rate-mismatched controls chop. Cost A/B, 6 audio-only channels each playing a tone with the meter-null consumer:

| 6 channels at | PCIe tx (box baseline 6060 MB/s) | framebuffer | Caspar CPU |
|---|---|---|---|
| 1080p5000 | 8682 MB/s (+2.6 GB/s ≈ 6 × 415 MB/s readback) | 125 MB | 47.0 % |
| 64x36@50 | 5985 MB/s (+0) | 6 MB | 47.3 % |

So the saving is GPU→host readback bandwidth (~435 MB/s) and ~20 MB VRAM per audio-only channel; CPU is
unchanged (the readback is DMA).

**Live box.** Node restarted (new generator code), `POST /api/caspar-config/apply {skipCasparRestart:true}` wrote
`config/casparcg.config`: diff vs the pre-change copy = ch 7 `1080p5000` → `64x36` + the `64x36`
`50000/1000/960` registration, nothing else. Caspar restarted once (TERM main PID, run.sh relaunched, AMCP up in
15 s). `INFO` → `7 64x36 PLAYING`; `INFO 7` → `<format>64x36</format><framerate>50</framerate>`, meter-null
consumer `port_720` re-attached, capture stream `udp://127.0.0.1:52201` playing on layer 10. Caspar log:
`video_channel[7|64x36] Successfully Initialized.`, no error for channel 7 (the only `[error]` lines are the
pre-existing DeckLink "Failed to enable external keyer" and an ffmpeg udp `bind failed: Address already in use` — both also in
earlier boots of the same log). `/api/state` channelMap: live_audio ch 7 `mode 64x36`, resolution `64x36 @ 50`.

Audio (ALSA `hw:3,0` had real signal, about −20 dBFS RMS): `PLAY 2-190 route://7` + `MIXER 2-190 OPACITY 0` into
PGM 1 (ch 2), recorded ch 7 and ch 2 with `ADD n-731 FILE x.wav` for 15 s, before and after; the probe was calibrated
on a copy of the input with every other 20 ms frame zeroed:

| recording | RMS | silent 5 ms windows | 25 Hz envelope / median |
|---|---|---|---|
| before — ch 7 (1080p50) / PGM ch 2 | −19.9 / −20.0 dBFS | 0 / 0 | 1.0 / 0.9 |
| after — ch 7 (64x36@50) / PGM ch 2 | −21.3 / −21.2 dBFS | 0 / 0 | 1.4 / 1.6 |
| calibration: input with every other frame dropped | −22.9 dBFS | 1500 | 62.9 |

The test route was removed afterwards (`STOP 2-190`, `MIXER 2-190 CLEAR`). The live input is not routed to any
PGM on this box at the moment (no `route://7` layer anywhere before the test).

**Not verified / open:** 25 / 29.97 / 59.94 projects only offline + the isolated instance (the box runs 50).
The monitor bus change is offline-only (no monitor bus on this box). No deterministic sine test on the live input (real
programme audio only; the sine tests ran on the isolated instance). Live CPU before/after is confounded (content
playing before the restart, the restart cleared a persisted live look on ch 2), so the cost claim rests on the
isolated A/B; box GPU memory went 3238 → 2703 MiB across the restart. Side effect of the node restart: the OS watchdog saw DP-6 overlapping DP-4 at 0,0 at boot and
re-applied the xrandr layout (repeated overlap warnings around 13:23, none in the previous 24 h), then settled — unrelated to this change.
