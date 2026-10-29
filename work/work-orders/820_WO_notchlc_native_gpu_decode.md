# WO-820 — NotchLC: native GPU decode in Caspar (spike + build)

**Status: DONE (29.10, verified on the box: bit-exact offline mirror, PRINT frame vs FFmpeg max 1/255, PRV + 54 s PGM run; NotchLC PRV +26 % CPU instead of +404 %) — deployed binary 362fa0bd; patch `caspar/patches/wo820-notchlc-gpu.patch` committed on branch `notchlc` (owner 29.10: separate branch); real-content check on frontex_big in progress**

Owner (29.10): "content creators favour notch vs hap lately thats why id like the native handling of notchlc."
Background (performance check 29.10, same session): NotchLC `INTRO_v3.mov` on PRV only ≈ 460 % of a core, PGM+PRV ≈ 918 %
(peak 1065 %); the HAP version 175 % / 301 %. CPU package 84–88 °C while playing. HAP transcode alone was ruled out.
Related: [WO-818](./818_WO_notchlc_warning_mark.md) (⚠ mark), [WO-790](./790_WO_timeline_scrub_paced_and_faster_seek.md)
(NotchLC skips bwdif), [WO-800](./800_WO_per_layer_audio_monitoring.md) (current deployed binary, uncommitted in src-v2).

## Investigation (spike, step 1)

### a. The format — read from FFmpeg 8.0.1 `libavcodec/notchlc.c`

Source: no deb-src on this box (`/etc/apt/sources.list.d/ubuntu.sources` has deb-src commented out), so the five files
were fetched from the FFmpeg git mirror at tag `n8.0.1` (`libavcodec/notchlc.c`, `lzf.c`, `hapdec.c`, `texturedsp*.c`)
into the session scratchpad (`…/scratchpad/wo820/ffsrc/`). Line numbers below are `notchlc.c` at n8.0.1.

**NotchLC is not a DXT/BC texture format and it is not YCoCg.** It is a custom block codec:

- **Packet header** (16 bytes, `decode_frame` l.478-491): le32 magic `MKBETAG('N','L','C','1')` (bytes `1CLN` on disk),
  le32 `uncompressed_size`, le32 `compressed_size`, le32 `format`. Packets ≤ 40 bytes are invalid; `format` > 2 →
  PATCHWELCOME.
- **Outer compression** (l.493-518): `format 0` = LZF (`ff_lzf_uncompress`), `format 1` = **LZ4 block format** (plain LZ4
  sequences: token, literal length ext., le16 match offset, match length ≥ 4; l.77-152 decodes it through a 64 KiB
  history ring), `format 2` = stored. Every frame of `INTRO_v3.mov` is `format 1` (LZ4), 670 806 B packet → 3 242 015 B
  (ratio 4.83). The decoder's LZ4 output is byte-identical to liblz4's `LZ4_decompress_safe` (probe below).
- **Payload header** (40 bytes, `decode_blocks` l.164-227): le32 `texture_size_x`, `texture_size_y`, then
  `uv_offset_data_offset`, `y_control_data_offset`, `a_control_word_offset`, `uv_data_offset` (each ×4 → bytes),
  `y_data_size` (bytes), `a_data_offset` ×4, `a_count_size` ×4, `data_end` (bytes). Derived: `y_data_row_offsets` = 40,
  `y_data_offset = data_end − y_data_size`, `uv_count_offset = y_data_offset − a_data_offset`; alpha is opaque when
  `uv_count_offset == a_control_word_offset` (l.283). INTRO_v3: 3840×1792, opaque.
- **Luma, 12 bit, 4×4 blocks** (l.245-278): one le32 control word per block (raster order from `y_control_data_offset`):
  `y_min` (12 bit), `y_max` (12 bit), four 2-bit `control[i]` = bits-per-pixel − 1 for block row i (1–4 bits). Each block
  row has a le32 byte offset (table at byte 40) into an **LSB-first bit stream** at `y_data_offset`; pixel =
  `clip12(y_min + ((y_max−y_min)·v + div−1) / div)`, `div = 2^bits − 1`. Variable bits per block → a block's bit position is
  the running sum over the blocks to its left (sequential within a block row).
- **Chroma, 8-bit endpoints expanded to 12 bit, per 16×16 block** (l.350-464): le32 offset per block → `is8x8` (le16) and
  `escape` (le16); either one BC1-like endpoint pair (u0 v0 u1 v1 + 2-bit index per 4×4 cell, l.369-393), or per 8×8
  quadrant one pair with 2-bit indices per 2×2 cell (`is8x8` bit), or four pairs with a 2-bit index per pixel (`escape`),
  or zero. Value = `e0 + ((e1−e0)·idx + 2) / 3`, endpoints `(b << 4) | (b & 0xF)`.
- **Alpha** (l.280-348): opaque fast path, else per 16×16 block a 2-bit mode per 4×4 cell (0, 4095, or
  `(a0 + (a1−a0)·idx3) << 4` from a 64-bit control word).
- **Output** (`decode_init` l.64-73): `AV_PIX_FMT_YUVA444P12`, full range, `colorspace = AVCOL_SPC_RGB` (ffprobe: `gbr`),
  BT.709 primaries, sRGB transfer. Frame threading only (`AV_CODEC_CAP_FRAME_THREADS`, l.550), no hwaccel.

**What Caspar does with it** (`src-v2/src/modules/ffmpeg/producer/av_producer.cpp`): the buffersink accepts a fixed list
(l.613-640) that has **no YUVA444P12 / GBRAP12**, so `avfilter_graph_config` auto-inserts swscale: probed with the same
chain in the ffmpeg CLI — `auto_scale_0 … fmt:yuva444p12le csp:gbr range:pc -> fmt:gbrap16le` (55 MB per 3840×1792
frame). `make_frame` (`util/av_util.cpp:46-111`) then memcpy's all four 16-bit planes into the mixer buffer for **every
output frame** — the channel is 50p (`config/casparcg.config` video-mode 3840x1792, time-scale 50000/1000) and the clip
25p, so the `fps` filter hands each decoded frame over twice: 2 × 55 MB copies + 2 × 55 MB uploads per source frame
(2.75 GB/s per layer). Fitted on a dumped frame, swscale treats the planes as **full-range BT.601 YCbCr**
(R = Y + 1.401·(V−½), G = Y − 0.344·(U−½) − 0.714·(V−½), B = Y + 1.773·(U−½), rms error < 0.4/255) — that is the look on
air today, and the reference for any GPU path. Alpha 4095 becomes 65520/65535.

There is **no HAP GPU path in Caspar either**: `hapdec.c` decodes Snappy and then DXT→RGBA on the CPU (texturedsp); HAP is
cheaper because its CPU output is 8-bit RGBA that needs no swscale.

### b. The measured split (ffmpeg alone, no Caspar)

Probe `…/scratchpad/wo820/probe/nlcprobe.c` (libavformat packets in RAM, 250 frames, pinned to P-core 4, per frame CPU):

| stage | ms / frame | % of one core at 25 fps |
|---|---|---|
| LZ4 (FFmpeg's ring algorithm) | 1.34 | 3 % |
| LZ4 (liblz4, identical output) | 0.38 | 1 % |
| block decode (full avcodec decode − LZ4) | 16.8 | 42 % |
| swscale yuva444p12 → gbrap16 (1 thread) | 25.8 | 65 % |

Whole clip with the ffmpeg CLI (1583 frames, 63.3 s of media, `bash time`):

| run | wall | CPU (user) | = % of a core at real time |
|---|---|---|---|
| decode only, `-threads 1` | 33.4 s | 33.3 s | 53 % |
| decode only, `-threads 4` (Caspar's config value) | 8.4 s | 32.9 s | 52 % |
| decode only, `-threads 0` (auto, 28) | 5.1 s | 58.3 s | 92 % |
| decode (4) + convert to gbrap16, filter threads 1 | 22.9 s | 56.0 s | 88 % |
| decode + convert, all threads auto (what Caspar's graph does) | 10.2 s | 165.2 s | **261 %** |

In Caspar (deployed `2.5.1 4eab31c06` + WO-800), `PLAY 2-90 INTRO_v3 LOOP` on PRV, 20 s `top -H` grouped by thread
name: total 510 % vs 103 % idle → **+407 %**. NotchLC decoder threads (`av:notchlc:dfN`) **59 %**; `video-executor`
(filter graph incl. swscale) **187 %**; unnamed `casparcg` workers (avfilter slice threads + TBB memcpy) **+155 %** over
idle. So in Caspar the decode is ~15 % of the NotchLC cost and the LZ4 step ~1 %; ~85 % is the 12-bit → 16-bit RGB
conversion (threaded swscale overhead) and moving 55 MB frames twice per source frame.

### c. Decision: the GPU path pays off

The part a GPU takes over (block decode + colour conversion + the 16-bit planar copies) is ≈ 99 % of the NotchLC cost in
Caspar; LZ4 is 1–3 %. A CPU-only change (threads, faster LZ4) cannot reach it: LZ4 is already the cheapest step, and the
block decode is only 59 %. Plan (same shape as the brief, adapted to the real format): the ffmpeg producer does only
LZ4/LZF on the CPU plus a per-block bit-offset table for the variable-length luma, passes the result as a small payload
frame (~5 MB instead of 55 MB, through the normal filter graph, so `fps`/seek/loop keep working), and the GL device decodes
it in a fragment shader into an RGBA16 texture (full-range BT.601, same as today), which the normal image kernel then
samples like any frame. Everything after the mixer (screen, previews, PRINT/thumbnails, recording, route://, shm) gets the
mixed RGBA channel output exactly as before — nothing in Caspar reads producer frames on the CPU (checked:
`image_data(` users are consumers of channel frames, `pixel_format_desc()` users are the mixer and `make_av_video_frame`).
Fallback to the CPU path (unchanged) when: config `ffmpeg.producer.notchlc-gpu` is false, a user video filter is set,
the size is not a multiple of 16, or the stream is not NotchLC.

## What was done (step 2)

Built in the Caspar worktree `~/caspar-build/src-v2` (2.5.1 base + uncommitted WO-800, which is NOT in this patch).
Nothing committed there; the change is **`caspar/patches/wo820-notchlc-gpu.patch`** (12 files, `git apply` checked against
a clean `git archive HEAD` export, result byte-identical to the built tree).

- `src/core/frame/notchlc.h` (new): the payload plane layout shared by producer and mixer — 16-word header (magic, valid,
  size, table/offset fields, opaque flag), then the LZ4 output, then the luma block table; `plane_rows(w,h)` = rows of
  4096 bytes for the worst case.
- `src/core/frame/pixel_format.h`: `pixel_format::notchlc` (before `count`).
- `src/modules/ffmpeg/util/notchlc_unpack.{h,cpp}` (new): CPU half — LZ4 block / LZF / stored into the plane, every check
  of `notchlc.c` `decode_frame`/`decode_blocks` plus the bounds the shader relies on, and the per-4×4-block absolute bit
  position table (the only sequential part of the luma). 1.4–1.9 ms per 4K frame. On a bad packet it writes an invalid
  header (frame drawn transparent, one warning per layer).
- `src/modules/ffmpeg/producer/av_producer.cpp`: `Decoder` gets a NotchLC GPU mode (codec NotchLC, size multiple of 16,
  no user `VF`/`FILTER`, config `ffmpeg.producer.notchlc-gpu` not false — default on). It does not open the FFmpeg
  decoder; packets are unpacked into pooled GRAY8 frames (4096 × plane_rows, tagged `highascg_notchlc_payload`) with
  the packet's pts/duration, so the normal filter graph (`fps`, seek, loop, in/out) runs unchanged; the sink accepts only
  GRAY8 in that mode, so no swscale is inserted.
- `src/modules/ffmpeg/util/av_util.{h,cpp}`: `make_frame` turns a tagged GRAY8 frame into one `notchlc` plane
  (1024 BGRA texels per row) and copies only the rows in use (~3.3 MB instead of 55 MB for INTRO_v3).
- `src/accelerator/ogl/image/notchlc_kernel.{h,cpp}` (new) + `image_mixer.cpp`: at frame commit the plane is uploaded and
  a GLSL 4.50 fragment pass decodes luma/chroma/alpha per pixel (mirrors `notchlc.c` l.245-464) and converts full-range
  BT.601 → RGB (the look swscale gives today) into an RGBA16 texture; `visit()` hands the image kernel that texture as a
  16-bit bgra frame. Everything downstream (mixer transforms, keys, consumers, PRINT, route://) is untouched.
- Why this split and not a full GPU decode: the LZ4 stream is sequential (1–3 % of the cost), the luma bit positions
  need a running sum; both are cheap on the CPU, and everything per pixel goes to the GPU.

## What was VERIFIED

- **Offline, bit-exact:** `…/scratchpad/wo820/probe/mirror.cpp` = the real `notchlc_unpack.cpp` + a line-for-line C++ copy
  of the shader, against FFmpeg's decoder: **0 mismatching Y/U/V/A samples** on INTRO_v3 (12 frames),
  AKT_3_TLO_BAZA_LOOP 5760×1728, S_AKT_3_TYTUL_LOOP 1920×2304, BUMPER, WIZYTOWKA_L_1_1 (alpha, 16 frames). RGB formula vs
  swscale gbrap16: mean 0.01–0.02, max 0.06 (8-bit units).
- **Build:** `build-26.sh` rc 0, no new warnings. First box run showed R/B swapped (a bgra frame's texture holds natural
  RGBA order) → shader writes `vec4(rgb, a)`; rebuilt, binary **362fa0bd**.
- **On the box (PRV, `PRINT 2`):** INTRO_v3 paused at 20 s vs FFmpeg frame 500: PSNR 52.8 dB, mean 0.34, **max 1/255**.
  WIZYTOWKA_L_1_1 (alpha) at 0.5 s: alpha mean diff 0.04 vs FFmpeg; vs Caspar's own CPU path on the same binary
  (`VF "null"` forces it) RGB mean 0.06, alpha max 1 — remaining outliers are PRINT un-premultiplying 1-LSB differences at
  low alpha (the clip's colour exceeds alpha, wraps the same way on the stock path). No errors in the Caspar log.
- **Load, 20 s windows (`top`, `top -H`, `nvidia-smi -l 1`, `sensors`):**

| state | binary | caspar CPU | GPU util | GPU W | GPU °C | CPU pkg avg/max °C |
|---|---|---|---|---|---|---|
| base (Intro look) | stock 16a73673 | 86.5 % | 30 % | 37.5 | 56 | 84.5 / 90 (other load at the time) |
| + NotchLC PRV | stock | **490.2 %** (+404) | 44 % | 52.0 | 58 | 70 / 84 |
| PGM+PRV NotchLC (earlier check) | stock | 918 % (peak 1065) | – | – | – | 84–88 |
| base | WO-820 362fa0bd | 72.5 % | 22 % | 31.6 | 55 | 53.1 / 57 |
| + NotchLC PRV | WO-820 | **98.2 %** (+26) | 31 % | 40.2 | 56 | 58.3 / 67 |
| + NotchLC PGM and PRV | WO-820 | **123.3 %** (+51) | 33 % | 46.4 | 59 | 56.6 / 62 |

  Thread groups stock PRV: video-executor 180, av:notchlc 59, casparcg workers 229; WO-820 PRV: casparcg 85 (no
  video-executor / decoder threads above 3 %). NotchLC is now cheaper than HAP on the CPU (HAP 175 % / 301 %).
- **What went on air:** Caspar `RESTART` 16:29:45 and 16:34:21 (binary swaps; node restarted after each, PGM Intro look
  re-taken via `POST /api/scene/take-look`, PRV re-taken at the end). PRV 2-90: INTRO_v3 / WIZYTOWKA test clips
  16:33–16:41. **PGM 1-190: INTRO_v3 loop on top of the Intro look, 16:39:44–16:40:38 (54 s)**, then cleared. End state:
  PGM 110-112 and PRV 10-12 = Intro look (INTRO_HAP + 2 wavs); test PNGs moved out of media/.
- Owner QA: a real show with NotchLC content; a NotchLC clip with mixer transforms/keys; LZF/stored-format files (none
  in media/, handled by the same code as FFmpeg).

**Rollback:** `cd ~/highascg/bin && cp casparcg.pre-wo820 casparcg.new && mv -f casparcg.new casparcg`, then AMCP
`RESTART` and `kill -TERM $(systemctl show -p MainPID --value highascg)`, re-take the looks. Or keep the binary and set
`<ffmpeg><producer><notchlc-gpu>false</notchlc-gpu></producer></ffmpeg>` in casparcg.config (CPU path, as stock).
Follow-up for the owner: the WO-818 ⚠ tooltip ("decodes it on the CPU") is no longer true with this binary.
