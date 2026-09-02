# WO-541 — A look whose only content is a timeline never lit up

**Status: FIXED in repo (02.09.2026). 4 smokes (2 verified to fail without the fix), suite
2270/2268/0/2 → 2282/2280/0/2. Owner QA on real PGM still owed.**
**Priority:** High (on-air; the look silently never appears)
**Source:** owner 02.09: reported a timeline inside a look "does not play as it should"; follow-up
narrowed it to "nothing appeared at all" — the layer stayed invisible, not a flash and not a cut.
**Related:** [WO-528](./528_WO_TIMELINE_IN_LOOK_CUTS_AND_DESTABILISES.md),
[WO-537](./537_WO_TIMELINE_IN_A_LOOK_RESUMES_INSTEAD_OF_STARTING.md),
[WO-540](./540_WO_CH1_HALF_RATE_TEARS_DOWN_EVERY_FADE_AT_50_PERCENT.md), WO-519 (fail-dark class),
WO-152 (B152.1, the preset-then-fade contract this bug violates)

---

## 1. Investigation

Before touching code, checked whether the live box was reproducing WO-540's ch1 half-rate drift
(the only other open item in this bug family): Caspar had restarted at 09:45:11 (logged one
`Reference signal: not detected` on the DeckLink 8K Pro during that startup, WO-540's prime
suspect). Measured channel 1 directly — a 50-frame opacity ramp on the scratch layer 900 completed
in 1024 ms (≈48.8 fps, healthy) — so the hardware fault was NOT active. That, plus the owner's
"nothing appeared at all" (not "cut", not "flash"), pointed away from WO-540/537/528 (all already
fixed or a different symptom) and toward a fresh read of the take pipeline.

### 1a. `startSceneTimelineLayer` presets ALL of a timeline's physical layers to 0

`timeline-take.js:254-289`. On a MIX (`fadeDur > 0`), before `eng.play()` even runs:

```js
await amcp.batchSendChunked(
    physLayers.map((L) => `MIXER ${channel}-${L} OPACITY 0 0`),
    { skipMixerPreCommit: true },
)
```

This is unconditional — every physical layer the timeline occupies gets written to 0 immediately,
regardless of what happens afterward. The function returns the subset the CALLER must fade back in
(WO-152 B152.1's contract). If the caller never issues that fade, the layer stays at 0 forever.

### 1b. A timeline-type layer never becomes a `takeJob`

`scene-take-lbg-jobs.js:54-71` — `buildTakeJobs` loops `incomingSorted` and for
`layer.source.type === 'timeline'` calls `startSceneTimelineLayer`, collects its returned physical
layers into `timelineFadeInPhys`, then `continue`s — it never reaches the code further down that
pushes a `takeJobs` entry. A timeline layer structurally cannot produce a takeJob.

### 1c. On a plain MIX, `mergeMixerExtras` is unconditionally empty

`scene-take-lbg-merge.js:95` — `buildMergeMixerExtrasForTake`: `if (!isMergeTransition || fadeDur
<= 0 || forceCut) return []`. A plain (non-merge) MIX always gets `[]` here.

### 1d. The only code that builds the timeline's fade-in was gated on takeJobs

`scene-take-lbg-amcp-pipeline.js:173` (pre-fix): `if (takeJobs.length > 0 || mergeMixerExtras.length
> 0) { … }`. This ONE block is the only place `crossfadeLines` gets built — including the
timeline's own fade-in ramp, folded in at (pre-fix) line 239: `for (const L of timelineFadeInPhys)
{ … crossfadeLines.push(\`MIXER … OPACITY 1 ${fadeDur} …\`) }`.

So: a look whose every layer is a timeline (1a+1b) on a plain MIX with something else already live
(1c doesn't apply, `shouldRunBankCrossfade` is true because `currentMap.size > 0`) hits
`takeJobs.length === 0 && mergeMixerExtras.length === 0` — the gate at 1d is false, the entire
block is skipped, `crossfadeLines` is never built, and the preset-to-0 from 1a is never followed by
anything. **Permanently invisible.**

The `takeJobs.length === 0` branch inside that block (comment: *"Timeline-only / exit-only
crossfade: sendStaggeredTakePlays drops suffix lines when there are no source PLAY lines to ride
on — send directly"*, line 278) was already written to handle exactly this case — it could simply
never be reached. A prior session had also started a dedicated `runTimelineOnlyTake` /
`isTimelineOnlyScene` path in `scene-transition.js` for this exact scenario, but it was never wired
to any caller (confirmed: zero call sites outside its own module) — the generic path is what
actually runs today.

### 1e. Confirmed by failing test, not just by reading

Reverting the fix and running the new smoke (`tools/smoke/smoke-wo541-timeline-only-look-crossfade.test.js`)
fails exactly as predicted: `sent` is `[]` — no fade-in line, no outgoing fade-out line, nothing.

## 2. What was done

`scene-take-lbg-amcp-pipeline.js:173` — widened the gate:

```js
if (takeJobs.length > 0 || mergeMixerExtras.length > 0 || (shouldRunBankCrossfade && timelineFadeInPhys.length > 0)) {
```

Traced every consumer of `takeJobs`/`mergeMixerExtras` inside that block (`sendTakeJobsLoadAndMixerBatch`,
`hasPhaseA`, the shader warm-up loop, `needsIncomingFadePreroll`) to confirm each is a safe no-op
on empty arrays — the block was already written to tolerate `takeJobs.length === 0`, it just could
never be entered that way. `hasPhaseA` is computed before this gate and is unaffected (still false
in the timeline-only case, so border lines still take the pre-existing legacy-send path).

**Why not fix it inside `startSceneTimelineLayer` instead** (e.g. don't preset to 0 unless a caller
is guaranteed to fade it back in)? The preset is correct and necessary (WO-139's flash-race fix) —
the actual defect is downstream, in a gate that forgot a timeline-only look is a real shape of
"something to crossfade." Fixing the gate is the minimal, correctly-scoped change; fixing the
preset would just move the same gap to a different asymmetry.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo541-timeline-only-look-crossfade.test.js` — 4 tests against the real
  `runSceneTakeLbgAmcpPipeline`: (1) `takeJobs=[]`, `mergeMixerExtras=[]`,
  `shouldRunBankCrossfade=true`, non-empty `timelineFadeInPhys` → the fade-in ramp IS sent; (2) the
  previously-live outgoing layer still fades out in the same batch; (3) `shouldRunBankCrossfade:
  false` stays a no-op here (owned by the other, already-correct `sendExitAndTimelineFadeLines`
  path — confirmed by reading, not just asserted); (4) no timeline + no takeJobs stays a no-op
  (unrelated empty takes unaffected by the widened gate).
- Reverted the one-line fix and reran: tests 1 and 2 fail cleanly (`sent: []`), confirming the
  smoke actually catches the regression rather than passing vacuously.
- Full offline suite: 2282 / 2280 pass / 0 fail / 2 skip (pre-existing, CI-gated). Lint 0
  errors/warnings on changed files. `check-max-file-lines.js`: 0 files over 500.
- **Not done:** owner QA on real PGM (drop a timeline as a look's only content, take it over
  something else already live, plain MIX, confirm it now dissolves in instead of staying dark).
