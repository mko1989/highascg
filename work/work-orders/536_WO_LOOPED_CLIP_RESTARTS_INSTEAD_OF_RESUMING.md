# WO-536 — A clip with **Loop** ticked restarts from frame 0 instead of resuming at the playhead

**Status: OPEN — root cause proved offline against the real engine (§2). Fix designed (§4), NOT implemented: it is the live transport path and one CasparCG behaviour needs the box (§5).**
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

## 5. Why it is not implemented here

One thing genuinely needs the box: **does `CALL <ch>-<layer> SEEK <frame>` behave on a LOOPing
ffmpeg producer in this Caspar build** — does it seek cleanly, and does the loop still wrap at the
file end afterwards? Everything else above is proved, but that answer is not in the source, and this
is the live take/transport path where WO-139 → WO-519 → WO-528 each shipped a fix that needed
another one. The owner can settle it in one minute with a looping clip and a PGM monitor.

Once that is known, both changes are small and the offline harness in §2 verifies them before
anything reaches air.

## 6. What is NOT the cause

- **Not a double seek.** The scrub sends one `CALL SEEK`; for a looping clip it sends **none**.
- **Not `implicitLoop` / WO-449.** Measured correct in §2.
- **Not the clip exchange (WO-523).** The owner reached it by exchanging a clip, but the same
  sequence on an untouched looping clip reproduces it.
- **Not the client.** `seek` then `play` is the right call sequence; the engine's response to it is
  the fault.

## 7. Work log

- 2026-08-14 — todos lines 6 and 12 triaged to one cause and reproduced offline against the real
  `TimelineEngine`: `loopAlways` clips are excluded from the paused scrub seek, which staleness the
  resume check then trips over, which forces the STOP + `PLAY … LOOP` restart that both reports
  describe. Fix designed; held for one on-box question about `CALL SEEK` under `LOOP`.
