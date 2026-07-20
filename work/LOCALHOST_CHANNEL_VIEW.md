# Displaying a CasparCG channel inside the browser UI — localhost, low latency, low resources

Research document. Requested in `work/work-orders/todos19.07.26`:

> "prepare a new document in which you try to find a way to display low latency and low
> rescources casparcg channel in the webbrowser ui on localhost only."

Status: **research only.** Nothing in this document has been implemented. No Caspar config was
changed, no consumer was added, no service was restarted. Every system claim below is backed by
command output captured on this box on 2026-07-20 and quoted verbatim. Every number that is an
estimate is labelled **(estimate)**.

---

## 0. TL;DR

**Recommendation: hybrid.** Keep the X SHAPE holes as the operator's primary on-glass view. Add a
**single H.264/NVENC stream per channel out of Caspar's existing `STREAM` consumer, over loopback
UDP, remuxed to fragmented MP4 and pushed over WebSocket into Media Source Extensions** in the
browser. Use it (a) for the laptop-on-the-network view the operator also wants, and (b) as the
in-browser fallback that lets the hole machinery become optional rather than load-bearing.

The single most important thing I found:

> **NVENC is effectively free on this box and the current MJPEG preview path is not.**
> Measured, BGRA input, 3072x1728@50p: `h264_nvenc -preset p1 -tune ll` costs **0.005 CPU cores**;
> the current `mjpeg -q:v 10` half-scale path costs **0.95 CPU cores** — nearly a full core, *per
> channel*. That is a ~180x difference, and Caspar links the **system** `libavcodec.so.60`, which
> already has `h264_nvenc`. **No Caspar rebuild is required.**

Second most important thing: **software scaling costs more than the NVENC encode does.** Do not
`-vf scale=iw/2:ih/2` in front of NVENC. Send full resolution and let the browser scale it, or
scale on the GPU.

Third: I verified offline that ffmpeg on this box emits **one fMP4 fragment per frame** with
`-movflags +frag_every_frame+empty_moov+default_base_moof`, at ~2.0 Mbit/s for 1080p50. If Caspar
passes those args through, the MSE path needs **no remuxer** and has no GOP-length latency floor
(§5.2.1).

Smallest experiment that proves or kills it: one AMCP line on an idle channel —
`ADD 7 STREAM udp://127.0.0.1:52200 -codec:v h264_nvenc -preset:v p1 -tune:v ll -format mpegts` —
then `ffplay` it and watch `nvidia-smi -q -d ENCODER_STATS`. If Caspar's `ffmpeg_consumer` accepts
the encoder name and the session appears on the GPU, the whole plan is green. See §9.

---

## 1. The baseline we are measuring against: hole punching

Today the operator GUI **does not display Caspar in the browser at all.** It renders empty tile
bodies and punches X SHAPE holes through the kiosk Firefox window so the Caspar screen consumer
(channel 5) shows through underneath.

From `client/components/operator-compose-tiles.js`:

> "Each tile = body (the reported video rect — literally empty; the Caspar consumer shows through
> a HOLE punched in Firefox at this rect, WO-263)"

The machinery, measured:

```
   432 client/lib/operator-gui-mode.js
   137 client/lib/operator-gui-interaction-suppress.js
   632 tools/runtime/operator-shape-overlay.py
   557 src/system/operator-gui-channel.js
   521 src/system/operator-gui-launcher.js
    43 client/lib/hole-rect.js
  2322 total
```

(The 1,566 LOC figure in the brief undercounts; the full chain including the channel manager and
launcher is ~2,322 LOC.)

### What the baseline is genuinely good at

| Property | Hole punching |
| --- | --- |
| Latency | **Zero.** It is the Caspar screen consumer on the actual GPU scanout. Nothing is copied, encoded, or decoded. Nothing beats this and nothing ever will. |
| CPU | **Zero** beyond the screen consumer Caspar already runs. |
| GPU | One extra screen consumer's worth of compositing, already paid for. |
| Fidelity | Perfect. Full resolution, full colour, no codec artefacts. |

### What it costs

1. **Click-dead holes.** X SHAPE applies to both the bounding and *input* regions, so pointer
   events fall through the hole. Editors have to withdraw their own rect while editing
   (`operator-gui-interaction-suppress.js` exists solely for this).
2. **Title-marker / stacking hack.** `OPERATOR_GUI_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'` — the
   shape helper identifies the right Firefox window *by window title substring*, because X11 does
   not expose the URL. Any other Firefox (the WO-258 browser sources are also Firefox) must be
   excluded by string matching.
3. **~2,322 LOC** of geometry, rect reporting, debouncing, suppression and heartbeat.
4. **Boot-order fragility.** See the todos entry: stale layouts, empty-payload clobbering, a
   ~2s window where holes close during boot. Three separate root causes, all of them consequences
   of "the client owns the geometry and the server owns the video."
5. **Operator's own display only.** A laptop on the network sees an empty grey grid. This is the
   hard ceiling and it is the reason this document exists.

**Any candidate must be judged against "zero latency, zero CPU, perfect fidelity."** No streaming
option will win on those axes. They can only win on *reach*, *simplicity*, and *not being
click-dead*.

---

## 2. What already exists in this codebase

Read before proposing anything.

### 2.1 The JPEG push path — `src/preview/compose-preview-ffmpeg-jpeg.js`

Mechanism, precisely:

1. Node issues `ADD <ch> FILE media/highascg_preview/chN.jpg <args>` over AMCP.
   `compose-preview-consumer.js:21` — `COMPOSE_FILE_CONSUMER_INDEX = 701`.
2. Args from `compose-preview-ffmpeg-args.js:100`:
   ```
   -filter:v scale=iw/2:ih/2,scale=in_range=limited:out_range=full,format=yuvj420p,fps=25
   -codec:v mjpeg -q:v:v 10 -r 25 -format image2 -update 1
   ```
   Caspar's own ffmpeg consumer overwrites one JPEG on disk 25 times a second.
3. Node polls `fs.stat()` on that file every 40 ms (`resolveMtimePollMs`) and broadcasts
   `compose.preview` over WebSocket with an etag and the URL `/api/compose-preview/N.jpg`.
4. Each client fetches that URL over HTTP.

**It is currently OFF.** `config/general.json`:

```json
{ "mode": "canvas", "fps": 25, "resolutionScale": "half", "jpegQuality": 10,
  "maxWidth": 480, "channels": "compose_visible", "companionThumbEnabled": true }
```

`compose-preview-mode.js:20` defaults to `canvas`, and `canvas` mode is the empty-tile /
hole-punch path. So the JPEG encoders are not currently running for the operator tiles — only the
Companion Stream Deck thumb path (`companionThumbEnabled: true`, 1 fps, 144px) is live.

The WO-280 single-flight/backpressure work exists in `compose-preview-backpressure.js` (177 LOC
server, plus a client twin) precisely because this design scales as **clients x channels x fps**
on the *fetch* side, even though the *encode* side is per-channel.

**Important architectural note:** the encode already happens **inside the Caspar process**, using
Caspar's ffmpeg consumer. So "preview CPU" is already competing with playout inside the same
process and the same thread pools. That is the real reason to care about the numbers in §4.

### 2.2 Caspar's `STREAM` consumer already has prior art here

`src/streaming/caspar-ffmpeg-setup.js` builds `ADD n STREAM <url> <args>` for RTMP/YouTube, and
carries a load-bearing warning worth repeating:

> "**Must use `-format mpegts`**, not `-f mpegts`: Caspar's ffmpeg_consumer maps `-name value`
> into an options dict … the muxer format was never set — FFmpeg then errors 'Unable to choose an
> output format'."

> "We use **UDP** to 127.0.0.1:port (not srt://): many Caspar 2.5 builds cannot open srt:// output"

And `compose-preview-consumer.js:25` documents that compose preview **used to** run as a UDP
STREAM consumer:

```js
/** Stale UDP compose preview STREAM consumers (52100 + channel). */
const LEGACY_COMPOSE_UDP_PORT_BASE = 52100
```

So `ADD <ch> STREAM udp://127.0.0.1:PORT ...` has been done here before and there is even legacy
cleanup code for it. This is not a new mechanism, it is a revived one.

The registered consumer names confirmed in the binary (`strings bin/casparcg`):

```
artnet  audio  decklink  file  ndi  portaudio  screen  stream  window
```

### 2.3 The x11grab browser-capture precedent — `src/capture/browser-capture-args.js`

This is the **reverse** direction (browser → Caspar) but the output half is exactly the recipe we
want, already proven on this box:

```
-c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p
-g <fps> -keyint_min <fps> -x264-params min-keyint=N:scenecut=0:repeat-headers=1
-muxdelay 0 -muxpreload 0 -f mpegts udp://127.0.0.1:PORT?pkt_size=1316
```

Note `repeat-headers=1`, `scenecut=0`, `-muxdelay 0` — someone already solved the "join a running
low-latency stream at any point" problem here. Reuse those flags.

### 2.4 The channels

`config/casparcg.config`:

- ch1 — PGM screen 1, **3072x1728@50p**, screen consumer + portaudio. **On air.**
- ch2 — PRV screen 1, 3072x1728@50p, no consumers.
- ch3 — PGM screen 2, 1080p5000, DeckLink device 3. **On air.**
- ch4 — webpage host, 1080p5000, no consumers.
- ch5 — **Operator GUI channel, 1920x1080@50p, screen consumer at x=3072** — this is the one
  showing through the holes.
- ch6 — DeckLink input 4, 1080p5000, no consumers.
- ch7 — live audio input, 1080p5000, no consumers.

Two things follow. First, **channel 5 already exists and is already a composited 1920x1080 mosaic
of everything the operator needs.** If we stream anything, streaming ch5 gives you the entire
operator view for the price of one encoder — that is a big deal and §7 leans on it. Second,
ch2/ch4/ch6/ch7 are idle-ish and give us somewhere to experiment without touching air.

---

## 3. System capability inventory (all measured)

### GPU

```
$ nvidia-smi
NVIDIA-SMI 595.71.05   Driver Version: 595.71.05   CUDA Version: 13.2
GPU 0: NVIDIA RTX PRO 4000 Blackwell   2020MiB / 24467MiB   32% util
Processes:
  2000814  G  .../highascg/bin/casparcg     1308MiB
  2706519  G  /usr/lib/xorg/Xorg             201MiB
  2994745  G  /usr/lib/firefox-esr/firefox-esr  216MiB

$ nvidia-smi -q -d ENCODER_STATS
    Encoder Stats
        Active Sessions   : 0
        Average FPS       : 0
        Average Latency   : 0
```

**Zero NVENC sessions in use.** The entire hardware encoder block is idle while the box does its
job. This is the single largest piece of unexploited headroom on the machine.

Session-count caveat: NVIDIA caps concurrent NVENC sessions on GeForce parts (8 on current
drivers) but **not** on professional/RTX PRO parts. This is an RTX PRO 4000. I did not measure the
cap — treat "unlimited sessions" as vendor-documented, not verified here. For our purposes we need
1–3 sessions, which is under even the GeForce cap.

### CPU

```
$ nproc
28
$ grep -m1 "model name" /proc/cpuinfo
model name : Intel(R) Core(TM) i7-14700KF
```

28 threads (8 P-cores + 12 E-cores). Plenty in aggregate — but playout latency is about
*worst-case scheduling*, not average throughput. A preview encoder that grabs a full core inside
the Caspar process is competing with mixer and consumer threads directly.

### FFmpeg — and the critical linkage finding

```
$ ffmpeg -version
ffmpeg version 6.1.1-3ubuntu5 ... --enable-libx264 --enable-libx265 --enable-libvpx ...

$ ldd bin/casparcg | grep -E 'avcodec|avformat'
libavcodec.so.60 => /lib/x86_64-linux-gnu/libavcodec.so.60
libavformat.so.60 => /lib/x86_64-linux-gnu/libavformat.so.60
```

**CasparCG dynamically links the system libavcodec 60.31.102** — the same build I benchmarked.
Whatever encoders `/usr/bin/ffmpeg` can use, Caspar's `ffmpeg_consumer` can request by name.

```
$ ffmpeg -encoders | grep -iE 'nvenc|vaapi|mjpeg'
 V....D h264_nvenc     NVIDIA NVENC H.264 encoder (codec h264)
 V....D hevc_nvenc     NVIDIA NVENC hevc encoder (codec hevc)
 V....D av1_nvenc      NVIDIA NVENC av1 encoder (codec av1)
 VFS... mjpeg          MJPEG (Motion JPEG)
 V....D mjpeg_vaapi    MJPEG (VAAPI)
 V....D h264_vaapi     H.264/AVC (VAAPI)

$ ffmpeg -hwaccels
vdpau  cuda  vaapi  qsv  drm  opencl  vulkan
```

`h264_nvenc` is present and reachable from inside Caspar **without recompiling anything.** This is
the finding that changes the shape of the answer.

(`strings bin/casparcg | grep -i nvenc` returns nothing — expected. The encoder is selected at
runtime by the string in the AMCP args and resolved by libavcodec; it is not a compile-time symbol
in the Caspar binary. Absence of the string is not evidence of absence of support. This still has
to be confirmed empirically — see §9.)

### Browser — Firefox ESR, feature-detected, not assumed

```
$ firefox-esr --version
Mozilla Firefox 140.12.0esr
```

I ran a real feature-detection page in a **headless, separate-profile** firefox-esr instance
(safe: separate profile, headless, and the shape overlay only shapes windows whose title contains
`HIGHASCG-OPERATOR-GUI`, so the kiosk was never touched) and screenshotted the result:

```
UA = Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0
VideoDecoder = function
VideoEncoder = function
EncodedVideoChunk = function
VideoFrame = function
MediaSource = function
ManagedMediaSource = undefined
MSE.avc1.640028 = true            <- H.264 High @ L4.0
MSE.avc1.42E01E = true            <- H.264 Baseline
MSE.vp8webm = true
MSE.vp9webm = true
MSE.hev1 = true
MSE-in-Worker(canConstructInDedicatedWorker) = undefined
SharedArrayBuffer = undefined
crossOriginIsolated = false
WebTransport = function
RTCPeerConnection = function
RTCRtpScriptTransform = function
createImageBitmap = function
OffscreenCanvas = function
WebGL2 = false                    <- headless artefact, see below
VideoDecoder.avc1.640028 = true
VideoDecoder.avc1.42E01E = true
VideoDecoder.vp8 = true
VideoDecoder.vp09.00.10.08 = true
```

Readings:

- **MSE with H.264 in fMP4: supported.** Both Baseline and High profile.
- **WebCodecs `VideoDecoder`: supported**, and `isConfigSupported` returns true for H.264 High.
  Confirmed by the pref existing in libxul: `strings libxul.so | grep webcodecs` →
  `dom.media.webcodecs.enabled`.
- **MSE-in-a-Worker is NOT available** (`canConstructInDedicatedWorker` undefined). Any MSE
  appending must happen on the main thread. For a UI that also drives a compose canvas, that is a
  real constraint — WebCodecs *can* run in a worker and MSE cannot.
- **SharedArrayBuffer is unavailable.** `javascript.options.shared_memory` is `true` in
  `greprefs.js`, so the engine supports it — but `crossOriginIsolated = false`, and
  `src/server/security-headers.js` sets no `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy`. Enabling them app-wide would break cross-origin subresources,
  and this app embeds browser sources and templates. **Treat SAB as closed** (§5.5).
- **WebTransport and RTCPeerConnection exist.**
- `WebGL2 = false` is a headless artefact — the log line was
  `[GFX1-]: glxtest: Unable to open a connection to the X server`. The kiosk has a GPU and an X
  server; do not read anything into it.

### Client-side hardware decode — the part that bites

```
$ vainfo
vainfo NOT installed
$ dpkg -l | grep -iE 'nvidia-vaapi|va-driver'
ii  i965-va-driver          (Intel)
ii  intel-media-va-driver   (Intel)
ii  mesa-va-drivers         (Mesa)
ii  va-driver-all
```

**`nvidia-vaapi-driver` is not installed.** On the NVIDIA proprietary driver, Firefox has no
VA-API path without it. So whatever we send, **Firefox will decode it in software** — in the RDD
process, but still on this box's CPU. Since this is a localhost view, that decode cost lands on
the playout machine and must be counted. 1080p H.264 software decode in Firefox: roughly
0.2–0.4 of a core **(estimate)**; 3072x1728 correspondingly more.

This is a strong argument for **encoding the preview at a modest resolution rather than native**,
even though NVENC does not care — because the *decoder* does, and it is a software decoder on the
same box.

### GStreamer / WebRTC infrastructure

```
$ gst-inspect-1.0 webrtcbin
No such element or plugin 'webrtcbin'
```

`gst-plugins-bad`'s WebRTC element is **not installed**, and neither are the nvcodec GStreamer
plugins. A GStreamer-based WebRTC path means installing a new stack onto the playout box. Noted
against option 5.4.

---

## 4. Measured encoder cost

**Method.** `ffmpeg -benchmark -f lavfi -i "testsrc2=size=WxH:rate=50" -frames:v 250 <enc> -f null -`,
i.e. 5.0 seconds of 50p content. `utime+stime` is total CPU seconds. I subtract a source-only
`-c:v rawvideo` baseline run to isolate the encoder+filter cost, then divide by 5 to express it as
**CPU cores held continuously**.

Two source-format variants, because it matters a lot:
- `yuv420p` (testsrc2's native output) — flatters everything.
- `format=bgra` — **what Caspar actually hands its consumers.** These are the honest numbers.

Nothing here touched a live channel. `testsrc2` is a synthetic pattern only.

### 4.1 BGRA source — the honest table

| Config | Raw `utime+stime` (5s) | Baseline | **Cores held** |
| --- | --- | --- | --- |
| **3072x1728** source only | 1.848 s | — | — |
| `mjpeg -q:v 10`, scale to 1536x864 *(= today's path)* | 6.614 s | 1.848 | **0.95** |
| `h264_nvenc -preset p1 -tune ll`, full res | 1.874 s | 1.848 | **0.005** |
| **1920x1080** source only | 0.727 s | — | — |
| `mjpeg -q:v 10`, scale to 960x540 | 2.501 s | 0.727 | **0.36** |
| `h264_nvenc -preset p1 -tune ll`, full res | 0.834 s | 0.727 | **0.02** |

Raw output for the BGRA runs:

```
src-only bgra 3072x1728 (baseline)      bench: utime=1.625s stime=0.223s rtime=0.894s
bgra->nvenc p1 ll 3072x1728             bench: utime=1.680s stime=0.194s rtime=1.115s
bgra->mjpeg q10 half 3072x1728          bench: utime=6.496s stime=0.118s rtime=0.819s
src-only bgra 1920x1080 (baseline)      bench: utime=0.612s stime=0.115s rtime=0.310s
bgra->nvenc p1 ll 1920x1080             bench: utime=0.673s stime=0.161s rtime=0.529s
bgra->mjpeg q10 half 1920x1080          bench: utime=2.436s stime=0.065s rtime=0.280s
```

**Read that again.** On the real PGM channel geometry, with the real pixel format, the existing
MJPEG preview costs **0.95 of a CPU core per channel** and NVENC at *full* resolution costs
**0.005**. Turning the JPEG preview on for three channels would cost roughly **three cores inside
the Caspar process**. NVENC for the same three channels costs about 1.5% of one core.

### 4.2 yuv420p source — secondary, and one surprise

```
                                          (5s of 50p content, 250 frames)
src-only rawvideo 1080p (baseline)         bench: utime=0.257s stime=0.023s rtime=0.162s
mjpeg q10 1080p->960x540                   bench: utime=1.426s stime=0.054s rtime=0.181s
mjpeg q10 1080p full                       bench: utime=2.490s stime=0.154s rtime=0.237s
x264 ultrafast zerolat 1080p               bench: utime=1.470s stime=0.139s rtime=0.308s
x264 ultrafast zerolat 1080p threads=1     bench: utime=0.940s stime=0.015s rtime=0.737s
x264 veryfast zerolat 1080p                bench: utime=3.100s stime=0.140s rtime=0.584s
nvenc p1 ll 1080p                          bench: utime=0.279s stime=0.159s rtime=0.386s
nvenc p1 ll 1080p->960x540 (sw scale)      bench: utime=0.961s stime=0.156s rtime=0.323s

src-only rawvideo 3072x1728                bench: utime=0.726s stime=0.094s rtime=0.437s
mjpeg q10 3072x1728->1536x864              bench: utime=3.478s stime=0.108s rtime=0.429s
x264 ultrafast zerolat 3072x1728           bench: utime=4.225s stime=0.373s rtime=0.961s
nvenc p1 ll 3072x1728                      bench: utime=0.815s stime=0.171s rtime=0.724s
nvenc p1 ll 3072x1728->1536x864            bench: utime=2.326s stime=0.171s rtime=0.561s
```

As cores held:

| Config (yuv420p src) | Cores |
| --- | --- |
| 1080p mjpeg q10 → half | 0.24 |
| 1080p mjpeg q10 full | 0.47 |
| 1080p x264 ultrafast zerolatency | 0.27 |
| 1080p x264 ultrafast, `-threads 1` | **0.14** |
| 1080p x264 veryfast zerolatency | 0.59 |
| 1080p nvenc p1 ll | **0.03** |
| 1080p nvenc + **software** scale to half | 0.17 |
| 3072x1728 mjpeg q10 → half | 0.55 |
| 3072x1728 x264 ultrafast zerolatency | 0.76 |
| 3072x1728 nvenc p1 ll | **0.03** |
| 3072x1728 nvenc + **software** scale to half | 0.34 |

Three sub-findings that shape the design:

1. **Software scaling dominates.** NVENC full-res at 3072x1728 = 0.03 cores. NVENC *plus a
   swscale halving* = 0.34 cores — the scale is **11x** the encode. Never put `scale=` in front
   of NVENC on the CPU. Send full resolution and let the browser's CSS scale it down, or use
   `scale_cuda`.
2. **`-threads 1` on x264 ultrafast is cheaper in total CPU** (0.14 vs 0.27 cores) at the price of
   wall-clock. If NVENC turns out to be unavailable inside Caspar, single-threaded x264 ultrafast
   is the fallback, not the default multithreaded one — multithreading here buys latency we do not
   need and costs CPU we cannot spare.
3. **x264 ultrafast beats MJPEG on CPU *and* produces ~20x less bitrate.** Even the pure-software
   fallback is a strict improvement on the current JPEG path.

**Caveats, stated honestly.** `testsrc2` is a high-entropy synthetic pattern; MJPEG cost scales
with entropy and real programme content may be somewhat cheaper (or, for busy graphics, not).
These figures are the *encoder's* cost in a standalone ffmpeg process, not Caspar's internal frame
delivery, buffer copies, or consumer-thread overhead — the real in-Caspar delta will be **higher**
than these numbers for every option, but the *ratios* between options should hold.

---

## 5. Option-by-option evaluation

Latency figures marked **(estimate)** are not measured — measuring glass-to-glass would require
putting a consumer on a channel, which is out of scope for this document.

### 5.1 MJPEG over HTTP (`multipart/x-mixed-replace`)

Caspar `STREAM`/`FILE` consumer → MJPEG → node relays as a multipart HTTP response → `<img>`.

- **Latency:** ~1 frame encode + 1 frame network + browser paint ≈ **40–80 ms (estimate)**. MJPEG
  is all-intra so there is no reordering or GOP delay. Genuinely low.
- **CPU:** **Worst of every option.** 0.95 cores/channel at 3072x1728 BGRA, 0.36 at 1080p
  (measured). Encoder-side only; add JPEG *decode* in the browser on the same box.
- **GPU:** none used. `mjpeg_vaapi` exists but the VAAPI driver for NVIDIA is not installed.
- **Encoder availability:** yes, trivially.
- **Firefox ESR:** works. `multipart/x-mixed-replace` in `<img>` is ancient and reliable in Gecko.
  This is the *most* compatible option.
- **Complexity in this codebase:** **lowest.** The consumer plumbing, blocklist, backpressure,
  activity gating and WS broadcast all exist in `src/preview/`. Swapping the file-poll delivery for
  a multipart HTTP stream is a contained change.
- **Caspar restart/config:** none. `ADD`/`REMOVE` over AMCP, as today.
- **Verdict:** the cheapest to *build* and the most expensive to *run*. Its bandwidth is also
  brutal — 1536x864 JPEG q10 at 25 fps is roughly 15–40 Mbit/s **(estimate)**, fine on loopback,
  hostile over Wi-Fi to a laptop. **Reject as the primary, keep as the "it must work on anything"
  fallback.**

### 5.2 Fragmented MP4 / H.264 over WebSocket → Media Source Extensions

Caspar `STREAM` → `-codec:v h264_nvenc -format mpegts` → `udp://127.0.0.1:PORT` → node reads UDP,
remuxes MPEG-TS to fMP4 (or Caspar emits fMP4 directly) → WebSocket → `SourceBuffer.appendBuffer`
→ `<video>`.

- **Latency:** **150–400 ms (estimate)**, achievable down to ~120 ms with short fragments
  (1–2 frames per moof), `-tune ll`, all-intra or very short GOP, and
  `video.currentTime` catch-up nudging. MSE is a *buffering* API and fights you on latency; you
  have to actively manage the buffer or it drifts to seconds. This is the well-trodden but fiddly
  option.
- **CPU:** encode **0.005–0.02 cores** (measured, NVENC). Remux TS→fMP4 in node is header
  manipulation only, no pixel work — **<0.05 cores (estimate)**. Browser H.264 decode in software,
  **0.2–0.4 cores at 1080p (estimate)** since there is no VA-API driver.
- **GPU:** one NVENC session. Zero currently in use.
- **Encoder availability:** `h264_nvenc` present in the system libavcodec that Caspar links.
- **Firefox ESR:** **verified above** — `MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"')`
  returns `true`. **But** MSE cannot be constructed in a Worker on this build, so appends run on
  the main thread alongside the compose canvas.
- **Complexity:** **medium — and I measured it down to "low", see §5.2.1.** The TS→fMP4 remux was
  going to be the real work. It may not be needed at all.
- **Caspar restart/config:** **none.** `ADD n STREAM` over AMCP, per `caspar-ffmpeg-setup.js`.
- **Verdict:** **best all-round.** Good latency, near-zero encoder cost, works in Firefox ESR
  today, works over the network to a laptop unchanged, and reuses an AMCP mechanism this codebase
  has used before.

#### 5.2.1 Measured: ffmpeg can emit per-frame fMP4 directly — no remuxer needed

I ran this offline (synthetic `testsrc2`, no Caspar, no live channel):

```
$ ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=50 -t 2 -c:v h264_nvenc -preset p1 -tune ll -g 25 \
    -movflags +frag_every_frame+empty_moov+default_base_moof -f mp4 g2.mp4

g2.mp4  519486 bytes  Counter({'moof': 100, 'mdat': 100, 'ftyp': 1, 'moov': 1, 'mfra': 1})
        first5 = ['ftyp', 'moov', 'moof', 'mdat', 'moof']
```

**100 `moof`/`mdat` pairs for 100 frames** — exactly one fragment per frame, preceded by a
`ftyp`+`moov` init segment. That is precisely the byte layout MSE wants: append `ftyp+moov` once
as the init segment, then append each `moof+mdat` pair as it arrives. **This removes the GOP-length
buffering floor that normally makes MSE laggy** and it removes the need to write a TS→fMP4
remuxer — node becomes a dumb byte pump.

Bitrate: 519,486 bytes for 2.0 s = **~2.0 Mbit/s** at 1920x1080@50 with default NVENC rate
control. Compare the MJPEG path's estimated 15–40 Mbit/s. Comfortably streamable to a laptop over
Wi-Fi.

Two gotchas found the hard way, both worth recording:

- **The flag is `default_base_moof`, not `default_base_is_moof`.** The latter — which is the name
  most tutorials use — fails on this ffmpeg 6.1.1 build with
  `[Eval] Undefined constant or missing '(' in 'default_base_is_moof'` and writes a **0-byte
  file with exit code 0**. Silent failure.
- `+separate_moof` was not the cause of that failure but is unnecessary here (single video track).

`-f mp4` to a non-seekable target works because `+empty_moov` means the muxer never rewrites the
header. Writing to `/dev/stdout` was confirmed to work. The trailing `mfra` box is only written on
clean shutdown and is irrelevant to a live stream.

**Caveat:** this was `/usr/bin/ffmpeg`, not Caspar's consumer. Caspar's `ffmpeg_consumer` must
still accept `-format mp4` plus these `-movflags`, and per the `caspar-ffmpeg-setup.js:81` warning
the option-name mapping there is quirky. That is exactly what §9 tests. If Caspar will only do
`mpegts`, fall back to the remuxer — the plan does not change, only the effort in Stage 1.

### 5.3 WebCodecs `VideoDecoder` fed by WebSocket / WebTransport

Same producer side. Node ships raw H.264 Annex-B access units over WebSocket; the client feeds
`EncodedVideoChunk`s to a `VideoDecoder` and paints `VideoFrame`s to a canvas via
`drawImage`/`transferToImageBitmap`.

- **Latency:** **best of the streaming options — 60–150 ms (estimate)**. No container, no MSE
  buffer heuristics, no jitter buffer you did not write. You control exactly when each frame is
  decoded and drawn.
- **CPU:** identical encode cost. Decode is the same software decoder MSE would use, but you skip
  the demux. Marginally cheaper.
- **GPU:** one NVENC session; canvas paint is GPU.
- **Encoder availability:** same as 5.2.
- **Firefox ESR:** **verified** — `VideoDecoder = function`, and
  `VideoDecoder.isConfigSupported({codec:'avc1.640028', 1920x1080})` → `supported: true`. Also
  `avc1.42E01E`, `vp8`, `vp09.00.10.08`. Additionally **WebCodecs works in a Worker**, unlike MSE
  — so decode and paint can be moved entirely off the main thread onto an `OffscreenCanvas`
  (`OffscreenCanvas = function`, verified). That is a genuine advantage for a UI that also runs a
  compose canvas.
- **Complexity:** **medium-high.** You must do your own Annex-B parsing, SPS/PPS extraction into
  `description` for avcC (or use Annex-B `avc1` config), keyframe waiting, and pacing/presentation
  timing. There is no library here; it is 300–600 LOC of careful code **(estimate)**.
- **Caspar restart/config:** none.
- **Verdict:** **the right end-state**, and the lowest-latency in-browser option available. But
  it is more code than 5.2 and shares 100% of its server side. **Build 5.2 first; the producer
  half is identical, so switching the client to WebCodecs later costs nothing on the server.**

### 5.4 WebRTC via a local `webrtcbin` / similar

- **Latency:** **lowest of all streaming options, 30–100 ms (estimate)**. WebRTC is purpose-built
  for this.
- **CPU:** encode same; add SRTP encryption, RTP packetisation, ICE, and congestion control — all
  of which are pure overhead **on loopback**, where there is no loss to recover from and nothing
  to encrypt against.
- **GPU:** one NVENC session (if the WebRTC stack can be pointed at it).
- **Availability:** **`gst-inspect-1.0 webrtcbin` → "No such element or plugin 'webrtcbin'".**
  Neither `gst-plugins-bad`'s webrtc element nor the GStreamer nvcodec plugins are installed. This
  means **installing a new media stack onto the playout box**, plus a signalling server, plus ICE
  handling, plus a new dependency in the ISO/eggs-produce pipeline.
- **Firefox ESR:** `RTCPeerConnection = function`, `RTCRtpScriptTransform = function` — full
  support, no concerns.
- **Complexity:** **highest by a wide margin.** Signalling, SDP negotiation, ICE, a new
  system-level dependency, and a whole new failure surface on a machine whose job is to not fail.
- **Caspar restart/config:** none for Caspar, but a real change to the box's software inventory.
- **Verdict:** **reject for now.** It wins ~50 ms over WebCodecs and costs a new system dependency
  and an order of magnitude more code. Revisit only if a genuine multi-viewer remote requirement
  with adaptive bitrate appears.

### 5.5 Raw RGBA over SharedArrayBuffer / WebSocket to a canvas

- **Latency:** essentially one frame, **~20–40 ms (estimate)** — theoretically the best.
- **CPU/bandwidth:** 3072x1728 BGRA at 50 fps is **1,061 MB/s**. 1920x1080 BGRA at 50 fps is
  **415 MB/s**. Over a WebSocket that means serialising, copying, and garbage-collecting hundreds
  of megabytes a second in node *and* in Gecko. This is far more expensive than any codec.
- **SharedArrayBuffer:** **unavailable.** Verified `SharedArrayBuffer = undefined`,
  `crossOriginIsolated = false`. Enabling it needs `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on the whole app — and `src/server/security-headers.js`
  sets neither. COEP `require-corp` would break every cross-origin subresource, and this app hosts
  templates and browser sources. Even then, node cannot write into a browser's SAB; you would need
  a shared memory file plus a WASM bridge. This is not a small change.
- **Firefox ESR:** SAB gated as above; `javascript.options.shared_memory` is `true` in
  `greprefs.js` so the engine would allow it *under isolation*.
- **Verdict:** **reject.** The one thing "zero copy to the browser" would buy us — perfect
  fidelity at zero latency — is exactly what hole punching already gives us for free, and better.
  If you want zero-copy, the answer is the holes.

### 5.6 The existing JPEG path, tuned

What tuning is available: `fps` (clamped 1–30), `jpegQuality` (2–31), `resolutionScale`
(half/75/full), `maxWidth: 480`, `pauseConsumerWhenIdle`, plus the WO-280 backpressure.

- Dropping to **5 fps at half res** would cut encode cost roughly 5x to **~0.19 cores/channel at
  3072x1728 (estimate, scaled from measurement)** — acceptable, but 5 fps is not a *monitoring*
  view, it is a thumbnail. The operator explicitly said the PRV "needs to be as close to realtime
  as possible" (todos19.07.26).
- At the **25 fps** it is configured for, it costs **0.95 cores/channel**. That is the finding
  that kills it as a primary.
- `pauseConsumerWhenIdle: false` today. Turning it on would help, but the operator view is never
  idle.
- **Verdict:** keep it exactly where it is — **the Companion Stream Deck thumb** (1 fps, 144px,
  currently enabled and cheap). It is the right tool for a 144px button and the wrong tool for a
  monitoring window. Do not scale it up to be the main view.

---

## 6. Comparison table

Cores are **measured** where stated; latency is **estimated** throughout except hole punching.

| Option | Latency | Encoder CPU (3072x1728 BGRA) | Browser CPU | GPU | FF ESR 140 | Complexity | Caspar restart | Laptop? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Hole punch (today)** | **0 ms** | **0** | 0 | screen consumer | n/a | 2,322 LOC exists | no | **no** |
| MJPEG/HTTP | 40–80 ms est | **0.95 cores** meas | JPEG decode | none | yes | **low** | no | yes (heavy) |
| **fMP4 + MSE** | 150–400 ms est | **0.005 cores** meas | 0.2–0.4 est | 1 NVENC | **yes, verified** | medium | **no** | **yes** |
| **WebCodecs** | **60–150 ms est** | **0.005 cores** meas | 0.2–0.4 est | 1 NVENC | **yes, verified** | med-high | **no** | **yes** |
| WebRTC | 30–100 ms est | 0.005 cores meas | 0.2–0.4 est | 1 NVENC | yes | **highest** + new deps | no | yes |
| Raw RGBA / SAB | 20–40 ms est | 0 (but 1 GB/s) | enormous | none | **SAB blocked** | high | no | no |
| JPEG path @25fps | 40–80 ms est | **0.95 cores** meas | JPEG decode | none | yes | **already built** | no | yes (heavy) |

---

## 7. What "localhost only" actually buys — and where it stops being true

### What it buys

- **No encryption.** No DTLS/SRTP, no TLS, no certificate management. This removes most of
  WebRTC's justification.
- **Bandwidth is free-ish.** Loopback moves gigabytes per second. We could send 100 Mbit/s
  MJPEG and the *network* would not care.
- **No packet loss, no jitter, no reordering.** No retransmission, no FEC, no adaptive bitrate, no
  congestion control. UDP to `127.0.0.1` is reliable in practice.
- **No auth boundary** beyond what `src/server/auth.js` already does.
- **Timestamps are trustworthy.** Same clock on both ends — you can measure real latency by
  comparing timestamps directly, which makes tuning tractable.

### Where it stops being true

**Bandwidth being free is exactly what makes MJPEG *look* viable on localhost — and it is the
trap.** The constraint on this box is not bandwidth, it is **CPU**, and localhost does nothing for
that. Worse: because the browser is also on this box, localhost-only means the **decode cost lands
on the playout machine too**. A remote laptop viewer would at least decode on its own CPU.

**Localhost-only directly conflicts with the stated laptop requirement.** The brief says the
operator also wants a laptop on the network to see something. The moment that is real:

- MJPEG at 15–40 Mbit/s becomes hostile over Wi-Fi.
- You want a compressed codec with a controllable bitrate — i.e. H.264.
- You want it reachable over a real socket, not a UNIX pipe or `127.0.0.1`-bound port.

**Therefore: do not optimise for localhost-only.** Every design that is right for localhost is
*also* right for the laptop if you pick H.264, and picking H.264 costs essentially nothing here
because NVENC is idle. The only genuine localhost-only shortcuts worth taking are: skip
encryption, skip adaptive bitrate, skip ICE. Take those three; take nothing else.

---

## 8. Recommendation

### 8.1 Keep the holes for the operator's own screen

Nothing beats a screen consumer on the same GPU. Zero latency, zero CPU, perfect fidelity. The
machinery is already written, debugged and — per todos19.07.26 — recently fixed. Ripping out 2,322
working LOC to replace 0 ms with 150 ms on the operator's primary monitor would be a downgrade
sold as a cleanup.

**This is a legitimate hybrid outcome and I think it is the correct one.**

### 8.2 Build the H.264 stream for everything the holes cannot serve

One `ADD <ch> STREAM udp://127.0.0.1:PORT -codec:v h264_nvenc ...` per channel we want visible.
Node reads the loopback UDP, and serves it to browsers.

This gives us four things at once:

1. **The laptop view.** The thing the holes fundamentally cannot do.
2. **A real in-browser fallback** for any non-kiosk browser, any second operator, any support
   session. Today those see grey rectangles.
3. **An escape hatch that de-risks the holes.** Right now the hole path is single-point-of-failure
   for seeing anything at all. Once there is a working in-browser view, the shape overlay becomes
   an *optimisation* rather than a hard dependency — which is the real simplification the brief is
   reaching for.
4. **A replacement for the JPEG path** at ~1/180th of its CPU cost.

**Stream channel 5 first.** It is already a composited 1920x1080@50 mosaic of the operator's whole
view. One NVENC session (0.02 cores measured) gives a laptop the *entire* operator display. That
is by far the best value-per-unit-work available and it needs no new Caspar channel, no new
consumer on any on-air channel, and no config file edit.

### 8.3 Encoder settings to start from

```
ADD 5 STREAM udp://127.0.0.1:52200?pkt_size=1316
  -codec:v h264_nvenc
  -preset:v p1
  -tune:v ll
  -b:v 6000k -maxrate:v 6000k -bufsize:v 600k
  -g 25 -forced-idr 1
  -muxdelay 0 -muxpreload 0
  -format mpegts
```

Rationale, tied to what was measured or read:

- `-format mpegts` **not** `-f mpegts` — mandated by the comment in
  `src/streaming/caspar-ffmpeg-setup.js:81`. Getting this wrong produces "Unable to choose an
  output format".
- `udp://127.0.0.1:...` not `srt://` — same file, line 85: many Caspar builds cannot open srt
  output.
- **No `-vf scale=`.** Measured: software scaling costs 11x the NVENC encode. Send native, scale
  in CSS. (If bitrate or *decode* cost demands smaller, use `scale_cuda`, or add a Caspar-side
  route to a lower-resolution channel — but measure first.)
- `-preset p1 -tune ll` — the exact configuration benchmarked at 0.005 cores.
- Short GOP + `-forced-idr` so a late-joining browser starts within ~0.5 s. Compare
  `repeat-headers=1 scenecut=0` in `browser-capture-args.js` — same problem, already solved there.
- `-bufsize` small: VBV buffer size is a direct latency term.

### 8.4 Staged path

**Stage 0 — de-risk (hours).** Run the §9 experiment. If Caspar's `ffmpeg_consumer` rejects
`h264_nvenc`, everything below shifts to `libx264 -preset ultrafast -tune zerolatency -threads 1`
(0.14 cores measured at 1080p — still 2.5x cheaper than the current MJPEG path) and the rest of
the plan is unchanged.

**Stage 1 — one channel, MSE, laptop first (days).** Stream channel 5 only. Node UDP reader →
TS→fMP4 remux → WebSocket → `<video>` on a new route, e.g. `/monitor`. **Do not touch the operator
kiosk.** Target: a laptop shows the operator mosaic. Measure real latency with an on-screen clock
in a template. This delivers the missing capability with zero risk to air.

**Stage 2 — in-browser tiles as a fallback (weeks).** Extend to per-channel streams. Put the
`<video>` element *inside the existing tile body element* in
`client/components/operator-compose-tiles.js`. The tile geometry, layout persistence and aspect
fitting all stay exactly as they are — this is a drop-in swap of "empty div that gets a hole
punched behind it" for "div containing a `<video>`". Gate it behind a
`composePreview.mode: 'h264'` setting alongside the existing `canvas` / `ffmpeg_jpeg`
(`compose-preview-mode.js:14` is already a three-way switch waiting for a third value). Default
stays `canvas`. The operator can A/B them.

**Stage 3 — WebCodecs, if latency demands (weeks).** Identical server side. Swap the client from
MSE to `VideoDecoder` + `OffscreenCanvas` in a Worker — verified available on FF 140 ESR, and it
gets the decode off the main thread, which MSE cannot do on this build. Expect roughly 100 ms
improvement **(estimate)**.

**Stage 4 — retire what has become optional.** Once Stage 2 is trusted, the shape overlay can be
demoted to an opt-in "zero-latency mode" for the operator monitor. The 2,322 LOC does not have to
be deleted, but it stops being the only way to see video, and the click-dead-hole bug class stops
being a release blocker.

### 8.5 What NOT to do

- **Do not enable `composePreview.mode: 'ffmpeg_jpeg'` at 25 fps.** Measured 0.95 cores/channel at
  3072x1728. Three channels ≈ three cores burned inside the Caspar process, on air.
- **Do not put a software scale in front of NVENC.** 11x the encode cost, measured.
- **Do not install a GStreamer WebRTC stack** for a ~50 ms gain over WebCodecs.
- **Do not pursue SharedArrayBuffer.** It needs app-wide COOP/COEP that would break template and
  browser-source embedding, and it would still lose to the holes.
- **Do not add the consumer to `config/casparcg.config`.** Use `ADD`/`REMOVE` over AMCP, exactly as
  `compose-preview-consumer.js` already does. No Caspar restart, and it can be turned off live.

---

## 9. The smallest experiment

**One AMCP line, on an idle channel, during a quiet moment. It answers the only question the whole
plan depends on: does Caspar's `ffmpeg_consumer` accept `h264_nvenc`?**

Channel 7 (live audio input, `<consumers></consumers>`, 1080p5000) or channel 4 (webpage host) —
both idle, neither on air, neither has a screen or DeckLink consumer.

```bash
# 1. baseline
nvidia-smi -q -d ENCODER_STATS | grep -A3 "Encoder Stats"     # expect Active Sessions : 0

# 2. attach — one line, on an IDLE channel
echo 'ADD 7 STREAM udp://127.0.0.1:52200?pkt_size=1316 -codec:v h264_nvenc -preset:v p1 -tune:v ll -b:v 4000k -g 25 -format mpegts' | nc 127.0.0.1 5250

# 3. did the GPU take the session?
nvidia-smi -q -d ENCODER_STATS | grep -A3 "Encoder Stats"     # want Active Sessions : 1

# 4. is CPU actually near zero? (compare against the 0.005-core prediction)
top -b -n3 -p $(pgrep -f bin/casparcg) | grep casparcg

# 5. does it decode, and how fast does it start?
ffplay -fflags nobuffer -flags low_delay -probesize 32 udp://127.0.0.1:52200

# 6. DETACH
echo 'REMOVE 7 STREAM udp://127.0.0.1:52200?pkt_size=1316' | nc 127.0.0.1 5250
```

**I did not run this** — it attaches a consumer to a Caspar channel, which is outside the read-only
scope I was given. It should be run by the box owner, or with explicit permission, at a quiet
moment.

**Pass:** `Active Sessions : 1`, Caspar CPU essentially unchanged, `ffplay` shows picture within
~1 s. → Stage 1 is green, go build the node UDP→fMP4→WS relay.

**Fail (encoder rejected):** Caspar logs an `avcodec_open2` / "Cannot reinitialize ffmpeg-consumer"
error. → fall back to `-codec:v libx264 -preset:v ultrafast -tune:v zerolatency -threads 1`
(0.14 cores measured at 1080p) and continue with the identical plan. **The fallback is still
better than the status quo**, so this experiment cannot kill the project — it only decides which
encoder the project uses.

**The second, even smaller experiment I already ran** (fully offline, zero Caspar involvement) is
in §5.2.1: `ffmpeg` emits **one fMP4 fragment per frame** with
`-movflags +frag_every_frame+empty_moov+default_base_moof -f mp4`, at ~2.0 Mbit/s for
1920x1080@50. So the *remuxer* question is already answered for stock ffmpeg. **The only thing
left to learn is whether Caspar's consumer will pass those args through** — which is the same
`nc 127.0.0.1 5250` line above with `-format mp4 -movflags +frag_every_frame+empty_moov+default_base_moof`
substituted for `-format mpegts`. Try both variants in the one sitting; it costs nothing extra.

If Caspar takes the fMP4 variant, Stage 1 needs **no TS→fMP4 remuxer at all** — node becomes a
dumb byte pump from UDP to WebSocket, and Stage 1 shrinks from days to hours.

---

## 10. Open questions I could not answer read-only

1. **Does Caspar's `ffmpeg_consumer` accept `h264_nvenc`?** The encoder is in the system
   libavcodec that Caspar links (verified by `ldd`), but the consumer may constrain pixel formats
   in a way that fails `avcodec_open2`. §9 settles it.
2. **Real glass-to-glass latency.** Every streaming latency figure in this document is an
   estimate. Measuring it requires a live consumer plus an on-screen clock template.
3. **Caspar's internal cost of an additional consumer** — frame copies, consumer-thread scheduling,
   any hitch on `ADD`. `compose-preview-consumer.js:50` warns that "REMOVE/ADD causes a visible
   output hitch", which is why the whole diff-based reconcile exists. That hitch risk applies to
   *attaching* too, and is a strong argument for only ever attaching to idle channels (ch5) rather
   than PGM.
4. **Firefox's actual decode path on the kiosk.** `nvidia-vaapi-driver` is not installed, so I
   expect software decode, but `about:support` → Media on the real kiosk would confirm it. If
   decode cost turns out to matter, installing `nvidia-vaapi-driver` is a small, contained change
   with a large payoff — worth investigating separately.
5. **NVENC session cap on RTX PRO 4000 Blackwell.** Vendor-documented as uncapped on professional
   parts; not verified here. Irrelevant at 1–3 sessions.

---

## Appendix: commands run for this document

All read-only except the benchmarks, which used synthetic `testsrc2` input and `-f null` output —
no live channel, no Caspar interaction, no file written outside the scratchpad.

```
nvidia-smi
nvidia-smi --query-gpu=name,driver_version,memory.total,utilization.gpu --format=csv
nvidia-smi -q -d ENCODER_STATS
firefox-esr --version
ffmpeg -version | -encoders | -hwaccels
ldd bin/casparcg
strings bin/casparcg   (consumer names, ffmpeg_consumer symbols)
strings /usr/lib/firefox-esr/libxul.so | grep -E '^dom\.media\.webcodecs|^media\.mediasource'
unzip /usr/lib/firefox-esr/omni.ja greprefs.js   (into scratchpad)
vainfo (absent) ; dpkg -l | grep va-driver ; gst-inspect-1.0 webrtcbin (absent)
nproc ; /proc/cpuinfo
firefox-esr --headless --no-remote --new-instance --profile <scratchpad> --screenshot
    (feature-detection page, separate profile, kiosk untouched)
ffmpeg -benchmark -f lavfi -i testsrc2=... -frames:v 250 <encoder> -f null -
    (12 runs, ~5s of synthetic content each)
ffmpeg -h muxer=mp4                              (valid movflags on this build)
ffmpeg -f lavfi -i testsrc2 ... -c:v h264_nvenc -movflags +frag_every_frame+empty_moov+default_base_moof
    -f mp4 <scratchpad>/g2.mp4                   (fMP4 fragment-structure test, §5.2.1)
```

The only NVENC sessions created were transient, by standalone `ffmpeg` processes on synthetic
input, and all had exited before this document was written.
