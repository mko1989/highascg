# WO-528 — A timeline inside a look cuts instead of mixing, and destabilises later look plays

**Status: DIAGNOSED (14.08.2026 — two concrete causes located with file:line; NOT fixed. Both fixes are on the on-air take path and one is a deliberate trade-off that cannot be flipped without new work — §4.)**
**Priority:** High (on-air transition quality; owner is hitting it live)
**Source:** owner 14.08: *"transition between timeline and looks is a cut instead of mix. when a timeline is used inside a look, it just transition seemingly randomly and screwes up subsequent looks plays."*
**Parent:** [WO-139](./139_WO_TIMELINE_TAKE_SMOOTHNESS.md) — same subject, whose **A139.2 operator QA on real PGM was never run**. This report *is* that QA, arriving 5 weeks late.
**Related:** WO-519 (a fail-dark path in the same code, fixed 13.08)

---

## 1. Which path is which

Two different entry points, and only one of them was ever hardened:

| path | code | state |
|---|---|---|
| **Take button** → timeline to PGM | `runTimelineDirectTake` | WO-139 T139.2 made it a **single frame-locked batch**: preset, PLAY + clip DEFER tweens, one batch of fade-in + fade-out, **one `MIXER COMMIT`**. Sends a resolved duration (`timeline-transport.js:361`). |
| **Timeline as a layer inside a look** | `startSceneTimelineLayer` (`timeline-take.js:249`), called from `scene-take-lbg-jobs.js:63` and `scene-take-pgm-only.js:189` | **Never given that treatment.** This is the owner's case. |

## 2. Cause A — a "+ MERGE" / "+ ANIMATE" look transition always cuts the timeline

`scene-take-lbg-jobs.js:60-61`:

```js
const fadeDur = forceCut || isMergeTransition || !(globalT?.duration > 0) ? 0 : globalT.duration
```

and `startSceneTimelineLayer` (`timeline-take.js:257`):

```js
if (!(opts.fadeDur > 0)) { eng.play(tlId, startPos); return [] }   // plain play — a CUT
```

`isMergeTransition` is `isLayerAnimateTakeTransition(globalT.type)` — **any type ending `+ MERGE` or
`+ ANIMATE`** (`scene-transition.js:180-183`). So selecting *"MIX + MERGE"* with a 25-frame duration
still cuts the timeline layer, while the rest of the look merges. The transition dropdown says MIX;
the timeline pops.

**This is deliberate, and that is why it is not a one-line fix.** The comment above it:
*"Merge transitions keep the plain-play path (no preset) — their fade batches never run."* On the
merge path the caller never issues the fade-in batch, so presetting opacity to 0 would leave the
timeline layer **dark forever** — the fail-dark class of WO-519. Setting `fadeDur = 0` trades a
visible cut for a guaranteed-visible layer. Flipping it requires giving the merge path a real
fade-in, not deleting the condition.

## 3. Cause B — "seemingly randomly" is a three-step race

`startSceneTimelineLayer` does, as three separate AMCP operations with the engine running between
them:

1. `MIXER … OPACITY 0 0` for every physical timeline layer (`timeline-take.js:263-270`)
2. `eng.play(tlId, startPos)` — **the timeline engine now starts ticking and writing its own
   `MIXER OPACITY` for keyframed clips**
3. returns the non-keyframed layers for the *caller* to fade in, in a later batch

Between 2 and 3 there are two writers on the same layers and no commit barrier — exactly the
last-writer-wins hazard WO-139 T139.2 eliminated on the Take path by collapsing everything into one
batch and one `MIXER COMMIT`. Whichever write lands last decides what the operator sees, and that
depends on engine tick timing, so the same take looks different run to run. That is the
*"seemingly randomly"*.

**"screwes up subsequent looks plays"** follows from the same thing: any physical timeline layer left
at opacity 0 by a lost race stays at 0 — the layers are reused by the next look, so the damage
outlives the take that caused it. WO-519 removed one route to that state (a keyframed clip that never
reaches visible is no longer excluded from the fade); the race is a second, independent route.

## 4. Why this is not fixed here

Both fixes are on the live take path, and WO-139 is a standing demonstration of how easy that is to
get wrong — its own T139.1 had to patch a stale-0 that made CUT takes invisible.

- **Cause A** needs the merge/animate path to gain a genuine fade-in for timeline layers. Removing
  `isMergeTransition` from the condition alone reintroduces fail-dark.
- **Cause B** needs `startSceneTimelineLayer` restructured so the preset, the PLAY and the fade-in
  ride one batch with a single commit — the T139.2 shape — which means changing what it returns and
  how both callers (`scene-take-lbg-jobs`, `scene-take-pgm-only`) sequence their own batches.

Neither should be attempted without the ability to watch real PGM, which is the owner's side.

## 5. What the owner can confirm cheaply

Worth knowing before the fix, because it separates A from B:

1. Does the cut happen with a **plain `MIX`** look transition (no `+ MERGE` / `+ ANIMATE`)? If MIX
   mixes and MIX+MERGE cuts, that is Cause A alone and Cause B may be a separate, rarer fault.
2. Is the transition duration non-zero in the look's own transition settings? `fadeDur` is also
   forced to 0 by `!(globalT?.duration > 0)`.
3. When a later look misbehaves, does re-taking that look fix it? A layer stuck at opacity 0 is
   repaired by the next take that fades it in — which would confirm the stuck-opacity mechanism.

## 6. Work log

- 2026-08-14 — Owner report triaged. Two causes located: the merge/animate carve-out forcing a cut
  (deliberate, guarding against fail-dark) and the un-batched preset/play/fade sequence racing the
  engine. Not fixed: both are on-air take-path changes needing PGM observation.
