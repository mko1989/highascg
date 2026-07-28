# WO-362 — Looks with routes to layer 10 "failing to play on most trys" (todos28.07.26 §1)

**Status: DONE (28.07.26, pixel-probed live on the box — see §3; owner on-glass confirm outstanding)**

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
