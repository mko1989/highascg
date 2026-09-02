# WO-546 — The pgm/prv preview-exchange take was killing a timeline the SAME action just started

**Status: FIXED in repo (02.09.2026). Found by reading the real AMCP wire log, not by theory. 8
smokes, suite 2314/2312/0/2 → 2322/2320/0/2. Owner QA still owed.**
**Priority:** Critical (on-air; this is the actual cause of the repeatedly-reported "timeline in a
look doesn't work" — WO-541/544/545 were real fixes for real, different bugs but did not touch
this path)
**Source:** owner 02.09, after WO-544/545 were deployed and still reported "still exactly the same
issues" — the trigger to stop theorizing and read the real wire trace.
**Related:** [WO-541](./541_WO_TIMELINE_ONLY_LOOK_NEVER_FADES_IN.md),
[WO-544](./544_WO_TIMELINE_CLIP_KEYFRAME_VS_TAKE_FADE_RACE.md),
[WO-545](./545_WO_OUTGOING_TIMELINE_OPACITY_FIGHTS_EXIT_FADE.md) (all real, all still correct, none
of them the dominant cause), WO-150 B150.1 (why the concurrent design in §1 exists and must stay)

---

## 1. Investigation — read from the wire, not reasoned from source

After WO-544/545 were deployed and the owner reported the identical symptom, checked `journalctl`
first: the companion-press mechanism (WO-543) logged a clean crossing + "sent via Satellite" with
no error — proof the engine-level fixes so far were doing what they claimed, and that continuing to
theorize about the engine internals was the wrong next step. Went to the actual CasparCG AMCP
protocol log instead (`log/caspar_2026-09-02.log`), matching how WO-540 was originally solved
("measured rather than reasoned").

Found the take at 11:04:15–16 (physical layers 210/211/212 — the timeline band):

```
11:04:15.652  STOP 2-211                       PLAY 2-211 "forest_jester-dv.mov" LOOP
11:04:15.658  STOP 1-211                       PLAY 1-211 "forest_jester-dv.mov" LOOP
11:04:15.666  STOP 2-210, STOP 1-210, STOP 2-212, STOP 1-212
11:04:15.667  PLAY 2-210/1-210 "PiekloKobiet...mov" SEEK 0
11:04:15.674  PLAY 2-212/1-212 "firebelly-torches-dv.mov" LOOP SEEK 0
   ... the identical sequence repeats a second time, ~150ms later ...
11:04:15.804  STOP 2-211/1-211, PLAY 2-211/1-211 (same clip, again)
11:04:15.829  STOP 2-210/1-210/2-212/1-212, PLAY 2-210/1-210/2-212/1-212 (same clips, again)
   ... then, ~300ms after that, a THIRD event — STOP only, no replay ...
11:04:16.123  STOP 2-210, STOP 1-210, STOP 2-211, STOP 1-211, STOP 2-212, STOP 1-212
```

Three distinct events touching the same six physical layers within ~460ms: PLAY, a duplicate
PLAY (visible restart/flicker), then a bare STOP with nothing to replace it — the timeline goes
dark and the log shows nothing further for it until an unrelated later take (2+ seconds later)
happens to reset those layers' opacity while loading different content. This is precisely "goes up
in opacity then down, then shows up when I play another look."

### 1a. Three concurrent `runSceneTakeLbg` calls per take

`routes-scene-take.js`'s pgm/prv path issues up to three separate `runSceneTakeLbg` calls for ONE
operator take:

1. **Stage on preview** (`channel: bus1`, `incomingScene: inc` — the NEW look) — awaited before the
   other two even start.
2. **PGM take** (`channel`, `incomingScene: inc` — the SAME new look) — the real program transition.
3. **Preview exchange** (`channel: bus1`, `incomingScene: previousPgmScene` — the OLD look) —
   started **deliberately concurrently** with #2, not awaited before it (`if (previewExchange)
   startPreviewExchange()` then `await pgmTakePromise`). The code's own comment explains why:
   sequencing it after the PGM take left PRV showing the just-staged incoming look for the entire
   fade + teardown — the already-fixed WO-150 B150.1 ("wrong look on preview after transition").
   **This concurrency is required, not a bug to remove.**

### 1b. `startSceneTimelineLayer` always claims BOTH channels of a screen

`eng.setSendTo({ preview: true, program: true, screenIdx: opts.screenIdx })` — every call routes a
timeline to the full PGM+PRV pair of its screen, regardless of which single channel the caller was
actually working on. `programChannelToScreenIdx` resolves the STAGING call's channel (`bus1`, a
*preview* channel number) via a linear search of *program* channel numbers — it isn't found, so the
function's own fallback returns `screenIdx = 0`, the same value the real PGM call resolves to. So
calls #1 and #2 both legitimately (and redundantly) claim the SAME timeline, routed to the SAME two
physical channels — that redundancy is the duplicate PLAY (cosmetic: a brief restart, since
`startSceneTimelineLayer` always passes `restart: true`).

### 1c. The kill: call #3 misreads the timeline as exiting

Call #3's own incoming scene (`previousPgmScene`, the OLD look) has no timeline. Its own
`activeTimelineIdToFadeOut` computation (`scene-take-lbg.js`) asks: is there a timeline currently
"air", and — since it isn't named in *this* diff — is it at least "currently playing on *this*
channel" (`bus1`)? Because of §1b, the answer is yes: the SAME timeline calls #1/#2 just made air,
routed to `bus1` among others. Call #3 has no way to know that "playing on this channel" is only
true because a *different, concurrently-running* take put it there on purpose. It builds the
fade-out DEFER and — after its own teardown wait — calls `timelineEngine.stop(id)`. Since there is
only ever one global `_airTimelineId`, that `stop()` kills the timeline everywhere, including on
the real PGM channel where call #2 had just legitimately started it. That STOP is the bare one at
11:04:16.123 with no replay.

## 2. What was done

New `scene-take-lbg-timeline-guard.js` (split out to stay under the 500-line file limit and to be
directly testable): `resolveActiveTimelineIdToFadeOut(pbNow, diffExit, channel,
protectedTimelineId, channelsFor, hasContent)` — the same decision `scene-take-lbg.js` always made,
pulled out as a pure function, with one addition: never return a `protectedTimelineId`, however the
other conditions read.

`scene-take-lbg.js` now calls this helper instead of inlining the logic; `opts.protectedTimelineId`
threads through from the caller.

`routes-scene-take.js`: new `incomingTimelineId(scene)` extracts the timeline id (if any) from a
scene's layers. The **preview-exchange call only** (call #3) now passes `protectedTimelineId:
incomingTimelineId(inc)` — `inc` is the real PGM take's incoming scene, available in this closure
since both calls are built in the same function. The staging call and the real PGM take are
deliberately NOT given this option — they are the calls legitimately claiming the timeline; nothing
to protect it from at that call site.

**Not fixed here, deliberately out of scope:** the duplicate PLAY (§1b) — a cosmetic redundant
restart, not what makes content disappear. Fixing it means changing `startSceneTimelineLayer` or
the staging call to claim only ONE channel instead of the full pair, which is a larger, separate
change or design decision; the reported symptom is fully explained and fixed by §1c alone.

## 3. What was NOT done

Owner QA on real PGM with an actual timeline-in-a-look take through the pgm/prv exchange path —
verified by direct unit test of the extracted decision function and by full source-level assertions
on the wiring, not by re-running the exact operator action that produced the wire trace in §1.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo546-preview-exchange-timeline-guard.test.js` — 8 tests: a protected timeline
  is never flagged as exiting even when every other condition says it should be; the identical
  inputs without protection DO flag it (pins the actual pre-fix bug, not just the API shape);
  protection only shields the named id, a genuinely different exiting timeline still fades
  normally; no-timeline-currently-air is always null; a timeline named in this channel's own exit
  diff still exits normally when unprotected (protection doesn't overreach into unrelated cases);
  plus source-level assertions that `routes-scene-take.js` wires `protectedTimelineId` into the
  preview-exchange call only, not the staging or PGM calls.
- Temporarily removed the protection line and reran: the core test fails cleanly
  (`actual: 'tl-1', expected: null`), confirming the smoke catches the regression.
- Full offline suite: 2322/2320 pass, 0 fail, 2 pre-existing skips. Lint 0 errors/warnings on every
  changed file. 0 files over the 500-line limit (`scene-take-lbg.js` was split to a new file to
  stay under it after this change).
