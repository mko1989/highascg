# WO-992 — Caspar's "AMCPCommandQueue" thread at ~15 % of a core: the TBB pool woken on every frame
**Area:** caspar-build, engine
**Status: DONE (07.11.26, AMCP-named threads 16.0 → 1.7 % on this box, 2.2 % on highascg5867; lossless ch3 capture bit-identical to e8bbf87f3; 1 kHz tone reads the same level through make_frame; deployed to both boxes as 4838ab393)**

Owner, 07.11, after WO-991 made thread names visible: *"Caspar's AMCP command thread uses about 15% of a core
steadily… Definitely look into it."*

## Investigation

- **It is not AMCP traffic.** A 60 s window of the Caspar log had no `Received message` lines; node sends nothing
  steady.
- **It is not one thread.** The main pid had ~80 threads named `AMCPCommandQueu`. Linux threads inherit `comm`
  from their creator, and anything created lazily from an AMCP command (a LOAD/PLAY/ADD runs there) carries that
  name.
  - 15 of them started at the same tick, run on cores 0-15 like the TBB pool, and had ~1.55 M involuntary context
    switches each.
  - Per 10 s: each one used ~1 % CPU, with **~1400 involuntary and ~150 voluntary context switches per second**.
  - That is the TBB worker pool: it was created from an AMCP thread, it wakes ~150 times per second, and it spins
    (yield, then preemption) before going back to sleep.
- **Who wakes it 150 times per second.** A grep of `src/` for `parallel_for`, `parallel_invoke`, `task_group`,
  `task_arena` and `execution::par` found only two per-frame users after WO-991:
  - `modules/ffmpeg/util/av_util.cpp:91`, `make_frame`: a `tbb::parallel_invoke(video copy, audio copy)` for every
    frame of every FFmpeg, DeckLink, NDI and image layer. This box had one clip (PRV ch3, 30 copies/s after WO-991)
    and a DeckLink input on ch4 (no signal).
  - `modules/ffmpeg/consumer/ffmpeg_consumer.cpp:684`: a `tbb::parallel_invoke(video send, audio send)` per
    frame. Node keeps three of these consumers on ch3/4/5:
    `ADD n-720 STREAM udp://127.0.0.1:5200n?localport=6200n -format s16le` (the per-channel PCM feed).
  - These are **audio-only**, so one side of the invoke is empty. 3 × 50 fps = 150 hand-offs/s, which matches the
    voluntary-switch rate.
- Other TBB users only fire when they're configured:
  - the DeckLink consumer (`v210_strategies.cpp:336` for `pixel-format yuv`, and `decklink_consumer.cpp:1019`
    secondary ports);
  - the HTML producer's 4-way memcpy, which is Windows-only (`html_producer.cpp:371`).
- **Not removable this way, measured for a follow-up: highascg5867's DeckLink consumer, 380 % of 415 %.**
  - It drives a DeckLink 8K Pro as two 2160p50 outputs (device 3, plus port device 4 with `src-x 3840`) with
    `<pixel-format>yuv</pixel-format>`.
  - Every frame is packed RGBA16→v210 on the CPU in `tbb::parallel_for(0, 6, …)` (`v210_strategies.cpp:330-336`).
    That is real work (2 × 4K50) plus pool spin: each worker has ~1400 involuntary switches/s there too.
  - The levers are a GPU-side v210 pack (a shader into the download buffer), or `pixel-format bgra` if 8-bit is
    acceptable on that output. The second is a config and picture decision for the owner, not done here.
  - Its `Failed to enable external keyer` errors predate this WO (12:42, 13:08 on older builds).

## What was done

Caspar `highascg-main` **4838ab393**; patch `caspar/patches/wo992-ffmpeg-no-tbb-handoff-per-frame.patch`.

- `src/modules/ffmpeg/util/av_util.cpp` `make_frame`: the video copy, then the audio copy, on the calling thread.
  - The audio copy is a few microseconds (one memcpy, or a 16-channel re-pack).
  - The video copy has been one memcpy per plane since WO-991.
  - Overlapping the two bought nothing and cost a pool wake per frame.
- `src/modules/ffmpeg/consumer/ffmpeg_consumer.cpp`: `parallel_invoke` only when the consumer has **both** a video
  and an audio stream. A real recording (FILE with audio) still encodes the two in parallel. A single-stream
  consumer calls `send` directly.
- Why not a smaller arena or `global_control` capping parallelism? The pool still wakes for a one-task arena. The
  DeckLink v210 pack wants its 6 threads. Removing the needless hand-offs is the change with no downside.

## What was VERIFIED

This box, PRV ch3 playing the 4K ProRes neon loop, ch4 DeckLink input, three PCM consumers, under the box2 lock.
Caspar CPU over 30 s windows (`scratchpad/prores/cpu.sh`):

| | e8bbf87f3 (WO-991) | make_frame only | 4838ab393 (both) |
|---|---|---|---|
| Caspar total | 168 % | 159 % | **151–152 %** |
| `AMCPCommandQueu` threads | 16.0 % | 9.6 % | **1.7–1.8 %** |
| TBB worker involuntary switches | ~1400/s each | — | ≤ 5 each since start |

- **highascg5867** (deployed, rollback `bin/casparcg.pre-wo992`): `AMCPCommandQueu` 2.2 %. Its DeckLink consumer
  load is the follow-up above, unchanged by this WO.
- **PCM consumers:** `INFO 3` port 720 `frame` advances at exactly 50.0 frames/s on the new build (20 s
  window). Node kept receiving: no reconnects and no errors in the Caspar log after the swap.
- **Audio through make_frame:** a 10 s clip `media/zz_wo992_tone.mov` (testsrc2 + a 1 kHz sine at 1/8 amplitude,
  PCM) played on PRV 3-30. OSC `/channel/3/mixer/audio/layer/30/volume` read 189 792 256 on both channels, which is
  the RMS of that sine in int32 (0.125 × 0.707 × 2³¹). The layer was stopped and cleared afterwards, as found.
- **Picture:** a lossless ch3 capture (`ADD 3 FILE … ffv1`, 14 s, 543 frames) was compared with the e8bbf87f3
  capture from WO-991.
  - **265 distinct frames are bit-identical**; 17 and 14 frames appear on one side only.
  - `nearest.py` puts each of those next to its neighbour at the neighbour-to-neighbour distance (mean |diff|
    0.18–0.42). These are frames the FILE consumer missed, as in WO-991.
  - Run lengths are 1 and 2 only (the 30→50 pattern), so nothing froze.
- **Logs:** the only `[error]` after each start is the OAL "Failed to initialize audio device", which predates WO-991.
  `VERSION` is `2.5.1 4838ab393` on both boxes.

Rollback: `bin/casparcg.pre-wo992` on both boxes (e8bbf87f3).
