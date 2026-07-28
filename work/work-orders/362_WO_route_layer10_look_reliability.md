# WO-362 — Looks with routes to layer 10 "failing to play on most trys" (todos28.07.26 §1)

**Status: DONE (28.07.26 second pass — real root cause found and fixed after owner rejected first conclusion; visual pixel evidence in §3b)**

Follow-up to [WO-359](./359_WO_route_take_consistency.md) (orphan-sweep keep-set fix) and
[WO-322](./322_WO_shader_look_band_routing.md) (shader on the look band).

## 1. Investigation

Owner report: looks whose layers contain `route://1-10` producers fail to play correctly on
most tries. Test looks: project `llkk.json`, Look 12 `a3ec73bc` (L10 shader SH-3D-METERS,
L11/L12 `route://1-10` offset ±0.4) and copy `b7ab0853` (same with SH-BALATRO).

Empirical facts established with pixel evidence (PRINT → ffmpeg signalstats YAVG):

- **Route producers FOLLOW.** A `route://1-10` latched while layer 10 is empty picks up
  content the moment the source layer gains it — including via a later `CG ADD` (PRV
  split-fill probe: both halves YAVG 77.7). The "route latched onto empty layer" theory is
  disproven on this build.
- **Routes tap PRE-MIXER frames.** `MIXER 1-<src> OPACITY 0` blanks the source on screen but
  route outputs stay bright (YAVG 152 vs black ~16). This gives a binary aliveness probe:
  hide the source layer, measure the frame — anything ≥ ~22 YAVG means the routes are alive.
- **Pipeline order flaw found** in `src/engine/scene-take-lbg-amcp-pipeline.js`: the shader
  `CG ADD` (WO-322 branch of the templateCg loop) ran AFTER the play batch **and after the
  WO-354 `HIGHASCG_SHADER_WARMUP_MS` prebuffer sleep**. Consequences: (a) the warm-up slept
  before the CG ADD it was meant to warm — useless for look-to-look shader mixes; (b) route
  producers were created against a still-empty source layer (benign per the follow fact, but
  an unnecessary timing dependency).

Drills on the PRE-change deployed code already passed 8/8 (4-cycle GUI-style preview-recall +
MIX takes, then 2 MIX + 2 CUT retakes exercising visually-equal-skip/WO-218 SWAP), so the
owner's failures most likely predate the WO-359 keep-set fix + subsequent deploys.

## 2. What was done

`src/engine/scene-take-lbg-amcp-pipeline.js` — shader CG ADD staging moved to BEFORE the
prebuffer/warm-up sleep (and therefore before the PLAY/route batch). The old in-loop shader
branch is now a skip. WO-322 semantics unchanged (bank-mapped phys layer, opacity owned by
the crossfade batch, no continuity/tracking). Why this over alternatives: it makes the
WO-354 warm-up real for look-to-look mixes AND removes the only ordering in which a route is
created before its source exists — one move fixes both.

## 3. What was VERIFIED

- Offline suite: 1555 tests, 1553 pass, 0 fail (2 skip) after the reorder — includes
  `smoke-wo322-shader-look-band-routing.test.js`.
- Live pixel drill post-reorder (scratchpad `route-drill.js`, server restarted): 4 cycles of
  API takes alternating the two routed looks, banks alternating A/B as expected, source layer
  hidden each cycle: YAVG 34.1 / 46.1 / 33.3 / 46.4 → **4/4 ROUTES-ALIVE**.
- Combined with the pre-change drills: 12/12 alive across GUI-flow takes, MIX/CUT retakes,
  and the reordered pipeline.
- Remains owner QA: reproduce the original failure on the glass; if it still occurs, capture
  which flow (playlist take? edit-on-PGM? Shader Live stack?) — every flow probed here passes.

## 4. Second pass (owner: "the nested looks still dont play as they should")

The §3 "ROUTES-ALIVE" YAVG metric was INVALID: PRINT frames are RGBA and the look's border
glow alone produces YAVG 29–47 — the probe could not distinguish a live route from a fully
transparent look. Lesson: calibrate a probe against a known-bad frame before trusting it.

Real root cause (visual drill + full AMCP trace, `scene-route-deps.js`
`sendStaggeredTakePlays` twoPhaseBatch branch): for a look whose only non-route content is
CG-hosted (shader templates have `playPlan: null`), `sourceLines` is empty, and the branch
(a) DROPPED `suffixAfterSources` — the crossfade batch carrying the shader layer's fade-in,
the outgoing look's fade-outs, and border/timeline tweens — and (b) SKIPPED the leading
`MIXER <ch> COMMIT`, so the Phase-A deferred `OPACITY 0` pre-hide of the incoming bank was
applied by the TRAILING commit AFTER the route fade-ins, re-hiding the whole incoming bank.
Net effect: every bank-B take of a shader+routes look landed fully transparent (bank-A takes
survived only because teardown `MIXER CLEAR` resets that bank's opacity to 1) — "fails on
most trys". The same suffix drop also explains WO-354's "shaders don't mix well" (outgoing
fade-outs were lost → hard cut).

Fix: include the suffix whenever the batch sends anything (sources OR routes), and fire the
leading commit unconditionally when `leadingCommit` is set.

### 3b. Verified (second pass)
- AMCP trace showed `MIXER 1-110/111/112 OPACITY 0 0 (+DEFER)` with fade-ins only for
  111/112, then trailing `MIXER 1 COMMIT`; mixer state after take: all three layers at 0.
- Manual `OPACITY 1` restore rendered all three panes perfectly → opacity was the entire
  failure; producers and routes were healthy the whole time.
- Post-fix visual drill: 4 alternating MIX takes, every frame alpha=255 (fully opaque) and
  visually correct (center + both route panes live, border glow intact) — including both
  bank-B takes that previously failed. Suite 1553/1553.
