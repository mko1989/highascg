# WO-897 — Pixel-map tick matches the channel rate: 50 fps frames are all sampled

**Area:** mapping
**Status: OPEN (31.10.26, side finding of WO-893)**

## Owner request

No owner request. Side finding of WO-893 while checking pixel-mapped fixtures. Recorded as OPEN; not yet approved for
implementation as a separate item.

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
