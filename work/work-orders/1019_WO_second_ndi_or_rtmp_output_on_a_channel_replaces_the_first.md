# WO-1019 — A second NDI sender (or RTMP/ffmpeg output) on one channel silently replaces the first
**Area:** devices-config, video-io
**Status: OPEN (09.11)**

Found by the WO-1016 audit (agent F, 09.11) and confirmed in the Caspar source by the lead. Nobody has seen it live
yet: no channel on the box has two NDI outputs right now.

## Investigation

- **Caspar.** Outputs from `casparcg.config` are added at their type's fixed index: `shell/server.cpp:366` calls
  `output().add(consumer)`, and `core/consumer/output.cpp:74` passes `consumer->index()`. Adding at an index that is
  already taken replaces that output (`output.cpp:64-72`). The fixed indices:
  - NDI is always **900** (`modules/newtek/consumer/newtek_ndi_consumer.cpp:313`);
  - ffmpeg is **100000 + channel** (`modules/ffmpeg/consumer/ffmpeg_consumer.cpp:829`);
  - for comparison, DeckLink is 300 + device and screen is 600 + screen index, which are unique per device.
- **HighAsCG.** `src/config/config-generator-consumer-attach-screen.js:162-183` writes the per-screen `<ndi>` block plus
  one `<ndi>` per cabled NDI stream output on the same program channel. So with both set, only the LAST sender survives.
  More than one RTMP `<ffmpeg>` block per channel (`buildRtmpFfmpegConsumersForChannel`) collides the same way.

## What was done

(open) The options are:
1. Add the extra outputs over AMCP after connect, at distinct indices (`ADD <ch>-<idx> NDI NAME …`), the way the meter
   and shm outputs are added (WO-1016 lists the indices HighAsCG already uses: 701, 710, 711, 720, 730, 740).
2. Patch Caspar so a config `<consumer>` can carry an index (the WO-1016 `ADD ch-idx XML` patch family).

## What was verified

(open) Reproduce first: two NDI outputs on one program channel, then `INFO <ch>` and an NDI receiver.
