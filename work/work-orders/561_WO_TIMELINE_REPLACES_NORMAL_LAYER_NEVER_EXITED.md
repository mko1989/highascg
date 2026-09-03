# WO-561 — the previous look's content kept playing under an incoming timeline

**Status: FIXED in repo (03.09.2026). 4 new smokes (one directly proving the fix is load-bearing by
reverting it and confirming the assertion fails). Full offline suite 2404/2402/0/2. Server
restarted, live. Owner QA owed.**
**Priority:** High — silent stale content sitting on air, invisible until a later, unrelated take
reveals it.
**Source:** `work/work-orders/todos03.09.26`: *"when timeline is playing there is still the
previous look playing under it which then surfaces with another take."*
**Related:** [WO-553](./553_WO_LOOK_TIMELINE_OPACITY_FLASH.md) (established that the timeline band
sits above both look banks — the fact that makes this bug invisible rather than an obvious visual
clash), [WO-548](./548_WO_RETAKE_SAME_TIMELINE_LOOK_KILLED_ITSELF.md) (the sibling case this fix is
careful not to reintroduce — a timeline continuing at its own slot must never be treated as exiting)

---

## 1. Investigation

`diffScenes` (`scene-transition.js`) classifies layers purely by `layerNumber`: a layer number
present in both the outgoing and incoming scene is an "update" (even if the `source` is completely
different — e.g. a plain media layer replaced by a timeline layer at the same slot); only a layer
number present in the outgoing scene and ABSENT from the incoming one is ever classified as "exit".

`buildTakeJobs` (`scene-take-lbg-jobs.js`) already has the correct handling for exactly this
"update, but really being replaced" situation — on its NORMAL (non-timeline) path:
```js
if (layerHasContent(cur) && String(cur?.source?.type || '') !== 'timeline') {
    extraExitCandidates.push(cur)
}
```
This re-derives a genuine exit candidate from whatever was previously on that slot, feeding the
same fade + teardown pipeline (`sendExitAndTimelineFadeLines` → `exitMedia`, wired in
`scene-take-lbg.js`) that a true `diff.exit` layer gets.

The TIMELINE branch of the same loop never reaches this check — it starts the timeline via
`startSceneTimelineLayer` and then unconditionally `continue`s, several lines before the
`extraExitCandidates` logic:
```js
if (layer.source && layer.source.type === 'timeline') {
    ... startSceneTimelineLayer(...) ...
    continue   // <-- never reaches the extraExitCandidates check below
}
```
So a normal layer previously occupying the slot an incoming timeline layer now claims was never
added to `exitCandidates` by ANY mechanism: not `diff.exit` (diffScenes saw it as an update), not
`extraExitCandidates` (the timeline branch skips past that check entirely), and not the orphan sweep
either (`shouldClearOrphans` requires `takeJobs.length > 0`, and a scene whose only incoming layer
is a timeline produces zero normal `takeJobs`, since the timeline branch never pushes one). The old
layer's physical content simply kept playing — untouched, unfaded, at full opacity — merely painted
over by the timeline's own physical band, which sits above both look banks (WO-553). It only became
visible again once a LATER, unrelated take tore the timeline back down and there was nothing left on
top of it anymore — exactly "surfaces with another take."

## 2. What was done

`scene-take-lbg-jobs.js`: the timeline branch now performs the identical check, before its
`continue` — if `currentMap.get(layer.layerNumber)` has real, non-timeline content, it goes into
`extraExitCandidates` too. Same exclusion as the existing normal-path check (a timeline occupying
its own old slot — WO-548's retake case — must never be surfaced as exiting itself).

## 3. What was VERIFIED

- `tools/smoke/smoke-wo561-timeline-replaces-normal-layer-exit.test.js` — 4 tests: a normal layer
  previously at the slot is surfaced as an exit candidate; a timeline continuing at its own slot is
  NOT (composes correctly with WO-548); an empty slot produces nothing; a regression test that
  reads the timeline branch's source text and confirms it consults `currentMap`.
- Reverted the fix (`git checkout --`) and reran: the regression test failed cleanly (confirmed
  against a real diff, not a tautology), then restored the fix via the saved patch and reran clean.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2404 tests, 2402 pass, 0 fail, 2 skip
  (pre-existing).
- Server restarted, live.

## 4. What remains owner-QA

- Take a normal look with content on the same layer number a timeline look also uses, take the
  timeline look over it, then take a THIRD look — confirm nothing from the first look reappears.
- Live wire-capture re-verification (this session's now-standard technique) is the next step before
  fully closing this WO.
