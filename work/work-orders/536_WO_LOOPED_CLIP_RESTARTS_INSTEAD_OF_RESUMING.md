# WO-536 — A clip with **Loop** ticked restarts from frame 0 instead of resuming at the playhead

**Status: FIXED in repo (14.08.2026) — 12 smokes (4 of them verified to fail without the fix), suite 2263 / 2261 pass / 0 fail / 2 skip. Owner QA owed (§8).**
**Priority:** High (black frame on air every resume; the clip plays from the wrong point)
**Source:** `work/work-orders/todos14.08.26`, two reports that turn out to be one bug:
- line 6: *"when pausing a timeline, jumping the playhead somewhere else and hitting play again results in a black frame before it starts playing. it probably sends another seek, even though the seek was already applied when moving the playhead."*
- line 12: *"i just changed a clip on timeline that was extended to make it loop multiple times and it doesnt start in correct place in regard to timelines playhead."*
**Related:** WO-449 (`implicitLoop` — the *other* loop kind, which is correct), WO-523 (clip exchange),
WO-139/WO-528 (same files, take path)

---

## 0. The owner's guess is right, with one correction

*"it probably sends another seek"* — nearly. It sends something worse: a **`STOP` followed by a
fresh `PLAY … LOOP`**. Tearing the producer down and re-creating it is what puts a black frame on
air, and the new `PLAY` carries **no `SEEK`**, which is why the same clip also starts in the wrong
place. One mechanism, both reports.

## 1. Two kinds of loop, and only one is broken

| | set by | field | behaviour |
|---|---|---|---|
| **implicit loop** | stretching a clip past its media length | `meta.implicitLoop` (WO-449) | **correct** |
| **explicit loop** | the clip inspector's **Loop** checkbox (`inspector-panel-timeline-clip.js:89`) | `clip.loopAlways` | **broken** |

That matters for reproducing it: stretching alone does not trigger this. The Loop tick does.

## 2. Proved offline against the real engine

`TimelineEngine` drives fine under `node` with a recording AMCP double — no box, no risk. Four
variants, same script: `play(4000)` → `pause()` → `seek(20000)` → `play()`.

```
### plain clip
  play@4000ms:      (no transport — already loaded)
  seek -> 20000ms:  CALL 2-210 SEEK 500
  prevKey.frame: 500   canResume: true
  play:             RESUME 2-210                                   ← correct

### extended past media: a 60s clip over a 10s file (implicitLoop)
  seek -> 20000ms:  CALL 2-210 SEEK 0        (500 % 250 — the modulo is right)
  prevKey.frame: 0     canResume: true
  play:             RESUME 2-210                                   ← correct

### Loop ticked (loopAlways)
  play@4000ms:      STOP 2-210 | PLAY 2-210 "test.mov" LOOP        ← no SEEK: starts at frame 0, not 100
  seek -> 20000ms:  (NOTHING SENT)                                 ← the paused picture never moves
  prevKey.frame: 100   canResume: false                            ← stale, so no resume
  play:             STOP 2-210 | PLAY 2-210 "test.mov" LOOP        ← the black frame, and frame 0 again
```

Reproduce in ~10 seconds: `node` + `new TimelineEngine({config:{screen_count:1}, amcp:<recorder>})`,
one 60 s clip, the sequence above. The recorder only needs `raw/stop/pause/resume/call/mixer*`.

## 3. The three lines responsible

**(a) A paused scrub refuses to seek a looping clip** — `timeline-playback-amcp-send.js:149`:

```js
const needsScrubSeek = force && prev?.clipId === clip.id && !transportStale &&
	prev.frame !== meta.frame && !meta.isRoute && !meta.loopAlways
```

`!meta.loopAlways` means nothing is sent. `transportSent` stays false, so the `_prevKey` write keeps
`frame: prev?.frame` — the **pre-seek** frame.

**(b) The resume shortcut then declines** — `_validateClipStateForResume:26`:

```js
if (prev.frame !== meta.frame) return false
```

Correctly, given (a) lied to it. `play()` therefore takes the full path.

**(c) The full path always restarts a loop from zero** — `_sendClipTransport:285`:

```js
if (meta.loopAlways) {
	…
	self.amcp.stop(ch, caspLayer)
	self.amcp.raw(`PLAY ${cl} ${meta.srcQ} LOOP${afSuffix}`)     // no SEEK, ever
	return { hasDeferredLines: false }
}
```

`STOP` + `PLAY` = producer teardown and re-open = the black frame. No `SEEK` = frame 0.

And `needsFullTransport = transportStale || loopStale || (force && playing)` — `play()` calls
`_applyAt(…, force = true)` with `playing` already true, so **every** play of a looping clip goes
through (c), not only after a seek.

## 4. The fix, as designed

1. **Drop `!meta.loopAlways` from `needsScrubSeek`.** A paused scrub should `CALL … SEEK` a looping
   producer exactly as it does any other. This alone repairs `_prevKey.frame`, which makes
   `_canResumePlayback` true, which removes the STOP/PLAY — i.e. **it fixes the black frame (line 6)
   without touching `_sendClipTransport` at all.**
2. **Follow `PLAY … LOOP` with `CALL … SEEK <meta.frame>` when `meta.frame > 0`** in the loopAlways
   branch. That fixes the start position (line 12).

**The frame arithmetic is already correct** and does not need changing —
`resolveTimelineClipFrame:299` applies `inFrames + (relativeFrame % spanFrames)` whenever the media
duration is known, and a `loopAlways` clip stretched past its media is `implicitLoop` too, so it
gets the modulo. A `loopAlways` clip shorter than its media needs no modulo. When the duration is
unknown, no path can compute one — that is a pre-existing limit, not a regression.

**Use `CALL … SEEK`, never `PLAY … LOOP SEEK n`.** In CasparCG a `SEEK` inside `PLAY` sets the
producer's **in-point**, so `PLAY file LOOP SEEK 100` would loop 100→end rather than 0→end. That
would silently change what a looping clip *is*. A separate `CALL SEEK` moves the playhead and leaves
the loop range alone.

## 5. The open question, answered from the source that built this binary — not from the box

The blocker was: *does `CALL <ch>-<layer> SEEK <frame>` behave on a LOOPing ffmpeg producer in this
build?* That did not need an on-air experiment. The CasparCG source tree that produced the running
binary is on the box, and it is provably the right one:

```
~/caspar-build/src-tree            git b96e58d60
md5  ~/caspar-build/build/shell/casparcg  == 9b323f16…
md5  ~/highascg/bin/casparcg               == 9b323f16…      ← identical
```

Reading it settles all three sub-questions, and better than a single observation would:

1. **`CALL … SEEK n` is orthogonal to looping.** `ffmpeg_producer.cpp:180` routes it to
   `AVProducer::seek`, which (`av_producer.cpp:1075`) sets `seek_` and drops the buffer. It touches
   neither `loop_` nor `start_`.
2. **Looping still wraps afterwards.** `av_producer.cpp:881`: at EOF,
   `if (loop_ && frame_count_ > 2) seek_internal(start)` — back to `start_`, i.e. the IN point, not
   to wherever the last seek went.
3. **`PLAY … LOOP SEEK n` really would have been the wrong instrument** — `ffmpeg_producer.cpp:302`,
   `auto in = get_param(L"IN", params, seek)`, aliases SEEK onto IN, moving the loop's start point.
   §4's warning was right and is now source-backed rather than recalled.

### The hazard the source also revealed

`seek_internal` resets `frame_count_ = 0`, and the wrap is guarded by `frame_count_ > 2`. So a
producer seeked to within ~2 frames of the end hits EOF *before* it qualifies to loop and takes the
`sleep_for(10ms); continue` branch instead — holding the last frame permanently, because nothing
further is decoded to grow the count. That window is refused by `loopSeekIsSafe`, which is the one
part of this fix that would not have been found by trying it once and watching PGM.

## 6. What was implemented

| file | change |
|---|---|
| `timeline-playback-helpers.js` | new `loopSeekIsSafe(meta)` — the predicate, carrying the source citations above. Frame 0 **is** legal (a scrub back to the loop start must be sent); the end-of-media window and routes are refused. |
| `timeline-playback-amcp-send.js` | `needsScrubSeek` no longer excludes `loopAlways` outright — `(!meta.loopAlways || loopSeekIsSafe(meta))`. |
| `timeline-playback-amcp-send.js` | the exclusive `if (meta.loopAlways)` dispatch branch gained `else if (needsScrubSeek) → CALL … SEEK`. **This was the real structural gate**: even with the condition relaxed, a looping clip never reached the scrub cases, because that branch returns without falling through. |
| `timeline-playback-amcp-send.js` | `_sendClipTransport`'s loopAlways branch follows its `PLAY … LOOP` with `CALL … SEEK meta.frame` when `meta.frame > 0 && loopSeekIsSafe(meta)`. |
| `timeline-playback-transport-bulk.js` (new, 78 lines) | the added lines pushed the sender to 511, over the CI limit. `_pauseAll` / `_resumeAll` / `_stopAll` extracted whole — a coherent unit (walk the layers, one command each, no per-clip reasoning) rather than a shaving of the fix. Mixed into the engine prototype next to the sender; no smoke reads the sender by path, so nothing needed repointing. |

Playing and paused take the same command in the scrub branch: a looping producer repositions
identically either way, and — worth knowing — `_pauseAll` **skips** `loopAlways` layers, so such a
clip is never PAUSEd in Caspar at all. `_resumeAll` skips them symmetrically. That is why the
corrected trace below shows *nothing* on the resume rather than a `RESUME`: there is nothing to
resume, and that is correct, not a missing command.

### Before / after, same script as §2

```
### Loop ticked (loopAlways)                    BEFORE                     AFTER
  play@4000ms      STOP | PLAY … LOOP                    STOP | PLAY … LOOP | CALL SEEK 100
  seek -> 20000ms  (NOTHING SENT)                        CALL SEEK 500
  canResume        false                                 true
  play             STOP | PLAY … LOOP   ← black frame    (nothing — never paused)
```

## 7. What was VERIFIED

- `tools/smoke/smoke-wo536-looping-clip-seeks-instead-of-restarting.test.js` — 12 tests, curated CI
  list, driving the **real `TimelineEngine`** with a recording AMCP double: the scrub reaches the
  wire and the resume stays available; the following play emits no STOP and no PLAY; a mid-timeline
  start seeks to the playhead; the seek is never folded into the PLAY; the stretched case wraps with
  the loop modulo; **the plain and `implicitLoop` paths are asserted unchanged**; and
  `loopSeekIsSafe`'s boundaries are pinned frame by frame (247 ok, 248 refused, in-point offsets it).
- **Confirmed the tests fail without the fix**: reverting the two conditions turns 4 of the 12 red;
  restoring them turns all 12 green.
- Suite **2263 / 2261 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit 0 over. `node index.js --no-http` boots (the mixin split is load-bearing at startup, so the boot gate is the check that matters here).

## 8. Owner QA

Server-side — needs `kill -TERM $(systemctl show -p MainPID --value highascg)`.

1. A clip with **Loop** ticked, playing. Pause, drag the playhead somewhere else, press Play:
   **no black frame**, and it continues from where the playhead is.
2. Take a timeline whose first clip is a looping one, from a mid-timeline position: it must start at
   the playhead's point in the media, not at the clip's beginning.
3. Let a looping clip run past its media end at least once — it must still wrap. (This is the one
   thing the source says is safe but only the monitor can confirm end to end.)

## 9. What is NOT the cause

- **Not a double seek.** The scrub sends one `CALL SEEK`; for a looping clip it sends **none**.
- **Not `implicitLoop` / WO-449.** Measured correct in §2.
- **Not the clip exchange (WO-523).** The owner reached it by exchanging a clip, but the same
  sequence on an untouched looping clip reproduces it.
- **Not the client.** `seek` then `play` is the right call sequence; the engine's response to it is
  the fault.

## 10. Work log

- 2026-08-14 — todos lines 6 and 12 triaged to one cause and reproduced offline against the real
  `TimelineEngine`: `loopAlways` clips are excluded from the paused scrub seek, which staleness the
  resume check then trips over, which forces the STOP + `PLAY … LOOP` restart that both reports
  describe. Held briefly for an on-box question about `CALL SEEK` under `LOOP` — then answered
  instead from the CasparCG tree that built the running binary (§5), which also turned up the
  `frame_count_ > 2` end-of-media stall that an on-air trial would have missed. Implemented, 12
  smokes, 4 verified to fail without it.
