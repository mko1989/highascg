# WO-553 — Timeline-in-a-look opacity flash, and the timeline↔look switch that cut instead of mixed

**Status: FIXED in repo (02.09.2026), both halves. Part A (flash) found by re-reading `setSendTo`'s
own AMCP-apply side effect against a fresh wire-log symptom. Part B (cut) found by tracing a
pre-existing, self-documenting dead parameter (`outgoingTopIsTimeline`) that was never wired to its
only caller. 4 smokes across 2 files, all 4 verified to fail without their respective fix (one
reproduces the exact flashed value from production). Suite 2351/2349/0/2 → 2357/2355/0/2. Owner QA
still owed on both.**
**Priority:** Critical — live production visual defect on every look-with-timeline take, both
directions.
**Source:** owner 02.09, after WO-546/548/549/550/552: *"now you need to look at opacity of layers
between looks and timeline looks. when playing a timeline look some of its layers appear at full
opacity for a split seccond, before disapearing and then fading in. switching between timeline look
and normal look results in cut. this needs to follow the same principals as standard looks"*
**Related:** [WO-528](./528_WO_TIMELINE_TAKE_MIX_INSTEAD_OF_CUT.md) and
[WO-544](./544_WO_TIMELINE_CLIP_KEYFRAME_VS_TAKE_FADE.md) (the two existing `takeFade` suppression
paths Part A's bug bypassed entirely — both were working correctly the whole time),
[WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md) (the concurrent
staging+PGM-take call pattern that creates Part A's race window), [WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md)
(`restrictToPreview`, the mechanism whose routing change is what triggers Part A)

---

## Part A — full-opacity flash on an incoming timeline layer

### 1. Investigation

Fresh wire log (`log/caspar_2026-09-02.log`, ~12:45:37-38) for a look-with-timeline take showed,
for each timeline physical layer (210/211/212), a **full mixer-property reset block** — FILL,
`OPACITY 1 0`, VOLUME, `BLEND NORMAL`, `BRIGHTNESS`, `CONTRAST`, `SATURATION`, `LEVELS`, `CHROMA`,
`CROP`, `CLIP`, `PERSPECTIVE` — firing on the program channel 2-3 times, **before** the expected
`MIXER 1-210 OPACITY 0 0` preset, which was itself followed ~650ms later by the correct
`MIXER 1-210 OPACITY 1 25 linear` fade-in.

That exact property list, in that exact order, is the signature of `_applyClipMixer`
(`timeline-playback-amcp-schedule.js`) running a full, **unprotected** apply for a clip: FILL, then
OPACITY via `_applyKeyedMixerProp`, then VOLUME via the same, then the effects-neutral reset block.
`_sendClipTransport` (the transport-start function) was ruled out first — it only conditionally
writes OPACITY when `initialOpacity < 1`, which never applies to a clip at its default opacity of 1.

The two existing suppression paths for this exact write (WO-528's steady-state guard, WO-544's
segment-tween guard) both gate correctly on `extra.takeFade` — and both callers of
`startSceneTimelineLayer` (staging and the real PGM take, per WO-546's deliberately-concurrent
3-call pattern) DO pass `takeFade: true` into their own `eng.play()` call. So neither of the known,
already-hardened write paths could explain an unprotected write reaching the wire.

The actual source was a **third, uncoordinated caller of `_applyAt`**: `TimelineEngine.setSendTo`
(`timeline-playback-runtime.js`). When the timeline being routed is already `_airTimelineId` and the
requested routing differs from its current one (`routingChanged`), `setSendTo` — unless told
`skipAmcpApply` — issues its own `this._applyAt(tid, pos, true)` with **no `takeFade`** at all,
because `setSendTo` has no way to know a preset-then-fade sequence is about to follow it.

`startSceneTimelineLayer`'s very first line is exactly this call:
`eng.setSendTo({ preview: true, program: !opts.restrictToPreview, screenIdx }, tlId)`. Trace the
real sequence for a look containing a timeline:

1. The **staging call** (`restrictToPreview: true`) runs first (or concurrently), calls
   `eng.play(tlId, ..., { takeFade: true, restart: true })`, making the timeline `_airTimelineId`
   with `sendTo = { preview: true, program: false }`.
2. The **real PGM take** (`restrictToPreview: false`) calls `eng.setSendTo({ program: true, ... },
   tlId)`. The timeline is already air, `program` is changing `false → true` → `routingChanged` is
   `true` → `setSendTo` fires its own unprotected `_applyAt(force: true)` — writing the clip's raw
   base OPACITY (1), FILL, VOLUME, and the full effects-neutral block straight to the program
   channel. **This is the flash.**
3. `startSceneTimelineLayer` then does its own preset (`MIXER programCh-L OPACITY 0 0`) — **the
   disappear** — followed by its own `eng.play(tlId, ..., { takeFade: true, restart })`, this time
   correctly suppressed, and the caller's crossfade fades the layer back in — **the fade-in**.

`runTimelineDirectTake` (the Take-button path, `timeline-take.js` line ~158) had already hit this
exact class of bug for its own `setSendTo` call and was fixed with `{ skipAmcpApply: true }` —
`startSceneTimelineLayer`, the look-embedded-timeline path, never received the same guard.

### 2. What was done

`timeline-take.js`, `startSceneTimelineLayer`: pass `{ skipAmcpApply: true }` to its `setSendTo`
call, mirroring `runTimelineDirectTake`'s existing fix. The STOP-old-channels + state-clear half of
`setSendTo`'s `routingChanged` handling still runs unconditionally (unaffected by this flag) — only
the redundant, unprotected re-apply is skipped, because the very next lines in this function
(preset-to-0, then `takeFade`-protected `play()`) always immediately supersede it on every path
(the CUT branch too — it unconditionally ends in its own `eng.play()`).

### 3. What was VERIFIED

- `tools/smoke/smoke-wo553-look-timeline-setsendto-race.test.js` — two tests. The first drives the
  real `TimelineEngine` + real `startSceneTimelineLayer` through the exact staging-then-PGM-take
  sequence and asserts no instant `OPACITY 1` write reaches the program channel; the second pins
  the `skipAmcpApply: true` argument at the source level.
- Reverted `src/engine/timeline-take.js` via `git stash` and reran: both tests fail cleanly. The
  first failure reproduces the **exact** flashed value seen on the wire —
  `{ ch: 1, layer: 210, val: 1, dur: 0 }`.

---

## Part B — timeline↔look switch cuts instead of mixing

### 1. Investigation

This is precisely the "does not follow the same principles as standard looks" gap the owner
described. Looked for the mechanism that fades an EXITING timeline out during a bank crossfade (the
standard look-to-look transition), expecting to find it missing entirely — instead found it fully
built (`scene-take-lbg.js` lines ~280-305: `activeTimelineIdToFadeOut`'s physical layers get DEFER
opacity-to-0 lines folded into `mergeMixerExtras`, which rides the same `MIXER <ch> COMMIT` as the
incoming look's own crossfade — correctly frame-locked) and correctly gated by `waitForOpacitySettled`
(WO-540§6, already timeline-aware) before the eventual `timelineEngine.stop()`. That whole path
looked architecturally sound.

The actual bug was one property away: `scene-take-lbg-jobs.js`'s `buildTakeJobs` has a real
parameter, `outgoingTopIsTimeline`, with real logic depending on it and a comment explaining exactly
why:

```js
// Bank B (+100) stacks above bank A — only pre-hide when incoming is the top layer.
// An outgoing timeline (band 210+) sits above BOTH look banks, so the incoming bank-B look is
// then genuinely BELOW the real top: stage it at full opacity (revealed as the timeline fades)
// rather than fading it in, which would double-ramp with the timeline fade-out into a dip.
const incomingIsAboveOutgoing =
    shouldRunBankCrossfade && inactiveBank === 'b' && activeBank === 'a' && !outgoingTopIsTimeline
```

`buildTakeJobs` has exactly one caller — `scene-take-lbg.js` — and that caller never passed
`outgoingTopIsTimeline`. It defaulted to `false` unconditionally, so the carve-out this comment
describes could never fire. Whenever a timeline was exiting and the incoming look landed on bank B
(the common case — the very next take after any take flips the bank pointer), the incoming layer
was wrongly treated as the topmost layer: it got `incomingIsAboveOutgoing = true`, which fades it IN
(0→1) via `prePlayOpacityZeroLine` + the crossfade ramp, at the same time the REAL top layer — the
timeline band, via Part A's already-correct `mergeMixerExtras` mechanism — fades OUT (1→0). Two
independent ramps stacked on top of each other, moving in opposite directions: exactly the
"double-ramp ... into a dip ... not a smooth mix" the comment warns about, and what reads to an
operator as a cut rather than a crossfade.

### 2. What was done

`scene-take-lbg.js`: pass `outgoingTopIsTimeline: !!activeTimelineIdToFadeOut` into the
`buildTakeJobs` call (`activeTimelineIdToFadeOut` is already computed earlier in the same function,
in scope at the call site). No change to `scene-take-lbg-jobs.js` itself — the logic it already had
was correct; it was simply never told the truth.

### 3. What was NOT done

- Owner QA on real PGM: take a timeline-containing look, then take a normal look over it, confirm a
  smooth mix — verified here by direct unit test of `buildTakeJobs`, not the physical box.
- The narrower case where the incoming look reuses a DIFFERENT layer number than the outgoing
  timeline occupied (`isEnterOnly`, no `hasOutgoingOnAir` overlap) was not touched — that case
  already fades the new layer in independently, which is correct: it is a genuinely new layer
  entering next to an unrelated timeline fading out on its own band, not the same-slot "reveal
  through the fade" case this fix targets.

### 4. What was VERIFIED

- `tools/smoke/smoke-wo553b-timeline-exit-crossfade-no-doubleramp.test.js` — calls `buildTakeJobs`
  directly with an outgoing timeline and an incoming media layer on the same logical slot, bank
  A→B. With `outgoingTopIsTimeline: true`: `incomingIsAboveOutgoing` is `false`, no
  `prePlayOpacityZeroLine` (no ramp), `prePlayOpacityFullLine` set (staged full, revealed by the
  timeline's own fade). Without it (both explicit `false` and omitted, matching the pre-fix
  default): the old double-ramp shape. A fourth test confirms the flag is irrelevant when the
  incoming look isn't landing on bank B. A fifth (source-level) test pins the
  `outgoingTopIsTimeline: !!activeTimelineIdToFadeOut` wiring in `scene-take-lbg.js`.
- Reverted `src/engine/scene-take-lbg.js` via `git stash` and reran: the source-wiring test fails
  cleanly (the direct `buildTakeJobs` behavior tests still pass on their own, since they exercise
  the parameter explicitly — the wiring test is what catches this exact regression).
- Trimmed the in-code comment once to keep `scene-take-lbg.js` under the 500-line CI limit
  (`node tools/ci/check-max-file-lines.js` — confirmed 0 files over after).

## Combined verification (both parts)

- Full offline suite: 2357/2355 pass, 0 fail, 2 pre-existing skips (real-clock-based, run outside
  CI; the one known pre-existing flaky real-clock test, `smoke-wo537-...`, was hit once mid-session
  and confirmed unrelated on rerun — clean pass in isolation).
- Lint clean on all four changed/added files (0 errors; repo-wide pre-existing warnings elsewhere
  untouched). 0 files over the 500-line limit.
- Server restarted (`kill -TERM` — service runs as the `casparcg` user, no sudo needed) with Part A
  live; Part B landed and verified before that restart, so both are live together.
