# WO-820 — NotchLC: native GPU decode in Caspar (spike + build)

**Area:** caspar-build, media
**Status: DONE (29.10, verified on the box: bit-exact offline mirror, PRINT vs FFmpeg max 2/255; frontex_big real-content check: 131 NotchLC files in 2 variants, e2e looks on PGM, stress tests; 2 bugs found and fixed — payload cap and GL pool growth) — deployed binary edd5c8e7; patch `caspar/patches/wo820-notchlc-gpu.patch` regenerated (branch `notchlc`, owner 29.10: separate branch)**

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

**Rollback:** stock = `casparcg.pre-wo820` (16a73673); earlier WO-820 builds `casparcg.wo820-v1` / `casparcg.wo820-v2`.
`cd ~/highascg/bin && cp casparcg.pre-wo820 casparcg.new && mv -f casparcg.new casparcg`, then AMCP
`RESTART` and `kill -TERM $(systemctl show -p MainPID --value highascg)`, re-take the looks. Or keep the binary and set
`<ffmpeg><producer><notchlc-gpu>false</notchlc-gpu></producer></ffmpeg>` in casparcg.config (CPU path, as stock).
Follow-up for the owner: the WO-818 ⚠ tooltip ("decodes it on the CPU") is no longer true with this binary.

## Real content check (frontex_big), 29.10 17:00–17:53

Owner (29.10): "check on really content. There is a lot of notchlc content in the frontex project. Run end to end tests."
Then the addendum: stress the GPU path (stacked layers, L_ on PGM + s_ on PRV, seek/scrub, LOADBG→PLAY, pause/resume, clip
end, NotchLC+HAP mix, 10+ takes with nvidia-smi, Caspar restart with NotchLC on air). Scripts, data, PRINT frames:
`/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo820/frontex/` (`survey.tsv`,
`sizes.tsv`, `onair.log`, `stress/`).

### Investigation

**Survey of `media/projects/frontex_big/NOTCH/` (140 .mov):** 131 NotchLC, 4 HAP (`L_INTRO_HAP`, `s_INTRO_HAP`,
`WIZYTOWKA_L_1_1_HAP`, `WIZYTOWKA_L_1_2_HAP`), **5 unreadable** ("moov atom not found" — truncated exports):
`TLA/S_AKT_3_START`, `S_AKT_3_TYTUL_START`, `S_BAZA_START`, `S_BAZA_PUSTY_START`, `S_AKT_1_START`. All NotchLC files are
30 fps, yuva444p12le with alpha encoded, pcm_s16le audio, LZ4; sizes are multiples of 16 (no odd-size case).

| variant | files | avg / max bitrate | total | max payload (`nlcsizes`) | max packet | unpack (CPU) |
|---|---|---|---|---|---|---|
| 1920×2304 (`s_`, `S_`) | 56 | 371 / 636 Mbps | 1634 s | **1.668 B/px** (s_INTRO frame 2250) | 3.0 MB | ≤ 2.9 ms |
| 5760×1728 (`L_`, TLA) | 75 | 1413 / 1853 Mbps | 1922 s | **1.556 B/px** (L_INTRO frame 2251) | 8.6 MB | ≤ 3.3 ms |

(INTRO_v3, the clip of the first test: 0.844 B/px.) The encoder stores ~0.5 B/px of alpha data where FFmpeg reads 8 bytes
per 16×16 block, so the payload is not bounded by the format.

**Bug 1 — big frames drawn transparent (found on air, PGM 17:04:53):** log `NotchLC GPU path: undecodable frame (payload
larger than the plane), drawn transparent`. `notchlc.h` capped the payload at 1.5 B/px + 64 KiB; s_INTRO has 7 frames and
L_INTRO 4 frames (around 75 s) above it → one transparent frame each, every loop.

**Bug 2 — GL pool growth from per-frame plane heights (found by the 10+ takes test):** the fix for bug 1 sized the plane
per frame (rows in use, 64-row steps). The GL device (`accelerator/ogl/util/device.cpp:208,230`) pools textures and host
buffers per exact size and never frees them (only `GL GC`). After 24 takes: `GL INFO` showed **51 different heights** of
width-1024 (NotchLC) textures = 6.5 GB of pooled device memory; caspar held 18.7 GB GPU memory (nvidia-smi) and 27 GB RSS.

### What was done

- `src/core/frame/notchlc.h`: `max_payload_bytes(w,h)` = 4 B/px + 64 KiB (half of raw yuva444p12; the producer's pooled
  buffers are only touched as far as each frame's real payload).
- `src/modules/ffmpeg/util/av_util.cpp` `make_frame`: the notchlc plane holds only the rows in use, rounded up to a
  **size class** (64 rows, then +25 % steps: 64, 128, 192, 256, 320, 448, 576, 768, 960, 1216, 1536, 1920, 2432, 3072,
  3840, …), so copy/upload follow the real payload (≤ 25 % extra) and the pools see a handful of sizes.
- Rebuilt (`build-26.sh` rc 0) → **edd5c8e7**, deployed; previous builds kept as `bin/casparcg.wo820-v1` (362fa0bd, the
  1.5 B/px build) and `bin/casparcg.wo820-v2` (ad5f37bc, bug 1 fixed, bug 2 present). The patch was regenerated, applied
  to a clean `git archive HEAD` export and compared file by file with the built tree (identical). A 3-line comment in
  av_util.cpp was reworded after the edd5c8e7 build (same line count, no code change).

### What was VERIFIED

**Picture vs FFmpeg / vs Caspar's CPU path** (offline mirror = real unpack + C++ copy of the shader; on the box `PRINT` of
a 1:1 crop over black, PRV ch2):

| clip (variant) | offline Y/U/V/A mismatches | on box GPU vs FFmpeg (mean / max / PSNR) | GPU vs Caspar CPU path |
|---|---|---|---|
| L_INTRO 5760×1728 (3, 51.2, 75.03, 101.6 s) | 0 (start, mid, end, 74.9 s +12) | 0.07–0.21 / 2 / 55.0–58.9 dB | max 1, 68.0–74.5 dB |
| L_OUTRO 5760×1728 (17.5 s) | 0 | 0.32 / 2 / 53.1 dB | max 1, 65.8 dB |
| BAZA_TLO_BAZA_LOOP 5760×1728 (1, 40, 79.5 s) | 0 | 0.18 / 2 / 55.5 dB | max 1, 68.7 dB |
| WIZYTOWKA_L_1_1 / _1_2 5760×1728, alpha (0.3–5 s) | 0 | 0.07–0.31 / 2 / 53.2–59.8 dB | max 1, 66.0–72.7 dB |
| s_INTRO 1920×2304 (3, 51.2, 75.0, 75.1, 101.6 s) | 0 (incl. 74.9 s +12) | 0.08–0.21 / 1 / 54.9–58.9 dB | max 1, 66.5–74.5 dB |
| S_BAZA_LOOP 1920×2304 (1, 40, 79.5 s) | 0 | 0.23 / 1 / 54.5 dB | max 1, 67.3 dB |

Offline RGB vs swscale max 0.062. The GPU path is consistently a little closer to FFmpeg than Caspar's own CPU path.
Alpha (WIZYTOWKA over black, in the stack test over other layers) composites the same as the CPU path.

**End to end through HighAsCG looks (frontex_big loaded 17:01 with `POST /api/project/load`, takes with
`POST /api/scene/take-look`):** Look 4 (L_INTRO, main 1 → ch3) + Look 4 s (s_INTRO, main 0 → ch1), Look 2 (BAZA_TLO,
ch3), Look 3 (S_BAZA_LOOP, ch1); PRV, then PGM. OSC (UDP :6250) over 150 s on edd's predecessor ad5f37bc: ch1 wrapped
102.28 → 0 and ch3 79.98 → 0 cleanly, no repeated ticks, media time = wall time; after bug 1 no undecodable warning across
75 s and both loop points. A NotchLC → NotchLC take logs one `Latency: 0` (one repeated frame of the outgoing clip) — the
same as any ffmpeg take.

**CPU, GPU path vs stock CPU path (Look 4 pair on PGM, PRV cleared, 30 s):**

| path | caspar CPU | GPU util | GPU W | CPU pkg avg / max |
|---|---|---|---|---|
| WO-820 GPU path | **125.8 %** | 28 % | 41.0 | 58.4 / 68 °C |
| HAP siblings (Look 5 + 6) | 316.4 % | 34 % | 43.1 | 76.8 / 83 °C |
| stock 16a73673 | **988.8 %** (video-executor 402, av:notchlc 195, workers 357) | 57 % | 52.1 | 85.2 / **92 °C** |

Stock also underflowed: L_INTRO `Latency: 6` at start and ~25 underflows on one NotchLC → NotchLC take, including
`Latency: 40` (0.8 s freeze); the GPU path: one per take. Other loads (GPU path): base 80.5 %; 2 NotchLC looks on PRV
141.7 %; 4 NotchLC layers PGM+PRV 210.6 %; 2 HAP PGM + 2 NotchLC PRV 392.8 %.

**Stress (binaries ad5f37bc, then edd5c8e7; picture checks repeated on edd5c8e7 with identical numbers):**

| test | result |
|---|---|
| T1: 5 NotchLC layers on PGM ch1 (BAZA_TLO, L_INTRO opacity 0.7, WIZYTOWKA alpha, S_BAZA FILL, s_INTRO FILL+ROTATION 12) | GPU vs CPU path max 2 / 67.2 dB (0.5 s), max 1 / 68.2 dB (5 s); playing: caspar 266 %, GPU 46 %, 70 W, pkg max 66 °C; no mid-play underflow |
| T6: NotchLC + HAP mixed (L_INTRO, WIZYTOWKA_HAP opacity 0.8, s_INTRO FILL) | max 1, 77.1 dB |
| T2: PGM ch1 L_INTRO + BAZA_TLO, ch3 Look 4 L_INTRO; PRV ch2 s_INTRO + S_BAZA_LOOP, ch4 s_INTRO (6 NotchLC streams) | caspar 274.5 %, GPU 48 %, 67.7 W, pkg max 70 °C; OSC 30 s on ch1/2/3/4: no repeats, 0 media-vs-wall mismatches; only start `Latency` lines |
| T3a: 40 `CALL SEEK` in 0.01 s on L_INTRO while playing, then SEEK 2500 + PAUSE | time 50.0 s; picture vs CPU path max 1, 66.3 dB |
| T3b: `LOADBG … SEEK 1000` → `PLAY` → 2 s → `PAUSE` | time 23.48 s; max 1, 71.5 dB |
| T4: PAUSE 2 s / RESUME | time frozen 4.46 → 4.46, two PRINTs identical (max 0); resumed +3.5 s after 2 s |
| T5: WIZYTOWKA_L_1_1 (10.04 s) without LOOP | last frame held at 10.04 s on both paths (same as stock), GPU vs CPU path max 1, 69.5 dB |
| T7: 24 PGM takes (Look 2 ↔ 4 on ch3, Look 3 ↔ 4 s on ch1, 4 s apart) | no errors; 1 `Latency: 0` per take. ad5f37bc: **bug 2**. edd5c8e7: NotchLC pool heights {960, 1216, 1920, 2432, 3072, 3840}, pooled device 1.86 GB, flat between take 12 and 24 |
| T7c: 3 NotchLC layers played 12 s then cleared + `GL GC`, ×5 | RSS while playing 7.7–8.3 GB, after clear 4.5–5.3 GB, GPU 1.7–2.2 GB: no growth across cycles (no leak); the RSS above the 1.9 GB fresh start is freed malloc memory kept by glibc |
| T8: Caspar `RESTART` with Look 4 pair on PGM (also the edd5c8e7 deploy) | back in ~12 s, no NotchLC errors (the boost `local_endpoint` exception at shutdown is pre-existing, also 20.–27.10). HighAsCG re-staged PRV (Look 3 on ch2, Look 10 on ch4) and **cleared the PGM live looks** (`Live scene reconcile … clearing persisted live look`): PGM stays black until the operator takes again — existing HighAsCG behaviour, not NotchLC |

Note for long shows: the GL device's pools never shrink by themselves (stock Caspar); after many different large clips
`GL GC` (AMCP) returns the memory (measured 8.7 → 1.9 GB GPU).

**What went on air** (`onair.log`): PRV ch2 test frames 16:54–17:01; PGM frontex looks from 17:03:38 (ch3 BAZA_TLO,
ch1 s_INTRO, then L_INTRO / S_BAZA_LOOP / HAP siblings / stock binary comparison until 17:24); Caspar `RESTART`s 17:09:4x,
17:20:5x, 17:23:39, 17:37:42 (outputs dropped ~12 s each); PGM ch1 layers 100–105 stress 17:24–17:31 and 17:43–17:50;
takes 17:34–17:42. Restored 17:51–17:53: project `mhp_harder` (rev 287), Intro look on PGM ch1 and PRV ch2, look
149fd497 (blackFHD) on PRV ch4, ch3 empty — as at the start.

**Side effect found and undone:** at 17:10:04 (node restart while frontex_big was active) a client autosave rewrote
`projects/frontex_big.json` and its `_autosave` copy (rev 836 → 837): `/api/project/autosave` injects the box's live
hardware config (`routes-data-project-handlers.js:386`), so the project's own show hardware (5760×1728 / 1920×2304
screens, destinations Main/Kolko) was replaced by this box's. Both files were restored from the backups taken before the
test (md5 3cde5978). Worth knowing before opening a show project on a box with a different hardware config.

**Screenshots** (`…/scratchpad/wo820/frontex/`): `godot_live_pgm.png` (second Godot client on Xvfb, Live tab, Frontex
Big, PGM 1 L10 S_INTRO and PGM 2 L10 BAZA_TLO — thumbnails visible, video tiles black under software GL),
`screen0_caspar_pgm1.png` (Caspar screen output, s_INTRO on PGM), `screen0_pgm_notch.png` (whole :0 at that time),
`screen0_restored.png` (after restore). The owner's client was not restarted (not allowed); it still shows the Frontex
Big deck after the restore — relaunch it.

**Owner QA:** a real frontex show run (all looks, the operator's own takes and transitions); the 5 truncated
`*_START.mov` files need re-export; the WO-818 ⚠ tooltip text; relaunch the Godot client (stale deck).
