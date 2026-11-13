# WO-1061 — Timeline opacity keyframes do not fade during playback (fine when scrubbing)

**Area:** engine, amcp
**Status: DONE (13.11 — wire order + RGBA prints on the box's preview channel)**

Owner, 13.11: *"while in timeline playback the image producers doesnt fade in and out correctly based on key frames.
(looks fine when scrubbing the timeline."*

## Investigation

Reproduced on the box with project narvil, timeline "krakow" (two JPEG clips, opacity 0→1 over 4.3 s at clip start,
1→0 at the end), PRV channel 3, `log/caspar_2026-11-13.log`:

```
12:34:40.464 MIXER 3 COMMIT                       ← the commit
12:34:40.465 PLAY 3-211 … / PLAY 3-212 …
12:34:40.488 MIXER 3-211 OPACITY 0 0
12:34:40.490 MIXER 3-211 OPACITY 1 216 linear DEFER   ← the tween it was meant to fire
12:34:44.795 MIXER 3 COMMIT                       ← next commit, 4.3 s later (next segment)
```

`_syncAmcpLayers` (`src/engine/timeline-playback-amcp-send.js`) sent the per-channel lines with `batchSendChunked` and
then called `amcp.mixerCommit(ch)` directly. A batch reaches the send queue a promise turn later (and line by line
without `amcp_batch`), the direct commit at once — so the commit overtook the DEFER tweens. The tween stayed parked
until some later commit: stills popped in ~4 s late and the end fade never ran. Scrub uses instant (non-DEFER) values,
hence "fine when scrubbing". Not image-specific: any clip with opacity keyframes.

Also: the tween's instant start value was sent AFTER the PLAY (a frame at the old opacity).

## What was done

- The commit now waits for the tick's batches (the transport batch that carried DEFER lines and the collected segment
  lines): `Promise.allSettled(waits).then(commit)`. `_sendClipTransport` returns its batch promise (`sent`).
- The lead tween's start value is pushed before the transport line.
- Smokes `smoke-wo173-keyframe-batch-tick` / `-clip-start-batch` now use a batch that resolves later and assert the
  commit comes after it, and the OPACITY start before PLAY.

## Verified

- Wire after the fix: `STOP, OPACITY 0 0, PLAY, OPACITY 1 216 DEFER, MIXER 3 COMMIT` within 20 ms at entry; the
  fade-out segment gets its commit 1 ms after its DEFER line.
- RGBA `PRINT 3` during the fade-in: mean alpha 0.10 at +0.5 s, 0.58 at +2.5 s, 1.0 at +5.5 s (expected 0.12 / 0.59 / 1).
- Timeline smokes 248 pass; offline suite 6175 pass.
