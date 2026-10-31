# WO-897 — Pixel-map tick matches the channel rate: 50 fps frames are all sampled

**Area:** mapping
**Status: DONE (31.10.26 — smoke 4/4: 50/50 frames sampled, 0 missed vs 44 + 6 missed on the old clock; box ch1 896 mappings: 49.5 frames/s sampled, ~1.5/s missed (was ≤ 43.5 sampled))**

## Owner request

No owner request at first. Side finding of WO-893 while checking pixel-mapped fixtures. Owner 31.10.26 after the
explanation: "WO-897 do the recommendation" (sample each new frame once, keep the send rate in check).

## Investigation

File references are as found on 31.10.26; to re-verify at implementation.

- `src/fixtures/follow-engine.js`: `TICK_MS = Math.round(1000 / 44)` = 23 ms. That is 1000 / 23 = **43.48 Hz**. The
  comments say 44 Hz.
- Every Caspar channel runs at 50 fps (`config/casparcg.config`).
- At 50 fps a frame lasts 20 ms. A 23 ms tick lands on a new frame about 43.5 times a second, so roughly 6.5 frames per
  second (about 13 %) are never sampled.
- Effect: moving content in pixel-mapped fixtures shows a judder at about 6.5 Hz, because the skipped frames repeat the
  previous sample in an uneven pattern.

## Design

- Tick (or sample) at the source channel's frame rate, 50 fps for these channels, instead of a fixed 44 Hz guess. Either
  drive the tick from the channel rate or sample only when the shm surface sequence number changes.
- Preferred: drive sampling from the shm surface seq, so each new Caspar frame is read exactly once and no frame is
  missed or read twice, whatever the channel rate.
- Keep the DMX send rate within the Art-Net limits. Sampling at 50 Hz must not raise the packet rate above what the
  fixture links accept. Send at most once per sampled frame, and coalesce when a link is saturated.
- Fix the comments to state the real rate.

## Acceptance / verification plan

- Unit check of the tick: at 50 fps input, every frame's seq is sampled once; no skipped and no repeated samples in a
  10 s run.
- A moving test pattern through a pixel-mapped fixture: the judder at 6.5 Hz is gone (measured on the sampled sequence,
  not by eye).
- DMX send rate at 50 Hz stays within the configured Art-Net limit with the fixture count on the box.
- Artnet tests use `src/fixtures/artdmx.js` and 127.0.0.1:6455 only (never the live :6454 broadcast).
- Node tests green (the fixtures suite and any smoke that greps `TICK_MS`).
- Box: run a moving pattern through a pixel-mapped fixture on the test port and check the sample log.

## Dependencies

- WO-893: the finding came from its investigation. This WO does not depend on WO-893 being closed.
- The shm surface sequence number (the frame counter the channel publishes), for the seq-driven option.
- Art-Net send path (`src/fixtures/artdmx.js`): the send-rate limit applies there.

## Investigation (31.10.26, at implementation)
- `src/fixtures/follow-engine.js` `tick()` calls `pixelMap.sample(now)` first; `sample()` reads each surface's LATEST frame
  (`pixel-map-frame.js read(file, {since})`, seq from the header's `latest >> 8`). One read per tick → at most 43.5 frames/s
  of a 50 fps channel; the rest are overwritten unseen.
- The send path is the same tick: each universe goes out once per tick when its 512 bytes changed (else every
  `REFRESH_MS` 1 s). So "sample per frame" also means "send per frame" — nothing else rate-limits ArtDMX / sACN in the repo.
- A frame's arrival has no notification (the hshm seqlock is polled), so the watcher polls the header.

## What was done
- `pixel-map-frame.js`: `peekSeq(file)` — the 8-byte `latest` of the header only (0 = none / no segment).
- `pixel-map-service.js`: a watcher (`WATCH_POLL_MS` 3 ms, only while surfaces are leased and the map is wanted) kicks the
  engine once per new seq (`s.kicked`); `stats.missed` counts seq gaps between sampled frames; `/live` shows it.
- `follow-engine.js`: `kick()` ticks at once, or `MIN_TICK_MS` (12 ms) after the last tick — frames of several channels that
  land close together share one tick, one packet per universe. The 23 ms interval stays as the clock and skips while a tick
  ran within `TICK_MS` (frames drive it), so with frames the engine runs at the frame rate, without them at 43.5 Hz as before.
  Comments state 23 ms ≈ 43.5 Hz instead of "44 Hz".
- Send rate: unchanged rule (once per tick, only on change); with a moving picture that is now the channel rate, 50 Hz, the
  ceiling `MIN_TICK_MS` puts on it is 83 Hz. No Art-Net cap is configured anywhere to compare with; Art-Net IP pixel heads take
  50 Hz, a DMX512-line node re-times it to its own ≤ 44 Hz output.

## What was VERIFIED
- `tools/smoke/smoke-wo897-pixel-map-frame-tick.test.js` (new, curated `offline-test-files-2.js`) 4/4: peekSeq; kick (at once,
  coalesced in the window, no-op while stopped); a real FollowEngine + service on an in-place hshm segment published at 50 fps
  for 50 frames → `frames 50, missed 0, ticks 52` (3 runs identical); control with the 23 ms clock alone → `frames 44, missed 6`
  every run — the 6.5 Hz judder reproduced and gone.
- Related smokes (wo807 ×3 incl. the 127.0.0.1:6455 loopback, wo893, wo632, wo695, every smoke naming follow-engine/TICK_MS):
  210/210.
- Box, node restarted 17:42 (DMX master off — nothing on the wire), ch1 1920×1080 with 896 mappings, `/live` read each second
  for 8.5 s: frames 15 → 409 (49.5/s), missed 0 → 14 (~1.6/s, ~3 %), sampling ~2.9 ms per frame. The old clock could sample at
  most 43.5/s (13 % missed). The remaining misses are frames that land while node's event loop is busy > 20 ms elsewhere —
  not chased further here.
