# src/capture — sweep 29.10.2026 (batch 071)

Files: 8 · lines: 1351 · findings: 0 BUG-HIGH, 3 BUG, 1 DEAD, 2 RISK, 5 QUALITY

## src/capture/browser-capture-args.js
- `BUG` src/capture/browser-capture-args.js:71-72 — `w`/`h` are clamped to `>= 2` but not rounded to even, and the stream is encoded with `libx264 -pix_fmt yuv420p` (:94-100). The browser source size comes from src/api/host-live-browser.js:47-48 (`Math.max(160, parseInt(width))`, no parity check) and from the operator rect at :157. Failing case: a browser_display source with width 1281 (or any odd width/height) makes ffmpeg exit immediately; verified on the box: `ffmpeg -f lavfi -i color=s=1281x721 -c:v libx264 -pix_fmt yuv420p -f null -` fails with `[libx264] width not divisible by 2 (1281x721)`. `ensureBrowserCaptureBridge` then returns false after the warmup with only a "stopped: ffmpeg exited" warning. Fix: round `w`/`h` down to even here (and grab the same size region), or add `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2`.

## src/capture/browser-capture-bridge.js
- `DEAD` src/capture/browser-capture-bridge.js:137 `browserCaptureBridgeStatus()` — unused in production. grep: `grep -rn "browserCaptureBridgeStatus" src client tools godot index.js` → only the definition/export and tools/smoke/smoke-wo258-browser-source.test.js:29,114 (a smoke that asserts the unknown-id shape). No API/WS route exposes bridge state. Either surface it in the browser-source status or drop it.
- `RISK` src/capture/browser-capture-bridge.js:43-47 — same restart race as the other two bridges: `startBrowserCaptureBridge` SIGTERMs the old ffmpeg and spawns the new one without waiting for `close`; the T258.4 grab-follows-window swap does this on every move. For x11grab it is harmless (non-exclusive), noted for consistency with src/audio/live-audio-bridge.js and v4l2-input-bridge.js.
- `QUALITY` src/capture/browser-capture-bridge.js:28-30,40-75 — `ffmpegBinary` and the spawn/stderr-sniff/close scaffolding are copied from the other two bridges (see src/audio/live-audio-bridge.js).

## src/capture/browser-source-region.js
- `BUG` src/capture/browser-source-region.js:66-71 — a "dead zone below monitor m" candidate is built from `m` alone and never tested against the other monitors, so for monitors stacked vertically it returns a rectangle that lies on the second monitor. Verified by running the function: `computeDeadZoneRegion({width:1920,height:2160}, [{x:0,y:0,w:1920,h:1080},{x:0,y:1080,w:1920,h:1080}], 1280, 720)` returns `{x:0,y:1080,w:1280,h:720}`, i.e. on top of monitor 2. The browser window that is meant to be invisible would be parked on a visible output (on air if that output is a program screen), and its x11grab would capture it. The header says "no gap -> null", which is only true for side-by-side layouts. Fix: reject candidates that intersect any monitor rectangle (also for the offset/partially-overlapping side-by-side cases).

## src/capture/v4l2-enumerate.js
- `BUG` src/capture/v4l2-enumerate.js:92-98 — the fps list of each size is read from `chunk.slice(sm.index, sm.index + 400)`, a fixed 400-character window, so it runs into the following `Size:` blocks. Verified with `parseListFormatsExt` on a typical `--list-formats-ext` text (YUYV 1920x1080 @5 fps only, 1280x720 @10 fps, 640x480 @30 fps): result was `1920x1080 fps:[5,10,30]`, `1280x720 fps:[10,30]`. The picker therefore offers frame rates the mode does not support (for example 30 fps at 1920x1080 on a USB 2 camera), and a chosen combination fails in ffmpeg. Fix: bound the window to the text up to the next `Size:` line.
- `QUALITY` src/capture/v4l2-enumerate.js:118-120 — empty `if` body ("metadata-only node…") and `void opts` at :166 (the documented `refresh` option is ignored); both are leftovers.

## src/capture/v4l2-input-bridge.js
- `RISK` src/capture/v4l2-input-bridge.js:138-154 — restart is SIGTERM then immediate respawn on the same `/dev/videoN`. V4L2 capture nodes allow only one streaming client, so the new ffmpeg can fail with "Device or resource busy" while the old one releases; `restartV4l2InputBridge` returns false after 700 ms and `playV4l2ClipWithRecovery` reports the slot as failed. Wait for the old `close` (with a SIGKILL fallback) before spawning.
- `QUALITY` src/capture/v4l2-input-bridge.js:13-14,33-35 vs src/capture/v4l2-input-config.js:115-123 — `V4L2_INPUT_BRIDGE_UDP_PORT_BASE` and `v4l2InputBridgeUdpPort` are defined twice (both 52400 today). Import one from the other.

## src/capture/v4l2-input-config-validate.js
- `OK`

## src/capture/v4l2-input-config.js
- `QUALITY` src/capture/v4l2-input-config.js:15-17,141-143 — both branches of each `if` return the same value (`normalizeV4l2DevicePath` returns `s` either way; `buildV4l2DirectPlayUri` returns `v4l2://${dev}` either way). The `startsWith('/dev/')` / `startsWith('/')` checks do nothing. `resolveV4l2HostLayer(_slot)` is documented with `cfg` and `slot` params it does not have.

## src/capture/v4l2-input-health.js
- `QUALITY` src/capture/v4l2-input-health.js:10-23,61-63 — `infoHasFfmpegProducer`, `infoForegroundBlock` and `sleep` are verbatim copies of src/audio/live-audio-health.js:10-23,65-67.
