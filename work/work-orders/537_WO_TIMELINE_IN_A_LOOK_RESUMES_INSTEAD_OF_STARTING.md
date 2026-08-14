# WO-537 — A timeline inside a look resumed where it was left; and returning to a look still cuts

**Status: PART 1 FIXED. PART 2 — CLOSED, root cause is [WO-540](./540_WO_CH1_HALF_RATE_TEARS_DOWN_EVERY_FADE_AT_50_PERCENT.md) (channel 1 drifts to half rate, so the teardown STOPs the outgoing content at ~60 % of every fade). §4b's collision guard remains a real, separate defect and stays fixed. 9 smokes, suite 2266 / 2264 pass / 0 fail / 2 skip.**
**Priority:** High (on-air; the look plays the wrong part of the timeline)
**Source:** `work/work-orders/todos14.08.26`
- line 1: *"hitting take from timeline editor now works correctly, but playing the same timeline from a look (i can drop a timeline from sources browser into looks) down not work properly."*
- line 2: *"going back to a look from timeline does a cut instead of mix"*
**Parent:** [WO-528](./528_WO_TIMELINE_IN_LOOK_CUTS_AND_DESTABILISES.md) — line 1 is the follow-up to its §8
("Both entry points are fixed"): the Take button is confirmed good, the look path is not. **WO-528's
opacity fix is not what is wrong here** — this is the start position.
**Related:** WO-139, WO-519 (fail-dark), WO-152

---

## 1. Part 1 — the owner's split names the cause

Two entry points, two different engine calls:

| | call |
|---|---|
| Take button (timeline editor) | `runTimelineDirectTake` → **`playForTake`** — JSDoc: *"always full transport … **Never resume shortcut**"* |
| timeline as a layer in a look | `startSceneTimelineLayer` → **`eng.play(tlId, startPos)`** |

`play()` has a paused-resume shortcut that **discards `fromMs`**:

```js
const wasPausedResume = prevAir === id && this._canResumePlayback(id)
const pos = wasPausedResume ? (cell.position ?? 0) : (fromMs != null ? fromMs : cell.position ?? 0)
```

That is deliberate and already pinned by `smoke-timeline-pause-resume.test.js` — *"resume must ignore
stale client fromMs"* — because an operator pressing Play means *continue*, and the client's cached
`fromMs` may be stale. It is exactly wrong for a take, which is *stating* where to start.

Both look callers explicitly ask for the beginning:

```js
// scene-take-lbg-jobs.js:66  and  scene-take-pgm-only.js:192
startAtCurrentPosition: false,
```

so `startPos` is `0` — and it was silently thrown away whenever the timeline happened to be paused.
Which it always is: scrubbing the timeline in its own editor leaves it paused. **The look therefore
played the timeline from wherever the operator had last parked the playhead.**

### Measured, against the real engine

```
paused at             12003 ms
play(id, 0)        -> 12003     ← the look path
playForTake(id, 0) ->    30     ← the Take button
```

Same timeline, same requested position, two answers. That is the owner's sentence.

### The fix

`play()` takes an opt-in `restart`, and `startSceneTimelineLayer` derives it from the flag it was
already given:

```js
const wasPausedResume = prevAir === id && opts?.restart !== true && this._canResumePlayback(id)
…
const restart = !opts.startAtCurrentPosition
eng.play(tlId, startPos, { restart })                     // CUT branch
eng.play(tlId, startPos, { takeFade: true, restart })     // MIX branch
```

**Why not just call `playForTake`?** It implies `take: true`, whose DEFER lead-opacity tweens are
left uncommitted for a take orchestrator to flush. The MIX branch has one; the **CUT branch does
not** (`fadeDur <= 0` → no fade batch, no commit), so those tweens would never land — a layer stuck
dark, the WO-519 class of failure. A one-flag opt-in keeps every other `play()` caller byte-identical.

Nothing else in the engine changes: `restart` absent, `false`, or alongside `takeFade` all still
resume, and a non-paused play is unaffected. All four cases are asserted.

## 2. What Part 1 does NOT claim

WO-528 §8's opacity suppression is working — the owner confirms the Take path. This WO does not
revisit it. If the look path still *flashes* after this fix, that is a separate fault and belongs in
its own round here, not in WO-528.

## 3. What was VERIFIED (Part 1)

- `tools/smoke/smoke-wo537-look-timeline-starts-where-asked.test.js` — 6 tests, curated CI list,
  driving the **real `TimelineEngine`**: the old behaviour is asserted as still-correct for a bare
  `play()`; `restart: true` starts at 0; `restart` is opt-in across four option shapes; a non-paused
  play is unchanged; and both look callers really do request position 0.
- WO-528's two source assertions on this same call **repointed, not weakened**: the fade branch now
  pins `{ takeFade: true, restart }`, and the CUT branch is asserted to carry *no* `takeFade` (the
  guarantee WO-528 owns) rather than an exact argument list, so the next addition here does not
  break it again.
- Suite **2251 / 2249 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit 0 over.

## 4. Part 2 — *"going back to a look from timeline does a cut instead of mix"* — OPEN

Read end to end and **could not be reproduced from the source**; recording what was ruled out so the
next session starts further along.

The outgoing-timeline fade-out path looks correct:

- `scene-take-lbg.js:102` sets `activeTimelineIdToFadeOut` from `getPlayback()` (the `_airTimelineId`)
  when the timeline plays on this channel — it does **not** require the timeline to have been part of
  a look, so a timeline taken from its own editor is detected.
- `shouldRunBankCrossfade` is then true, so the fade-out lines are built as `DEFER` into
  `mergeMixerExtras` (`:270-282`) and flushed with the take batch
  (`scene-take-lbg-amcp-pipeline-batch.js:44`).
- `runSceneTakeLbgTeardown` **awaits** `fadeMs` before the STOP/CLEAR, and
  `timelineEngine.stop(...)` runs after it (`:357`) — so the engine does not yank the layers
  mid-ramp, which was the first thing suspected.

One wire observation worth keeping, from `log/caspar_2026-08-14.log` 12:24:44 — a timeline→timeline
restart, not the reported case, but it shows a collision the same machinery can produce:

```
BEGIN
MIXER 1-210 OPACITY 0 25 linear DEFER      ← the fade-OUT
MIXER 1-211 OPACITY 0 25 linear DEFER
MIXER 1-212 OPACITY 0 25 linear DEFER
COMMIT                                      ← AMCP batch close, NOT a mixer commit
PLAY 2-210 …
MIXER 1-210 OPACITY 1 25 linear             ← the fade-IN, same layers, no DEFER
MIXER 1-211 OPACITY 1 25 linear
MIXER 1-212 OPACITY 1 25 linear
MIXER 1 COMMIT                              ← flushes both; the last value wins
```

### 4b. Correction, and a real defect — CORRECTED 14.08

The sentence that stood here (*"the layers go to 1 and the fade-out never happens"*) was **wrong**,
and wrong in the direction that matters. Caspar's actual ordering, from `transforms_applier::apply`
in `protocol/amcp/AMCPCommandsImpl.cpp` (the source the running binary was built from — provenance in
WO-536 §5):

```cpp
void apply() {
    if (defer_) { deferred_transforms_[channel_index].insert(…, transforms_); }   // queued
    else        { ctx_.channel.stage->apply_transforms(transforms_); }            // NOW
}
```

A non-deferred MIXER applies **immediately**; deferred ones accumulate per channel and are applied by
`MIXER <ch> COMMIT` — i.e. **last**. So in that trace the deferred fade-OUT wins, and the layer the
take just faded up is ramped straight back down. Not "the fade-out never happens": the fade-IN never
happens.

**And the banked path had no guard against it.** `scene-take-pgm-only.js` has always had one:

```js
// A layer can be both exiting (old timeline) and entering (new timeline) —
// the incoming fade-in owns it then; don't schedule a competing fade-out.
if (timelineFadeInPhys.includes(pOut)) continue
```

`scene-take-lbg.js` did not, so taking a look that *contains* the live timeline queued both ramps on
one layer and let insertion order decide. Fixed by giving the banked path the same guard — the
sibling implementation already knew the answer.

**Verified it cannot fail dark**, because skipping a fade-out on a layer preset to opacity 0 is
precisely the WO-519 trap. Enumerated over every combination of (merge, currentMap, activeTimeline,
duration, forceCut): the guard is reachable in exactly **2** states, and in both the layer is faded
in by the bank crossfade. The enumeration is in the test, with an assertion on the count of 2 so a
future change to the surrounding conditions cannot silently widen it.

### 4d. ANSWERED — see WO-540

The owner answered probe step 0 with *"pgm1 channel 1 screen"* and freed the box, which turned this
from source-reading into measurement. The take was reproduced on the wire and the live mixer sampled
through it: the fade IS issued and the teardown DOES wait — but **channel 1 was ticking at 24.9 fps
while declaring 50**, so a 25-frame fade needed 1000 ms and the teardown, computing `fadeMs` from the
declared rate, STOPped the outgoing timeline at ~623 ms — about 62 % through the dissolve. The
producers die mid-fade while the mixer numbers keep counting down, which is why the log looks clean.

Channel 2, on the identical 6144×1536 mode, measured 48.4 fps at the same moment — so it is not the
resolution or the GPU. Full measurements, the `REMOVE 1 DECKLINK 1` intervention that doubled the
rate, and the restart that showed it is a **runtime drift rather than a config mismatch**, are in
WO-540.

Everything §4 and §4b ruled out stays ruled out; they were just not where the fault was.

### 4c. What §4b does NOT explain (superseded by §4d)

This fires only when a timeline layer is in **both** lists — i.e. the incoming look carries the
timeline that is currently live. The owner's report is *going back to a **look***, which in the plain
case puts nothing in `timelineFadeInPhys`, so the guard changes nothing there. Part 2 stays open.

One narrowing worth having before the log read: **which screen was it on?** This box has
`previewChannels = [2, null]` — screen 1 has **no preview bus**, so its takes do not go through
`scene-take-lbg.js` at all; they go through `scene-take-pgm-only.js`, a separate implementation with
no bank crossfade, whose transitions are additionally rewritten by `normalizeTransitionForPgmOnly`.
If the cut is only ever on screen 1, everything read so far about the banked path is beside the
point. That is a one-word answer and it halves the search.

### The next probe (cheap, and the owner can do it while working)

0. ~~**Which screen?**~~ **ANSWERED: screen 0 / ch1** — and that answer led to WO-540. The steps
   below were never needed; kept only as a record of what would have been tried.


Take a look while a timeline is live on PGM, then read `log/caspar_<date>.log` for that moment:

1. Are there `MIXER <pgm>-21x OPACITY 0 <dur> … DEFER` lines at all? **No** → `activeTimelineIdToFadeOut`
   was null; log `getPlayback()` and `_channelsFor(sendTo)` at `scene-take-lbg.js:104`.
2. Present, but followed by `OPACITY 1 …` on the same layers before the commit? → the collision above.
3. Present and uncontested, yet it still cuts on the monitor? → the fade is issued and ignored;
   that points at the DEFER/commit pairing, not at the decision logic.

## 5. Work log

- 2026-08-14 — todos line 1 traced to `play()`'s resume shortcut discarding the take's requested
  start position, measured 12003 vs 30 ms against the real engine, and fixed with an opt-in
  `restart` (not `playForTake`, which would fail-dark on the CUT branch). 6 smokes. Line 2 read end
  to end, not reproduced; the ruled-out paths and the log probe are in §4.
- 2026-08-14 (later) — §4's DEFER-ordering claim CORRECTED from the Caspar source: deferred
  transforms apply at COMMIT, i.e. after immediate ones, so the collision kills the fade-IN, not the
  fade-out. Found that `scene-take-lbg.js` lacks the both-lists guard `scene-take-pgm-only.js` has;
  added it, with an exhaustive fail-dark check. Does not explain the reported symptom on its own
  (§4c) — added "which screen?" as probe step 0, since screen 1 is PGM-only and uses the other
  implementation entirely.
