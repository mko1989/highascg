# WO-145 — Virtual camera stream-mode spike: Caspar STREAM → ffmpeg → /dev/video10

**Status:** Implemented (spike passed; `mode: 'stream'` shipped opt-in, default stays `'jpeg'`; A145.4 Zoom/getUserMedia validation open for owner)
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
- [x] T145.1 Prototype: `ADD <ch> STREAM udp://127.0.0.1:<port> …` → ffmpeg `-i udp://… -f v4l2 -pix_fmt yuv420p /dev/video10`. Done live 2026-07-08 on ch 2 / consumer 720 (see §5 for the three consumer-arg gotchas found).
- [x] T145.2 Benchmark recorded below (§4a). Latency measured as ADD→first frame written by relay (`-progress`); jpeg-relay row reasoned from code, not run.
- [x] T145.3 Decision: **stream mode wins** — implemented as `mode: 'stream'` using **mjpeg over NUT** (~1.0 s attach, steady 50 fps, intra-only robustness). h264/mpegts also works but attaches in ~5.8 s (probe/GOP delay); kept as a documented alternative, not wired.

### Implementation (if spike passes)
- [x] T145.4 `virtualCamera.mode: 'jpeg' | 'stream'` (+ `streamPort`, default 5555) in `v4l2-bridge-config.js`; invalid mode / out-of-range port rejected in `v4l2-bridge-config-validate.js`. Default stays `'jpeg'` — behavior unchanged unless opted in.
- [x] T145.5 Video source branched only: `v4l2-bridge-consumer.js` (ADD FILE vs ADD STREAM udp, slot 710), `v4l2-bridge-relay.js` (`buildV4l2BridgeRelayArgs` — loop JPEG vs read udp), `v4l2-bridge.js` start order (stream: relay listens **before** ADD). Lifecycle (`src/bootstrap/v4l2-bridge-lifecycle.js`) and audio (snd-aloop, consumer 711) untouched.
- [x] T145.6 WO-137 updated with mode decision + benchmark table. WO-109 multi-output scope unchanged (deferred).

## 3. Acceptance criteria

- [x] A145.1 Benchmark table recorded here (§4a) and in WO-137 work log.
- [x] A145.2 Smoke green (`tools/smoke/smoke-vcam-stream-mode.test.js`): jpeg → ADD FILE lines, stream → ADD STREAM udp lines, relay args differ per mode, invalid mode rejected; attach/detach in both modes. Relay-crash auto-detach uses the same shared `wireRelayExitHandler` + post-start relay check in both modes (code path unchanged; stream relay additionally exits after 5 s without packets via `?timeout=`, which triggers the same detach).
- [x] A145.3 Chosen mode verified live: 100 consecutive frames captured from `/dev/video10` at steady `fps=50` (ffmpeg capture; ffplay-equivalent evidence, box is headless-driven).
- [ ] A145.4 Validated in a real Zoom call or browser getUserMedia page (the original WO-137 acceptance). **Stays open for the owner.**

## 4. Work log

- 2026-07-07 — WO created. Owner confirmed the direct-to-device REMOVE failure that motivated the JPEG relay; UDP indirection is the candidate fix.
- 2026-07-08 — Agent (Claude). Live spike on the playout box (ch 2 preview only, consumer 720, every ADD REMOVEd, box left clean — no stray ffmpeg, `/dev/video10` free). Raw results:
  - mjpeg/NUT: `RESULT mjpeg add_to_first_frame_ms=1025`, capture `frame= 100 fps= 50`, relay ffmpeg 93–120 % CPU, casparcg 421–426 % (idle baseline ~230–236 %).
  - h264/mpegts: `RESULT h264 add_to_first_frame_ms=5764`, capture `frame= 100 fps= 51`, relay ffmpeg 42–50 % CPU, casparcg 410–417 %.
  - Implemented `mode: 'stream'` (mjpeg/NUT) behind default-`'jpeg'` config; smoke added; `node --check`, eslint, `node --test` all green. Existing `smoke-virtual-camera.test.js` still green.
  - **Instructions for next agent / owner:** flip `virtualCamera.mode` to `"stream"` via `POST /api/virtual-camera/config`, Start, then run A145.4 (Zoom / getUserMedia). If localhost UDP loss ever shows as JPEG decode warnings in the relay log, lower `jpegQuality` (bitrate) or switch the relay/consumer pair to h264 (args documented in §5).

### 4a. Benchmark (2026-07-08, live box, ch 2 @ 1080p50-class channel, 28-core host; CPU is top(1) %single-core; casparcg idle baseline ≈ 230–236 %)

| Path | casparcg CPU (Δ vs idle) | relay ffmpeg CPU | achieved fps (100-frame capture) | ADD → first frame | notes |
|---|---|---|---|---|---|
| (a) jpeg relay — current, **reasoned from code, not run** | comparable mjpeg encode in FILE consumer (same filter chain + `-update 1` disk writes) | ~1 core (image2 loop `-re` decode) | nominal 50 fps into v4l2, but motion cadence bounded by JPEG overwrite/read race — repeated/stale frames, tear risk on non-atomic overwrite | up to ~8 s (waits for first JPEG on disk) | the choppy/stale problem this WO fixes |
| (b) mjpeg stream (NUT over udp://127.0.0.1:5555) | 421–426 % (**≈ +190 %**) | 93–120 % | **50 fps steady** | **1.0 s** (1025 ms) | winner: fastest attach, intra-only (no GOP/PPS fragility) |
| (c) h264 stream (mpegts, libx264 ultrafast+zerolatency, g=50) | 410–417 % (≈ +180 %) | 42–50 % | 50–51 fps | 5.8 s (5764 ms) | attach dominated by demux probe/GOP; could shrink with `-probesize`/`-fflags nobuffer` on the relay; cheapest relay CPU |

## 5. Consumer-arg gotchas found live (why the naive prototype failed twice)

1. **Audio is mandatory in the mux** — Caspar's ffmpeg consumer always creates an audio stream; mpegts/NUT default `mp2` encoder rejects Caspar's 16-ch `hexadecagonal` layout and kills the whole consumer (`ADD` still answers `202 OK`; consumer just dies). Fix: `-filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k`. The relay drops it (`-an`); virtual-mic audio stays on snd-aloop (711).
2. **mjpeg cannot ride mpegts** — muxed as a private data stream ("may not be recognized upon reading"); the relay sees no video stream. Fix: `-format nut`.
3. **Only `-name:stream` options are forwarded** — bare `-vcodec`, `-preset`, `-tune` are silently dropped; use `-codec:v`, `-preset:v`, `-tune:v` (matches `src/streaming/caspar-ffmpeg-setup.js`). Also send to `udp://…?localport=<port+10000>` so Caspar's send socket doesn't collide with the relay's listener.
