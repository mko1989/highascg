# WO-399 — Virtual camera: stream mode is the design now (owner) — jpg flipbook retired to legacy opt-in

**Status: DONE (2026-07-30 — stream/25 fps live on the box, 25 fps verified on /dev/video10, suite 1750/0/2; honest cost accounting in §3 — total CPU is a wash vs jpg mode, the WIN is real motion + flat cost + knobs)**
**Source:** WO-397 §1.6 background findings; owner 30.07: "the virtual cam the way its done is not good. we need to package the virtual cam output to a simple lowest performance hungry stream and an ffmpeg subprocess that recives the stream and pipes it into v4l2."
**Related:** WO-137 (jpg flipbook origin), WO-145 (stream-mode spike — mjpeg/NUT chosen, shipped opt-in; its benchmark is why the default stayed jpeg until now).

---

## 1. Investigation (2026-07-30)

Live process (constant, 21+ min uptime at capture):

```
ffmpeg -hide_banner -loglevel warning -nostdin -f image2 -stream_loop -1 -re -framerate 50 \
  -i /home/casparcg/highascg/media/highascg_vcam/ch4.jpg \
  -vf format=yuv420p,scale=1920:1080 -pix_fmt yuv420p -an -f v4l2 -video_size 1920x1080 /dev/video10
```

**39 % of a core, continuously**, decoding + scaling the SAME JPEG 50 times a second. Spawned
by `src/virtual-output/v4l2-bridge-relay.js:77` (jpg mode of `buildV4l2BridgeRelayArgs`; fps
comes from the bridge config, currently 50). The JPEG is the compose-preview still, which
itself refreshes far below 50 Hz — every re-decode beyond the JPEG's own refresh rate
produces a byte-identical frame.

The WO-397 correlation sampler also caught it contributing periodic 210 ms CPU windows
(`vcam-ffmpeg: 21` jiffies), stacking on top of the Caspar/X load.

Related memory/context: shader-audio routing runs DM3 via slot 1 with a tee to udp:52221 —
the v4l2 bridge is part of that virtual-input plumbing; whatever consumes /dev/video10
(Caspar v4l2 producer or external apps) must keep getting frames.

## 2. What was done (owner architecture decision superseded the original fps-only proposal)

The owner's target architecture — Caspar → cheap stream → ffmpeg subprocess → v4l2 — already
existed as WO-145's opt-in `mode: 'stream'` (Caspar STREAM consumer → mjpeg-over-NUT on
loopback UDP :5555 → node-managed ffmpeg → /dev/video10). This WO makes it the design:

- **Codec benchmark first** (offline, testsrc2 sender `-re`, jiffies-delta over 8 s):
  | variant | sender (≈Caspar encode) | receiver (relay) |
  |---|---|---|
  | mjpeg 1080p50 q10 | 44 % | 34 % |
  | **mjpeg 1080p25 q10** | **24 %** | **17 %** |
  | mjpeg 720p25 | 12 % | 15 % |
  | rawvideo 1080p50 | 50 % | 40 % |
  Rawvideo is NOT cheaper (155 MB/s memcpy + UDP packet churn); **fps is the dominant knob**;
  mjpeg stays (intra-only robustness + ~1 s attach, per WO-145).
- `v4l2-bridge-args.js`: `normalizeV4l2BridgeMode` defaults to **'stream'**; `'jpeg'` is an
  explicit legacy opt-in only.
- `v4l2-bridge-config.js`: defaults `mode: 'stream'`, `fps: 25` (was 50).
- Box config flipped via `POST /api/virtual-camera/config {mode:'stream', fps:25}` + stop/start
  cycle (config POST alone does NOT restart the relay — the old jpg relay kept running until
  the explicit cycle; noted for the inspector UX).
- `smoke-vcam-stream-mode.test.js` repointed: default-mode assertions now expect 'stream'.

## 3. What was VERIFIED (live box, 2026-07-30 ~16:00 UTC)

- Relay process now `ffmpeg -i udp://127.0.0.1:5555 … /dev/video10`; **21 jiffies/s (~21 % of a
  core, flat)** vs the jpg relay's ~39 % with real content.
- `/dev/video10` delivers **exactly 25 fps** (ffmpeg read 125 frames in 5 s) at 1920×1080.
- CasparCG cost isolated by stop/measure/start: no vcam 297 j/s → stream 389 j/s (**+92 %/core**
  for the mjpeg 1080p25 encode; WO-145 measured ~+190 % at 50 fps — the fps knob halved it).
  Legacy jpg mode measured the same way: **+76 %/core** Caspar-side.
- **Honest accounting:** total (Caspar + relay) is ~115 % either way — stream at 25 fps is NOT
  cheaper overall than the flipbook, because Caspar's STREAM encode costs more than its FILE
  consumer. What the owner gains: real motion instead of a still flipbook, a flat relay cost
  (the jpg relay's cost swung 0–39 % with content), no 50 Hz JPEG rewrites on disk, and cheap
  knobs to go lower (`fps: 15` or `resolutionScale: '75'|'half'` — 720p25 benches at
  ~12/15 %). If "lowest hungry" should beat the old total, drop fps/scale in the inspector.
- Suite **1750 pass / 0 fail / 2 skip**. Owner QA: point a /dev/video10 consumer (Zoom /
  getUserMedia — A145.4) at the camera and confirm motion.

## 4. Follow-up (same day, owner: "it still says in the ui its jpeg buffer")

`device-view-inspector-virtual-cam.js` hardcoded "Caspar channel → JPEG buffer → v4l2loopback"
in its note and never showed the mode. Now: the note is mode-aware (stream wording by default,
LEGACY wording only when explicitly opted into jpeg), the status block gains a live
`Pipeline: mjpeg stream → ffmpeg (udp://…)` line fed by `/api/virtual-camera/status`
`video.relay.mode/source`, and the display fps fallback matches the new 25 default. Client
rebuilt + kiosk reloaded; suite 1757/0/2.
