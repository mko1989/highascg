# WO-790 — Timeline scrub: the channel follows the drag, seeks show sooner

**Status: DONE (27.10 — smokes + offline suite; live on the box: seek probe on PRV 2-210 and API drags with Caspar
polled, before and after; owner QA = drag the ruler in the Godot timeline)**

Owner, 27.10 (after WO-787 / WO-789):
> the seeking function in timeline still lacks quickness, it needs to be as soon as possible. and when i hold mouse
> button and dragging the video channel needs to reflect that imedietly

Parents:
- [WO-787](./787_WO_timeline_preview_and_smooth_scrub.md) (seeks in place with CALL SEEK, client keeps one request in
  flight);
- [WO-753](./753_WO_two_box_test_campaign_and_ubuntu_26_04_verdict.md) (the native build-26 Caspar this patches).

## Investigation

All on the box with the owner's timeline: `INTRO.mov`, NotchLC 3840×1792 25p, 650 Mbit/s, no audio, on PRV channel 2
(50p), layer 210.

1. **The server and AMCP are not the delay.**
   - `POST /api/timelines/:id/seek` answers in ~7 ms; the route does not wait for Caspar
     (`src/api/routes-timeline.js:132-141`).
   - The Caspar log for one seek: `CALL 2-210 SEEK 750` plus 13 MIXER lines and `MIXER 2 COMMIT`, all answered within
     2 ms (08:53:55.786 → .788).
2. **Caspar takes 215–258 ms from CALL SEEK to showing the frame.**
   - Measured with a raw AMCP probe (CALL SEEK, then INFO 2-210 polled until `<time>` = target), 6 seeks on a paused
     layer.
   - The first decoded frame reaches the filter graph ~100 ms after the seek (the buffersrc "Changing video frame
     properties" warning).
3. **Why that long** (src-v2 `src/modules/ffmpeg/producer/av_producer.cpp`):
   - **The decoder is rebuilt on every seek.** `seek_internal` calls `decoders_.clear()` and `reset()`, a new filter
     graph with new decoders.
   - **Decoder threads default to one per core.** `configuration.ffmpeg.producer.threads` defaults to 0, i.e. 28 here,
     and frame threading fills them before the first frame comes out. `ffmpeg -ss 33 -frames:v 1` on INTRO:
     - 1–4 threads: 107–125 ms;
     - 16 threads: 308 ms;
     - auto: 312 ms (~107 ms of that is process start and probe).
     - Throughput for 25 frames is best at 4 threads: 282 ms, against 458 ms on auto.
   - **The filter chain holds frames back.** It always contains `bwdif=…:deint=interlaced` (bwdif keeps one frame back
     even for progressive input) and `fps=50`, which needs the next frame. The first picture needs ~3 decoded frames.
   - Measured in Caspar:
     - auto threads: 215–258 ms;
     - `threads=4`: 178–187 ms;
     - `threads=4` plus `auto-deinterlace=none`: 118–141 ms.
4. **Why nothing moves during a drag.**
   - A CALL SEEK that lands before the previous one has produced a picture throws that picture away (decoders
     rebuilt).
   - The ruler sends a seek per mouse move (~16 ms), but a seek takes ≥120 ms to show, so the channel froze until the
     mouse stopped.
   - Measured with raw CALL SEEKs every 16 ms (10 → 22 s over 1.9 s): **no picture change while dragging**; 22 s showed
     at release.
5. **Codecs on the box** (80 media files):
   - prores / hap / h264: flagged `progressive`;
   - notchlc: field_order `unknown`, but the codec is progressive-only;
   - dvvideo (2 files): `unknown`, interlaced.

   At 4 threads, h264 4072×2036 50p decodes ~5.5 ms/frame and ProRes 2560×1024 ~5.8 ms/frame, far inside real time.

## What was done

- **Caspar** (fork src-v2 `4eab31c06` on `wo742-shm-producer`; exported to
  `caspar/patches/wo790-ffmpeg-skip-bwdif-progressive.patch`): `video_is_progressive()`.
  - bwdif is left out when every video stream is flagged progressive or is NotchLC / HAP / DXV.
  - Every other stream (DV, unflagged files, cover art) keeps it, so interlaced material is still deinterlaced.
  - Chosen over a global `auto-deinterlace=none`, which would stop deinterlacing the DV files.
- **`src/config/config-generator.js`** and the box's live `config/casparcg.config`:
  `<ffmpeg><producer><threads>4</threads></producer></ffmpeg>`, with a comment giving the reason.
- **New `src/engine/timeline-scrub-gate.js`** (`scrubSeek`, `cancelScrub`): one seek per Caspar layer in flight.
  - The next seek waits until OSC `file/time` of that layer has moved since the send and sits at the target (a source
    frame of slack below, up to 0.3 s past while playing). It is polled every 4 ms from the in-memory OscState, which is
    updated on every OSC message. If OSC never confirms, the layer is released after `MAX_WAIT_MS` = 300 ms.
  - Only the newest target waits, so the drag always ends where the mouse stopped.
  - Chosen over a fixed rate limit: Caspar's seek time varies with file and load, and the OSC answer is the actual
    "picture is up" signal.
- **`timeline-playback-amcp-send.js`**:
  - Both scrub branches (plain and looping clip) go through `scrubSeek`.
  - `_sendClipTransport` (PLAY / LOAD) and a clip's STOP cancel a waiting seek, so it never lands on a new transport.
- **`timeline-playback-amcp-schedule.js`**: the meta carries `chFps`, which turns caspFrame into file seconds for the
  OSC comparison.
- **`timeline-playback-runtime.js`** `stop()`: clears the gates.
- **Smokes**:
  - New `smoke-wo790-timeline-scrub-pacing.test.js` (5 tests: first-then-newest, MAX_WAIT release, a step back waits
    for OSC to move, cancel, source pins), registered.
  - `smoke-wo787` drag test restated: one CALL SEEK at once; after OSC shows it, only the newest (1550), and never
    STOP + PLAY.
- Not changed:
  - The Godot client already keeps one request in flight with the newest target next (WO-787); a request costs ~7 ms.
  - The 13 neutral MIXER lines per seek cost ~2 ms (WO-787 Not changed).

## Verified

- **Offline suite:** 3397 tests, 3395 pass, 0 fail, 2 skipped. Lint 215 warnings, 0 errors. Prettier OK. No file over
  500 lines. No new unwired exports. npm audit OK.
- **Caspar build:** `build-26.sh` rc 0. Deployed `bin/casparcg` = `2.5.1 4eab31c06` (md5 909fd24b). Rollback:
  `bin/casparcg.pre-wo790` (b5a82b9c = 24db35cca). Caspar RESTART, node restarted, the 14 Auras' programmer restored.
- **Live, paused seek** (raw probe, same 6 targets): **109–136 ms**; was 215–258 ms.
- **Live, drag through the API** (as the Godot client posts: 120 steps 16 ms apart, 10 → 22 s, INFO 2-210 polled):
  - **13 picture changes while dragging**, about one every 150 ms; the old wire had 0.
  - 22 s shown 149 ms after release.
- **Live, drag over a playing timeline** (30 → 42 s): the picture followed in 120–200 ms steps, was at 42 s 241 ms after
  release and kept playing. A playing producer waits for 4 buffered frames after a seek (`next_frame`), hence the extra
  time.
- **Not tested live:** interlaced DV with the new build. Its streams are not in the skip list, so it keeps bwdif (code
  path unchanged).
- **Owner QA:** drag the ruler paused and playing; the PRV picture should move during the drag. Check A/V after a playing
  scrub.
