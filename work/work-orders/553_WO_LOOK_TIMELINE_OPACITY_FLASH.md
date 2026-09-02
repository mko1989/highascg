# WO-553 — A timeline layer inside a look flashed full opacity before disappearing then fading in

**Status: FIXED in repo (02.09.2026). Root cause found by re-reading `setSendTo`'s own AMCP-apply
side effect against the fresh wire-log symptom, then confirmed with a real-`TimelineEngine`
reproduction. 2 smokes, both verified to fail without the fix (one reproduces the exact flashed
value from production). Suite 2351/2349/0/2 → 2353/2351/0/2. Owner QA still owed.**
**Priority:** Critical — live production visual defect on every look-with-timeline take.
**Source:** owner 02.09, after WO-546/548/549/550/552: *"now you need to look at opacity of layers
between looks and timeline looks. when playing a timeline look some of its layers appear at full
opacity for a split seccond, before disapearing and then fading in. switching between timeline look
and normal look results in cut. this needs to follow the same principals as standard looks"* —
this WO addresses the opacity-flash half. The cut-on-switch half is tracked separately (see
`work/OPEN_ISSUES.md`; not yet root-caused as of this WO).
**Related:** [WO-528](./528_WO_TIMELINE_TAKE_MIX_INSTEAD_OF_CUT.md) and
[WO-544](./544_WO_TIMELINE_CLIP_KEYFRAME_VS_TAKE_FADE.md) (the two existing `takeFade` suppression
paths this bug bypassed entirely — both were working correctly the whole time),
[WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md) (the concurrent
staging+PGM-take call pattern that creates the race window), [WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md)
(`restrictToPreview`, the mechanism whose routing change is what triggers this)

---

## 1. Investigation

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
`startSceneTimelineLayer`, the look-embedded-timeline path, never received the same guard. This is
precisely the "does not follow the same principles as standard looks" gap the owner described:
standard look layers build one synchronous, fully-composed set of mixer lines per take
(`scene-take-lbg-jobs.js`) with no independent side-effecting engine call in between; the timeline
path instead makes multiple independent, stateful engine calls (`setSendTo`, `play`) from two
concurrent take invocations against one global `TimelineEngine` singleton, and only one of those
calls (`play`) had ever been taught to respect `takeFade`.

## 2. What was done

`timeline-take.js`, `startSceneTimelineLayer`: pass `{ skipAmcpApply: true }` to its `setSendTo`
call, mirroring `runTimelineDirectTake`'s existing fix. The STOP-old-channels + state-clear half of
`setSendTo`'s `routingChanged` handling still runs unconditionally (unaffected by this flag) — only
the redundant, unprotected re-apply is skipped, because the very next lines in this function
(preset-to-0, then `takeFade`-protected `play()`) always immediately supersede it on every path
(the CUT branch too — it unconditionally ends in its own `eng.play()`).

## 3. What was NOT done

- The second reported symptom — "switching between timeline look and normal look results in a
  cut" — was not investigated in this WO; it needs its own root-cause pass.
- `scene-transition.js`'s `runTimelineOnlyTake` (the ANIMATE-transition timeline path) has the same
  unguarded `eng.setSendTo({...}, tlId)` shape and was not audited — it is a structurally different,
  hard-cut-oriented path (`eng.play(tlId, 0)` with no `takeFade` at all, by design) and was left
  alone rather than changed on suspicion without evidence it is actually reachable in the reported
  symptom.
- Owner QA on real PGM: take a look containing a timeline layer, confirm no flash — verified here
  by a direct reproduction against the real `TimelineEngine` class, not the physical box.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo553-look-timeline-setsendto-race.test.js` — two tests. The first drives the
  real `TimelineEngine` + real `startSceneTimelineLayer` through the exact staging-then-PGM-take
  sequence and asserts no instant `OPACITY 1` write reaches the program channel; the second pins
  the `skipAmcpApply: true` argument at the source level.
- Reverted `src/engine/timeline-take.js` via `git stash` and reran: both tests fail cleanly. The
  first failure reproduces the **exact** flashed value seen on the wire —
  `{ ch: 1, layer: 210, val: 1, dur: 0 }` — confirming the smoke catches the real regression, not a
  proxy for it.
- Full offline suite: 2353/2351 pass, 0 fail, 2 pre-existing skips (real-clock-based, run outside
  CI). Lint clean on both changed files (0 errors; repo-wide pre-existing warnings elsewhere
  untouched). 0 files over the 500-line limit.
