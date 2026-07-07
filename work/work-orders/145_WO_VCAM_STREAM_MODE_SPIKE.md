# WO-145 — Virtual camera stream-mode spike: Caspar STREAM → ffmpeg → /dev/video10

**Status:** Planned
**Priority:** Medium-high
**Date:** 2026-07-07
**Depends on:** WO-141. Parallelizable with WO-144/146/147.
**Related:** WO-137 (single-output vcam, shipped), WO-109 (multi-output — stays deferred).

---

## 1. Problem / history

Current vcam video path is a still-JPEG flipbook: Caspar `ADD <ch> FILE media/highascg_vcam/chN.jpg … -update 1` (consumer 710) → ffmpeg loops that JPEG (`-f image2 -stream_loop -1 -re`) into `/dev/video10` (`src/virtual-output/v4l2-bridge-relay.js`). Frame rate/quality are bounded by the JPEG overwrite cadence — choppy/stale vs real motion.

Why it exists (owner): Caspar cannot consume directly to `/dev/video10` — the consumer path attempts a REMOVE/file-semantics operation that fails on a device node. **Fix candidate keeps Caspar away from the device entirely:** Caspar streams to UDP; a Node-managed ffmpeg decodes UDP into the v4l2 device. The REMOVE-on-device problem disappears.

## 2. Tasks

### Spike + benchmark (decide with numbers, not vibes)
- [ ] T145.1 Prototype: `ADD <ch> STREAM udp://127.0.0.1:<port> -format mpegts -codec:v mjpeg` (also try `h264` with ultrafast/zerolatency) → ffmpeg `-i udp://127.0.0.1:<port> -f v4l2 -pix_fmt yuv420p /dev/video10`.
- [ ] T145.2 Benchmark vs current JPEG relay: end-to-end latency (film a running clock on PGM vs `ffplay /dev/video10`), CPU (Caspar process + ffmpeg), frame smoothness. Record a table in this WO.
- [ ] T145.3 Decision gate: if stream mode wins on smoothness at acceptable latency/CPU, proceed; if not, document why and close this WO with the JPEG path hardened instead.

### Implementation (if spike passes)
- [ ] T145.4 Add `virtualCamera.mode: 'stream' | 'jpeg'` to `src/virtual-output/v4l2-bridge-config.js` (+ validation). JPEG relay remains the fallback mode.
- [ ] T145.5 Swap only the video source in `v4l2-bridge-relay.js` / `v4l2-bridge-consumer.js`; reuse lifecycle (`src/bootstrap/v4l2-bridge-lifecycle.js`) and audio path (snd-aloop, consumer 711) unchanged.
- [ ] T145.6 Update WO-137 with mode decision + benchmark numbers. WO-109 multi-output scope unchanged (deferred).

## 3. Acceptance criteria

- [ ] A145.1 Benchmark table (latency ms / CPU % / subjective smoothness for jpeg vs mjpeg-stream vs h264-stream) recorded here and in WO-137.
- [ ] A145.2 Smoke for start/stop/mode-switch green; relay crash auto-detaches Caspar consumers in both modes.
- [ ] A145.3 `ffplay /dev/video10` shows smooth motion in the chosen mode.
- [ ] A145.4 Validated in a real Zoom call or browser getUserMedia page (the original WO-137 acceptance).

## 4. Work log

- 2026-07-07 — WO created. Owner confirmed the direct-to-device REMOVE failure that motivated the JPEG relay; UDP indirection is the candidate fix.
