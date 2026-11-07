# WO-991 — ProRes (and every FFmpeg clip) playback CPU in Caspar: the per-row TBB copy and duplicate frames

**Area:** caspar-build, engine
**Status: DONE (07.11.26, the PRV 4K ProRes HQ loop went from 260 % to 166 % Caspar CPU; a lossless capture shows 263 frames bit-identical and no frozen runs; NotchLC with and without audio plays; deployed to both boxes)**

Owner, 07.11: *"While on it figure out if we can get better performance on ProRes playback."* This follows WO-982,
which put ~250 % of Caspar on one clip: PRV ch3 layer 10, `Tła na diodę/abstract-falling-neon-lines…utc.mov`.

## Investigation

The measurement was delegated to an agent and its key claims were checked in the source. Probes, data and test
media are in `scratchpad/prores/` of this session: `probe/prprobe.c` is a libav mirror of Caspar's decoder, graph and
copy, and `probe/tbbcopy.cpp` emulates `make_frame`.

- **The clip:** ProRes **HQ** (apch), yuv422p10le, 3840x2160, **30p**, 300 frames, 610 Mbit/s, on a 50p channel.
- **Decode ≈ 120 %.** It is frame-threaded with 4 threads (`av_producer.cpp:226-227` sets only `threads`; FFmpeg's
  default thread_type picks frame threads), at 40 ms CPU per frame × 30 fps. Thread count makes almost no difference:
  1/2/4 threads give 39.6/39.9/39.8 ms, 8 gives 42.0, 16 gives 48, and auto (0) gives 46.7. Slice threading is the
  same. **Keep `<threads>4</threads>`**; 0/auto costs about 17 % more. FFmpeg 8.0.1 has no hardware ProRes decoder.
- **The filter graph is ≈ 0.** It is `null,fps=fps=50/1`; bwdif is skipped because the stream is progressive (WO-790).
  yuv422p10le is in the buffersink list (`av_producer.cpp:712`), so **no swscale is inserted**. The probe runs the
  same graph at 0.01 ms per output frame.
  - This corrects WO-982's reading of the "unnamed threads" as filter or swscale.
- **`make_frame` copy ≈ 70–90 %.** `util/av_util.cpp:91-98` (before this change) ran one `tbb::parallel_for` task
  **per row** for every 33 MB frame.
  - Caspar is pinned to cores 0-15, so the TBB pool has 15 workers. Live, all 15 sat at 5.4–5.9 % with ~1550
    involuntary context switches per second each.
  - The emulation matches that fingerprint: **14.4 ms CPU per copy, 72 % of a core at 50 copies/s**. A plain memcpy
    is 3.2 ms (16 %).
- **The copy runs once per output frame.** fps duplicates every 30p picture by reference: a new AVFrame on the same
  refcounted buffer. `make_frame` still ran for each output frame (`av_producer.cpp:1107`), costing a new host buffer,
  a 33 MB copy and a 33 MB GPU upload. That is ×1.67 at 30p and ×2 at 25p.
  - Textures are made when the frame is committed and kept in its opaque (`accelerator/ogl/image/image_mixer.cpp:
    312-325, 365-385`). So a reused frame skips both the copy and the upload, and for NotchLC also the GPU decode.
- **Thread names.** `[ffmpeg::av_producer]`, `[ffmpeg::av_producer::Input]`, `AMCPCommandQueue…` and others are
  longer than Linux's 15-byte limit. `pthread_setname_np` returned ERANGE and set nothing
  (`common/os/linux/thread.cpp:8`), so all of them showed as "casparcg" in `top -H`.
- **The "Changing video frame properties on the fly" warning every 10 s is harmless.** On each loop `seek_internal`
  rebuilds the graph, the buffersrc args carry no colorspace or range (`av_producer.cpp:649-651`), and the first
  bt709/tv frame logs one WARNING. There is no rebuild, no conversion and no CPU worth counting. Left as is.
- **Not done, larger:**
  - Native 10/12-bit YUVA sink formats for ProRes 4444 with alpha. Today swscale converts to gbrap16le, at about
    41–54 ms CPU per 4K frame. That needs a picture A/B for straight versus premultiplied alpha.
  - Zero-copy decoding into Caspar's mapped buffers (`get_buffer2`).
  - `graph->nb_threads = 1`, which only matters where swscale is inserted.
  - The big lever stays the media itself: LT is −59 % decode, Proxy −75 %, and HAP is better still (WO-982).

## What was done

Caspar `highascg-main` **e8bbf87f3**; patch `caspar/patches/wo991-ffmpeg-copy-and-dup-reuse.patch`.

- `src/modules/ffmpeg/util/av_util.cpp`: one memcpy per plane when strides match, otherwise a serial row loop. No
  TBB task per row.
  - Serial, not a small arena: the emulation gave arena(4) 34 %, arena(2) 23 % and serial 16 %. 3 ms per 4K frame
    sits easily inside the producer's frame buffer.
- `src/modules/ffmpeg/producer/av_producer.cpp`: reuses the frame for fps duplicates.
  - When a **video-only** output frame has the same `data[0]`, format and size as the previous one, it reuses the
    `draw_frame` made for it.
  - `prev_video_` holds a reference, so an equal pointer can't be a recycled buffer.
  - Frames with audio always take the old path, because each carries its own samples.
- `src/common/os/linux/thread.cpp`: names are cut to 15 bytes on a UTF-8 boundary instead of silently failing.

## What was VERIFIED

All on this box, PRV playing the neon clip, under the box2 lock:

| | old 379d81917 | new e8bbf87f3 |
|---|---|---|
| Caspar CPU, 30 s window | **260 %** | 175 % right after the restart, **166 %** steady |
| "casparcg"-named threads (the TBB pool + unnamed) | 120.6 % | 7.9 % |

- **Picture.** A lossless capture of ch3 (`ADD 3 FILE … -codec:v ffv1`, 14 s, more than one full loop) was taken
  with each build, and the per-frame MD5s compared.
  - **263 distinct frames are bit-identical in both.** 16 per side appear in only one capture.
  - For each of those 16, the nearest frame in the other capture differs by the same amount as the frame next to it
    (mean |diff| 0.28–0.41 vs 0.28–0.43). So they are neighbouring source frames that the FILE consumer missed, not
    altered pixels. Both captures miss frames under load: 279 of 300 distinct each.
  - No run of 3 or more identical output frames in either capture, so the reuse froze nothing.
- **NotchLC 5760x1728 30p on PRV layer 20** (12 s cuts of `AKT_1_TLO_BAZA_LOOP`, video-only and with PCM audio):
  both play and move, no runs of 3 or more, no new errors.
  - The audio could not be checked by ear or by level: PRV's mixer volume is 0, so the capture is silent at -91 dB.
  - Audio frames never take the new branch; they run exactly the old `make_frame` call.
- `nmap`/reset and WO-990 behaviour are unchanged (same AsyncEventServer).
- The OAL "Failed to initialize audio device" exception at every Caspar start predates this; it also appears at
  10:11 on the old binary.
- **Newly visible thanks to the names:** `AMCPCommandQueue` uses ~15.6 % steady. That was first read as AMCP
  traffic from node; it is the TBB pool, which inherited the name and was still woken per frame (fixed in WO-992).
  `decklink_producer` uses ~6 %.

Rollback: `bin/casparcg.pre-wo991` on both boxes (379d81917).
