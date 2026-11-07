# WO-993 — Native DXV (Resolume DXV2 / DXV3) in Caspar: CPU unpack, GPU block decode, correct DXV3 HQ colours
**Area:** caspar-build, engine
**Status: DONE (07.11.26, shader maths equal to FFmpeg on every pixel of 9 clips; on both boxes' GPUs DXT1/DXT5 pictures are pixel-identical to FFmpeg's decode through the mixer, and DXV3 HQ now shows correct colours instead of wrong ones; deployed to both boxes as 2476644c4)**

Owner, 07.11: *"While on it figure out if we can get better performance on ProRes playback. If possible add native
dxv3 support."* ProRes became WO-991. This WO is the DXV half.

## Investigation

- **What DXV is.** It is Resolume's codec. Each packet is a texture compressed with DXV's own scheme (LZF, stored,
  DXT1/DXT5 back-references, or the DXV3 HQ opcode/FSE scheme), wrapped around standard GPU blocks:
  - **DXT1:** BC1, opaque ("Normal Quality, no alpha").
  - **DXT5:** BC3, premultiplied alpha ("Normal Quality with alpha"). FFmpeg decodes it with `dxt4_block`, which
    un-premultiplies.
  - **YCG6:** Y as BC4 at full resolution, Co/Cg as BC5 at half resolution ("High Quality").
  - **YG10:** Y+A as BC5, plus the same Co/Cg ("High Quality with alpha").
- **FFmpeg 8.0.1's CPU path** (`libavcodec/dxv.c` + `texturedsp.c`) undoes the compression, then decodes the
  blocks on the CPU to rgba (DXT) or to yuv420p/yuva420p tagged `AVCOL_SPC_YCGCO` (HQ).
- **DXV3 HQ has always played with wrong colours in Caspar.** Caspar's colour-space mapping
  (`av_producer.cpp:111-125`) only knows bt601/709/2020. YCgCo falls through to bt709, so the raw YCoCg planes are
  converted as YCbCr.
  - Captured on ch4: magenta bars came out olive and blue came out green (`scratchpad/dxv/cap/hq-gpu-vs-cpu.png`).
  - swscale can't fix it either: `ffmpeg -i dxv3-hqna.mov out.png` fails with "Impossible to convert" in FFmpeg 8.
- **DXT5 alpha on the CPU path is subtly wrong as well.** FFmpeg hands over straight colour, but the ffmpeg producer
  tells the mixer it's premultiplied (`make_frame(…, is_straight_alpha = false)`). Semi-transparent edges come out
  too bright.
- **The YCoCg→RGB formula** was checked on the FATE colour-bar sample. R = Y + Co − Cg, G = Y + Cg, B = Y − Co − Cg,
  full range, chroma offset 128. All eight bars land within 1 code of 0/255, which is BC quantisation.
- **Media:** no DXV files on either box (agent search of the media trees, `scratchpad/dxv/movlist.txt`). Test media
  is the FATE samples (DXV2 DXT1/DXT5, DXV3 NQ/HQ with and without alpha) plus a 4K DXT1 clip encoded with FFmpeg.
  - FFmpeg's DXV encoder only writes DXT1, so **there is no 4K HQ clip and no clip with real semi-transparent
    alpha**. Both alpha samples are fully opaque.
- **CPU cost per 4K frame** (harness, `scratchpad/dxv/harness/`):

  | format | FFmpeg 1 thread | FFmpeg 4 threads | unpack only (this WO) |
  |---|---|---|---|
  | DXT1 | 5.6 ms | 1.7 ms | 1.2 ms |
  | DXT5 | 30 ms | 9 ms | 2.2 ms |
  | HQ | 14 ms | 6 ms | 3.9 ms |
  | HQ with alpha | 21 ms | 9 ms | 4.4 ms |

  - The texture handed to the GPU is also smaller. A 4K RGBA frame is 33 MB to copy and upload; the blocks are
    4.1 MB (DXT1), 8.3 MB (DXT5) or about 6 MB (HQ).

## What was done

Caspar `highascg-main` **2476644c4**; patch `caspar/patches/wo993-native-dxv-gpu-decode.patch`. It has the same
shape as the NotchLC path (WO-820).

- **`modules/ffmpeg/util/dxv_unpack.{h,cpp}`** (written by an agent, then checked here): a port of FFmpeg's `dxv.c`
  and `lzf.c` that stops at the raw BC blocks. LGPL notices are kept.
- **`core/frame/dxv.h`:** the payload frame.
  - One plane of 32-bit words, 1024 per row, uploaded as BGRA8 like the NotchLC payload.
  - A 16-word header: magic, valid, format, picture size, coded size, block offsets, bytes used. The full-res
    blocks follow, then the half-res Co/Cg blocks.
- **`producer/av_producer.cpp` Decoder:**
  - For `AV_CODEC_ID_DXV`, `dxv_receive` unpacks each packet into the pooled GRAY8 payload frame, tagged
    `DXV_PAYLOAD_TAG`. libavcodec is not opened.
  - It shares the NotchLC pending-packet/EOF/pool plumbing, now `payload_gpu()`; the filter sink accepts only GRAY8.
  - An undecodable packet is drawn transparent, with one warning per stream, as with NotchLC.
  - FFmpeg is kept with `<ffmpeg><producer><dxv-gpu>false</dxv-gpu>`, with a user `VF`/`FILTER`, or when the
    coded height is below 8.
- **`util/av_util.cpp` make_frame:** a tagged payload becomes one `pixel_format::dxv` plane holding just the rows in
  use. The size is fixed per stream and format, so there is one pool size.
- **`accelerator/ogl/image/dxv_kernel.{h,cpp}`** plus the `image_mixer.cpp` hooks: upload the plane, then a
  fragment shader decodes each pixel from its block into an RGBA16 texture. It uses texturedsp.c's integer maths:
  565 expansion, the 3/4-colour palettes, BC3/BC4 interpolation, and the 48-bit index field.
  - **DXT1:** FFmpeg's values.
  - **DXT5:** the raw premultiplied palette colour and alpha. Caspar works premultiplied, so this is right where
    the CPU path isn't.
  - **HQ:** the YCoCg formula. Chroma comes from the half-res sample covering the pixel. A last chroma column/row
    that FFmpeg leaves undecoded (coded size not a multiple of 8) is clamped to the previous block.
  - **HQ with alpha:** straight alpha (`is_straight_alpha`, so the image kernel premultiplies). That is what FFmpeg
    exposes; there is no un-premultiply in `dxv.c` for YG10.
- **Why shader decode rather than `glCompressedTexImage2D` S3TC/RGTC textures:**
  - It goes through the proven NotchLC upload path, with no compressed-texture plumbing in the device pools.
  - It matches FFmpeg's rounding exactly; hardware BC1 interpolation differs from texturedsp.c by a code here and
    there.
  - The YCoCg conversion needs a shader pass anyway.
  - The cost is a few dozen integer operations per pixel, which is negligible at 4K on these GPUs.

## What was VERIFIED

- **Unpack, bit-exact.** The harness compares the unpack plus a per-pixel reference BC decode against libavcodec:
  - all frames of all 9 clips, **ALL BIT-EXACT**;
  - ASan/UBSan differential fuzz: 20 000 mutated packets with 0 verdict or output mismatches against libavcodec,
    plus 10 000 garbage packets and random sizes, with no crash.
- **Shader maths, every pixel.** `harness/shaderemu.cpp` is a line-for-line C++ port of the GLSL, fed payloads built
  exactly as `dxv_receive` builds them. Compared with libavcodec on every pixel of every frame of the 9 clips:
  - DXT1 rgba;
  - DXT5 after FFmpeg's un-premultiply;
  - Y/A/Co/Cg planes for HQ;
  - result: **ALL PIXELS MATCH**. Payload use is 4.1 of 10.4 MB at 4K DXT1 and 82 of 86 KB for 256² HQ with alpha.
- **On the box, this box (RTX PRO 4000 Blackwell).** Each clip was LOADed on ch4 layer 30 (1080p50, no screen
  output) and captured losslessly (`ADD 4 FILE … ffv1`), once on the GPU path and once with `VF "null"` (FFmpeg's
  decoder):
  - **DXT1, DXT5 and the DXV3 NQ variants: 100.00 % of pixels identical**, max diff 0. That includes the 4K DXT1
    clip after the GPU scale to 1080.
  - **HQ and HQ with alpha:** GPU = correct colour bars, CPU = wrong colours (mean |diff| 84; see the
    investigation).
- **highascg5867 (RTX 2080 SUPER, Turing, so a different GPU generation):** the same captures on PRV ch3
  (6144x1024) give the same result. DXT1/DXT5 are 100 % identical; HQ matches this box's GPU output (mean 126.6).
  The shader compiles on both drivers (615.71.09).
- **CPU, 4K DXT1 at 25p looping on ch4** (50p channel), 20 s windows: no clip 154 %, **GPU path 168 % (+14)**,
  FFmpeg path 184 % (+30).
  - DXT1 is FFmpeg's cheapest DXV case.
  - DXT5 and HQ should gain more (table above), but there is no 4K clip of those to measure.
- **The 4K clip looped twice on each path with no errors.** The only warnings are the "Latency: n" at each clip
  start, which the ProRes clip shows too, and the FATE samples' `stsd` overread.
- `VERSION` is `2.5.1 2476644c4` on both boxes. Test media was removed from both media trees afterwards; ch4 and
  5867's ch3 were left cleared as found.

**Open assumptions (need real Resolume media):**
- that HQ-with-alpha (YG10) colour is straight, not premultiplied;
- that DXT5 semi-transparent edges look right premultiplied. They should: FFmpeg's `dxt4_block` exists because the
  data is premultiplied.

Rollback: `bin/casparcg.pre-wo993` on both boxes (4838ab393), or `<dxv-gpu>false</dxv-gpu>` in the Caspar config's
ffmpeg producer section.
