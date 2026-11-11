# WO-1033 — Zero-copy GPU frames in the Caspar build: future work for headroom
**Area:** caspar-build, video-io, engine
**Status: OPEN (11.11 — future work; source read, nothing built or measured for this WO)**

Owner, 11.11: *"Would porting the playout engine … into rust give a big performance boost?"* (answer: no — decode,
compositing, CEF and output are FFmpeg / GPU / vendor code in any language; the gains are in where frames live),
then *"How would implementing zero-copy GPU frames work?"*, then: *"Write those as future work. Cef is the most
negligible. Headroom is quite important."*

Goal: **headroom** — more layers / bigger rasters / more channels per box before the first dropped frame. Not a fix
for a current fault. WO-1030 holds the measurements that show where headroom goes today.

## Investigation (source `~/caspar-build/src-v2`, `highascg-main` @ 5c3373ec5)

Where a frame crosses between system RAM and VRAM today:

| Stage | Today | Evidence |
|---|---|---|
| Decode | FFmpeg software decode into RAM. No hardware decode at all (no `hw_device` / `hwaccel` anywhere in `modules/ffmpeg`) | `modules/ffmpeg/producer/av_producer.cpp:105`, `:300` |
| Decode → mixer | Every plane of every frame uploaded through a PBO. DXV and NotchLC upload the compressed payload and decode in a shader (already cheap) | `accelerator/ogl/image/image_mixer.cpp:350`, `:343` |
| Mixer → consumers | **Every composited frame of every channel is read back, unconditionally**, whether or not any consumer reads bytes | `image_mixer.cpp:126` (`copy_async(target_texture)`), `accelerator/ogl/util/device.cpp:274` |
| Screen consumer | Already zero-copy: `<gpu-texture>true</gpu-texture>` binds the mixer's texture. On by policy | `modules/screen/consumer/screen_consumer.cpp:1169`, `src/config/screen-consumer-policy.js:21` |
| CEF → mixer | CPU pixel buffer (`OnPaint`) + upload. The shared-texture path is Windows-only (D3D) | `modules/html/html.cpp:345-356`, `modules/html/producer/html_producer.cpp:397` |
| DeckLink / NDI / shm / pixel / artnet / ffmpeg consumers | Read `image_data()` — need bytes | grep `image_data` under `modules/*/consumer` |

So the screen path is done, and the readback is what is left on the output side: a wall channel whose only video
consumer is a gpu-texture screen still downloads its whole frame every tick (7680x2160 BGRA = 66 MB, × 50 /s =
3.3 GB/s) and nobody reads it. WO-1030 measured that cost from the other side: an *empty* 8K PRV channel ticking took
the wall from 52 to 32 fps.

## Future work, in order of headroom per effort

### 1. Readback only when a consumer needs bytes

- A consumer declares whether it reads pixels (screen with gpu-texture: no; audio-only / meter: no; DeckLink, NDI,
  shm, pixel, artnet, ffmpeg: yes). The channel's output passes "any byte consumer this tick?" to the mixer; the mixer
  skips `copy_async(target_texture)` when the answer is no and returns the texture only.
- Decide the flag per tick before the draw, not lazily on first `image_data()` call: the readback is asynchronous
  (PBO + fence, `device.cpp:274-300`), a late request would cost a frame of latency or a stall.
- Covers: screen-only walls, PRV channels shown only on the operator GUI, channels held ticking by the meter
  consumer. Largest gain of the list, smallest change, no codec or driver dependency.
- **Overlap to settle first:** in WO-1030 the owner declined "a consumer that takes audio only must not trigger the
  frame fetch" (10.11, "this not"). This item contains that change. Needs the owner's go-ahead in this wider form.
- To check: route producers (`route://`) — whether a routed layer reuses the source channel's texture or its bytes
  (`frame.opaque()` texture cache, `image_mixer.cpp:330`); a route must keep working from a texture-only frame.
  Same for the GUI channel's shm consumer leases.

### 2. Cheaper readback where bytes are needed

- Convert to the consumer's wire format in a shader before the download: UYVY / v210 for DeckLink and NDI halves the
  bytes (the DeckLink v210 strategies convert on the CPU today, `modules/decklink/consumer/v210_strategies.cpp`).
- Reduced publish for the shm consumer: scaled and/or every Nth frame, done on the GPU. WO-1030 (fourth measurement):
  a 480 px / 10 fps relay tile costs 1.3–2 Caspar threads because the consumer publishes 66 MB × 50 /s.
- Same idea for operator-GUI previews of a big channel (WO-1030 "route a reduced copy" — owner: wait).

### 3. Hardware decode straight into mixer textures (NVDEC)

- H.264 / HEVC / AV1 only. NVDEC leaves the frame in VRAM as a CUDA surface (NV12 / P010); register a GL texture
  with CUDA, GPU-to-GPU copy, hand the textures to the mixer through the existing `frame.opaque()` texture slot
  (the DXV / NotchLC path already does this). The mixer needs an NV12 (two-plane) pixel format.
- Removes decode CPU and the upload for those codecs. Does nothing for ProRes (CPU decode, WO-991), nothing new for
  DXV / NotchLC / HAP.
- Costs: frames become context-bound (lifetime, pooling, destruction order on the GL thread), a software fallback
  stays for every other codec, NVDEC session and VRAM limits per card, CUDA/GL interop is driver-sensitive (two
  driver generations on the boxes: 26.04 native + the noble rollback libs).
- Worth it only if show media moves to those codecs; today's library is mostly ProRes / NotchLC / HAP-type files.
  Measure the codec mix of real projects before starting.

### 4. NVENC from GPU surfaces (stream / record)

- The ffmpeg consumer encodes from RAM frames. NVENC can take CUDA surfaces; with item 1 a Stream PGM channel would
  need no readback at all. Smaller gain (stream rasters are 1080p), same interop risks as item 3. After 3, it shares
  the plumbing.

### 5. CEF shared texture on Linux — last (owner: "the most negligible")

- `OnAcceleratedPaint` with a dmabuf imported as a GL texture. Upstream's own note (`html.cpp:354`): Linux without
  shared texture tested faster than Windows with it. Awkward on NVIDIA (dmabuf / EGL import vs the GLX context).
- The HTML cost that showed in WO-1030 (8K test card: 52 → 36 fps, 420 % CPU) is rasterising at 8K, not the copy; the
  remedy there is rendering small and scaling in the mixer. Do not start this item for that.

## Not future work

- A Rust (or any) rewrite of the engine: the hot paths are FFmpeg, the GPU, CEF and vendor SDKs.
- Screen consumer texture sharing: already in the build and on.

## Verified

Nothing built. The table above is from reading the source at 5c3373ec5; the figures quoted are WO-1030's
measurements on highascg5867, not new ones. Before item 1 is built: baseline per-channel cost with the :6250
presented/dropped counters and PCIe bus utilisation (`nvidia-smi dmon -s t`) on the 8K wall setup, so the gain is a
number.
