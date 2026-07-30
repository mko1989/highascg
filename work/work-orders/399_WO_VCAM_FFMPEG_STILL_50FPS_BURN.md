# WO-399 — Virtual-camera JPEG relay burns ~39 % CPU re-decoding one JPEG at 50 fps

**Status: OPEN (found during WO-397's process recon; steady load, NOT the periodic mouse lag)**
**Source:** WO-397 §1.6 background findings (owner 30.07: "make work orders for fixing the other 2 issues").

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

## 2. Proposed fix

Lower the jpg-mode publish rate: default `fps` for the **jpg branch only** from 50 to ~10
(stream mode untouched). v4l2loopback readers receive frames as written — a static/slowly
refreshing image at 10 fps is visually identical and cuts the decode work ~80 %. Config
override stays for boxes that need more.

Verify on the box: CPU of the relay process before/after (`pidstat`), and the /dev/video10
consumer still shows the preview (Caspar v4l2 producer keeps rendering; check for reader
timeout logic anywhere in the pipeline before shipping). If 10 fps upsets a consumer,
fall back to 25.

Stretch (optional): skip re-encode entirely when the JPEG mtime is unchanged (a tiny rawvideo
writer that repeats the last frame), but only if the fps cut alone proves insufficient.

## 3. What was VERIFIED

- (nothing yet — fix not applied)
