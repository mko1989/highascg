# WO-804 — Calibrate the rig together: pick anchor heads, operator places them, the rest is inferred

**Status: IN PROGRESS (29.10, Opus) — built and verified offline (node + Godot suites) and by a live route probe; owner QA on the real rig open; the MVR export itself waits on WO-765**

Owner, 29.10:
> the calibration of the lightning heads should be kind of linked and work together. meaning we have a whole lighting rig with its positions types etc. when calibrating the app should count which of the heads are most crucial for calibration and guess/calculate the rest. so the operator gets, position this head at mark 1...x then position the other head etc etc.

## What is wanted

- The app knows the whole rig (fixtures, their positions, types, grouping from the MVR / patch).
- It chooses a small set of **anchor heads** (the most informative for the pose solve) and asks the operator to
  place each one at a numbered mark: "position this head at mark 1 … x".
- After the anchors are placed and solved, the app **infers the remaining heads** from the rig structure (the
  anchors' solved poses, the rig layout, fixture type and position relationships) instead of asking for every head.
- The operator then checks the inferred heads (a quick confirm or a short correction pass), not a full manual
  calibration of every head.

## Relation to existing work

- **WO-764** (open): solve each head's real pose from its marks, for the desk. This WO is the rig-level layer on top:
  choose anchors and infer the rest. Reuse WO-764's solver and mark data; do not write a second solver.
- **WO-700 R7** (calibrate heads, per-head beam corrections `offset {pan,tilt}`): the existing per-head trim stays as
  the manual correction on an inferred head.
- **WO-765** (MVR export of the calibrated rig): exports what this WO infers, marked as inferred vs measured.
- Code pointers from WO-764 (verify): `src/fixtures/calibrate-session.js:46-55` (`liveSolve`), `:106`;
  `follow_model.gd:278 apply_solve` (Godot writes only the beam corrections today).

## Investigation (agent to fill, file:line)

- How the rig is held: the MVR scene load and the fixture list (position, rotation, fixture type, universe/patch,
  any group or position-in-rig field). Find where the previs holds fixture positions in the server state.
- Anchor choice: which heads give the most constraint on the pose solve (spread, non-collinear, not all on the same
  truss). Propose a simple, testable rule (for example: farthest-point sampling over fixture positions, with a
  preference for different fixture types and different trusses), and state its limits.
- Inference: how a head's pose is predicted from solved anchors. Options to compare, not decide alone: (a) nearest
  solved anchor with a fixture-type offset, (b) a per-truss/per-row model fitted from the anchors, (c) plain
  interpolation over position. Say which one the data supports and why.
- What the operator sees: the mark list, the order, and which heads are measured versus inferred on screen.

## Investigation (29.10, Opus)

### How the rig is held

- **Server state = the follow engine's patch.** `src/fixtures/follow-service.js:132` `apply(project)` hands
  `project.fixtures` to `engine.configure(slice)` (`:138`) at boot and on every project write (`:165`
  `onProjectChanged`). `normalizePatch` (`src/fixtures/follow-patch.js:136`) gives `engine.fixtures`: per head `id`
  (`mvr-<uuid>` for MVR heads, `src/stage/mvr-patch.js:169`), `name`, `typeId` / `mode`, universe / address, and
  `pose {x, y, z, hang, yaw, pitch, roll}` (`follow-patch.js:79`, PSN metres). A typed head carries `gdtf` with the
  axis `chain` (follow-service.js resolveMode → `gdtf-ik.js chainOf`).
- **Which heads can be calibrated:** the ones `calibrate-session.js:62 liveModel(fx)` accepts (a GDTF Axis chain with
  Pan and Tilt). On the box now the MHP rig is live (`GET /api/tracking/follow`: 199 fixtures); 110 of them are
  pan / tilt heads (24 Vizi Beam, 12 MAC Quantum, 14 MAC Aura, 6 MAC Encore, 8 Robin 300, 12 P10, 24 X-Dot,
  10 Sharpy); the other 89 (Pixel Line, Pony PC, ELP, Micro Wash) have no Pan / Tilt chain.
- **No truss / group field reaches the patch.** `mvr-scene.js:96` stores per object only `uuid, name, kind, layer`;
  the walk (`:129`, `:138`) passes the parent's *matrix* down but not the parent itself, so the truss a fixture hangs
  on is lost. In MHP the `layer` is the fixture type ("ADJ ViziBeam CMY", "PixieLine"), not the truss. The 62 Truss
  objects are separate meshes with no link to fixtures. So **rows must come from positions**.
- **The layout is rows.** The 110 MHP heads sit on straight lines: same height and depth, evenly spaced in x (truss
  rows of 6–15 heads, 13–17 m long), 4 vertical ladders of 6 Vizi Beams at 1 m steps, a floor line of 18 X-Dots,
  two short diagonal Sharpy lines. Yaw is constant per row (or 0 / −180 alternating on one truss). Greedy line
  clustering (0.25 m off-line, ≤ 4 m gap) finds 16 rows + 2 single heads (prototype run, 16 ms).
- **Marks:** `project.fixtures.marks` (`follow_model.gd normalize_marks`, `calibrate_fold.gd:210`, preset 9 grid spots
  `:217`). No project on the box has any marks yet and no head has pins (`offset_map`) — **there is no real
  calibration data on the box to measure an error model from.**
- **Client-owned slice:** the server never writes `project.fixtures` (CLIENT_OWNED_SLICES; calibrate-session.js:24);
  `calibrate_fold.gd:245 _apply_solve` → `follow_model.gd:278 apply_solve` writes the patch. Godot's
  `normalize_fixture` (`follow_model.gd:47`) **whitelists keys** (`manual_patch` at `:79` is the last added) — a
  `calibrated_pose` written today would be dropped by the next normalize. It must be added there.

### WO-764's solver and mark capture (what can be reused)

- Mark capture = the live session (`calibrate-session.js:151` `point` with `at: [x, y, z]`, `hold: false` start
  `:120`): it reads the angles the real head gets from DMX (`:171`, physical degrees of the GDTF function) and stores
  `{pan, tilt, x, y, z}`. Reused as is: the rig flow calls `handle({action: 'point', id, at})` for the prompted mark.
- **WO-764's pose solve is not built** (no `calibrated_pose` anywhere in src/ or godot/). The existing
  `solveFixturePose` (`calibrate-solve.js:209`) models the *generic* head (`follow-ik.js:31 beam`, commanded degrees),
  while live points are *physical* GDTF angles through `gdtf-ik.js:82 beamOf` (lens offset, chain transforms). WO-764's
  note that the points "can feed the solver as they are" holds only for generic heads. The forward-model pattern
  already exists for the offset solve (`calibrate-solve.js:251 solveOffsets(pts, forward)`, `:309 solvePlace`, both
  LM through the shared `lm`). So the anchor pose solve is the same LM over `(x, y, z, yaw)` through the head's own
  `forward` (hang, pitch, roll kept from the patch, as WO-764 plans), added next to them in calibrate-solve.js — the
  WO-764 solver, not a second one.

### Anchor rule (inputs: patched poses of the calibratable heads, stage marks)

1. Rows by line clustering over the head positions (above).
2. One anchor per row of 2+ heads (the head nearest the row middle); two (the end heads) when the row is 6 m+ in plan
   with 4+ heads — two measured heads give the row's turn and rake. At least 3 anchors overall.
3. Order by farthest-point sampling from the rig's outermost head: the first 3 already span the rig, so stopping early
   still gives the rig-wide fit. An optional `max` caps the count.
4. Marks per anchor: 3 (the solve's minimum, `MIN_POINTS`), the mark nearest under the head first, then each farthest
   from those taken (spread, non-collinear).

MHP result: **22 anchors of 110 heads** (88 inferred), 66 aims. Limits: a scatter with no lines gets the rig-wide
fit only; two rows touching end to end on one line count as one; type is not an input (rows mix types: P10 + MAC
Quantum on one truss) — the solve does not care about the type, only the head's own GDTF forward model does.

### Inference model — the three options compared

There is no measured error data, so the comparison is a simulation on the real MHP layout (110 heads, the anchors
above, 200 trials, anchor solve noise 2 cm). Truth = the patch moved by an assumed error model: **global** (whole rig
turned ~1.5°, shifted ~0.3 m: the MVR origin vs the taped stage origin), **rows** (each truss trimmed ±15 cm, shifted
±10 cm, turned / raked ±0.5°), **heads** (±3 cm clamp spread). Inferred-head position error:

| truth | patch as is | (a) nearest anchor (same type first) | (b) rig fit + per-row model | (c) IDW interpolation |
|---|---|---|---|---|
| global only | 46.7 cm (p95 91.7) | 8.6 (p95 26.5) | **3.5 (p95 6.3)** | 5.0 (p95 12.6) |
| rows only | 19.6 (34.8) | 13.0 (39.9) | **5.5 (9.8)** | 12.9 (26.4) |
| global + rows + heads | 52.0 (94.7) | 16.8 (45.6) | **7.3 (13.0)** | 14.4 (28.7) |
| same, only 6 anchors | 48.8 (93.7) | 30.0 (64.6) | **18.6 (37.6)** | 21.3 (41.9) |

- (a) copies one head's error to its neighbours: 25 of the 88 inferred heads have their nearest anchor on another
  row (trusses 1.5 m apart, ladders beside trusses), and it cannot see a turn of the rig.
- (c) blends trusses that hang at different trims, and extrapolates flat outside the anchors.
- (b) matches the structure the data has (rows) and the way a rig is really off (origin, then per-truss trim).
  **Chosen: (b)** — a rig-wide fit (plan turn + shift, mean height) from all anchors, then per row the anchors'
  remaining error: constant with one anchor, linear along the row with two. A row without an anchor gets the rig fit
  only. Yaw: rig turn + the mean yaw residual of the row's anchors. Pitch / roll / hang stay as patched.
- Residual reported per head: measured = the solve's fit (`rms_deg`) + how far the model alone misses it
  (leave-one-out, m); inferred = leave-one-out misses of anchors that were predicted the same way the head is
  (refined while building, see below) — an honest "a measured head like this one was predicted this well". Unknown
  (null) with fewer than 2 anchors.
- The simulated error model is an assumption; owner QA on the rig is what proves it.

### What the operator sees

Lighting → Calibrate heads → "Calibrate the rig…": one prompt at a time — "Anchor 3 of 22 · aim <head> at <mark>
(2 of 3)", the head selected in the 3D view so the Programmer above aims it (or the console), "Beam is on <mark>",
Skip mark, Undo, "Infer the rest now". After the anchors: a list of every head with *measured* / *inferred* and its
residual, worst first; per head: Measure (adds it as an anchor), the existing beam offset trim (WO-700) as the nudge;
Apply writes `calibrated_pose {…, source, residual_m}` into the patch (export-only data, R6: the previs pose stays).

## Plan (after investigation)

1. Anchor selection function over the rig (pure, testable with a fixture set from a real MVR file in the repo tests).
2. Operator flow: "place head X at mark N" for each anchor, one at a time, using WO-764's mark capture.
3. Solve the anchors with WO-764's solver; infer the rest; mark each head `measured` or `inferred` with a residual.
4. Confirm pass: the operator sees the inferred heads and can accept, nudge (WO-700 offset) or mark them measured.
5. Export via WO-765 with the measured/inferred flag.

## Acceptance

- On a real rig MVR (the MHP rig in the repo fixtures, or a test MVR): the number of heads the operator places is
  well below the total, and every inferred head's residual is reported.
- Pure tests for the anchor selection and the inference; offline suite and the curated test list updated.
- Owner QA on the rig: place the anchors, confirm the inferred heads point at the right place.

## What was done (29.10, Opus)

Server (pure first, then the session):
- `src/fixtures/rig-anchors.js` (new, 200 lines) — `findRows` (greedy line clustering), `chooseAnchors` (rule above,
  `max` option), `marksFor`, `normalizeMarks`, `spreadOrder`.
- `src/fixtures/rig-infer.js` (new, 161) — `inferRig` / `rigFit` / `predict`: model (b). Residuals, as built: a
  measured head carries its solve `rms_deg` and `loo_m`; an inferred head's `residual_m` is, on a row with 2+ anchors,
  the nearest one's leave-one-out miss; on a row with one anchor, the RMS of the misses of anchors that shared a row
  (each predicted from one row-mate — exactly how a one-anchor row is predicted); on a row with none, the RMS of the
  misses of anchors alone on their row (predicted by the rig fit only). `basis: 'row' | 'rig'` says which.
- `src/fixtures/calibrate-solve.js` (+54 → 389) — `solvePoseForward(pts, forward, {pose})`: the WO-764 pose solve
  through the head's own model (LM over x, y, z, yaw via the shared `lm`, 15° yaw seeds, hang / pitch / roll kept,
  report `rms_deg / max_deg / spread_m / moved_m / warning`). This is the first slice of WO-764's server solve.
- `src/fixtures/calibrate-session.js` — exports `liveModel` (the GDTF forward model + DMX read) for the rig session.
- `src/fixtures/rig-calibrate.js` (new, 198) — the session behind `GET / POST /api/tracking/follow/calibrate/rig`:
  `start {max?} | point | skip | skip_head | undo | infer | measure {id} | end`. Each `point` is the WO-700 live
  session's `point` with the prompted mark's `at` (mark capture reused, one head in a session at a time); the last
  mark of an anchor solves it and opens the next. Every reply: anchors + status / fit, `prompt`, `result`.
- `src/tracking/register.js` (+5 → 499, shared file at its limit) — require, `_rig`, the route line (before the
  single-head calibrate route), boot, shutdown.
- `docs/wiki/api/contract/http.md` — regenerated (`tools/dev/gen-api-contract.js`): only the new route row added.

Godot:
- `follow_model.gd` (+45 → 382) — `normalize_fixture` keeps `calibrated_pose` (`normalize_calibrated_pose`: x, y, z,
  yaw, pitch, roll, hang, `source` measured | inferred, `residual_m?`, `rms_deg?`); `apply_rig(patch, heads)` writes
  it, never the patch pose / trim / pins (R6).
- `features/previs/fixtures/rig_calibrate_fold.gd` (new, 169) — the operator flow; hosted in `calibrate_fold.gd`
  (+2 → 338) under the marks editor. The prompt selects the head (the Programmer aims the selection); the result list
  is worst residual first (amber over 0.10 m); select a head → Measure this head / trim its beam offset in the fold
  above; Apply to patch writes `calibrated_pose` for every head.

Tests: `tools/smoke/smoke-wo804-rig-calibrate.test.js` (new, 12 tests, curated list `offline-test-files-2.js`) on
`tools/smoke/fixtures/mhp-rig-movers.sample.json` (the 110 MHP pan / tilt heads, extracted from the live project's
normalized patch); `godot/client/tests/test_follow_model.gd` `test_rig_result_writes_calibrated_pose_only`.

Not done here: the MVR export (WO-765 is not built; `calibrated_pose.source` / `residual_m` is the flag it will
write). No "desk pose" Inspector line per head (WO-764's own item).

## Verified

- Offline suite `node tools/ci/run-offline-tests.js`: 3450 tests, 3448 pass, 0 fail (exit 0). The first run failed
  only `smoke-wo598-api-contract` (http.md stale by the new route) → regenerated. `check-max-file-lines`: 0 over 500;
  prettier (tools/ci) clean; eslint on the new / changed JS clean.
- Godot suite (`run_tests.gd`): 21928 passed, 0 failed. `rig_calibrate_fold.gd` has no test that loads it; it was
  `--check-only` compiled with the autoloads stubbed (clean; the check was shown to catch a planted error).
- WO-804 smoke on the MHP rig: 16 rows (4 ladders, the 18-head X-Dot line) + 2 lone heads; **22 anchors of 110**,
  first three span > 20 m² of plan; 3 spread marks each. Inference: rig turned 1.2°, shifted, trusses at their own
  trims → every inferred head within 2 cm / 0.1° yaw. Full flow over the live session with the test-spot GDTF model
  for all 110 heads: 66 prompts, every anchor solved from DMX angles, **every head within 5 cm** of the truth, every
  inferred head on a measured row reports residual < 5 cm; skip / undo / infer / measure / end; no session left open.
- Live box (node restarted, dev mode): `GET …/calibrate/rig` → `{"active":false}`; `POST {"action":"start"}` → 409
  "place at least 3 stage marks first" (no project has marks — this also shows the live engine found 2+ heads);
  `point` before start → 409; bad JSON → 400; PUT → 405; `GET …/calibrate` still 200 (router order fine). The plan
  on the live MHP project with the 9 preset marks: 109 calibratable heads, 16 rows, 22 anchors, 87 inferred.
- **Not verified:** owner QA on the real rig (place marks, aim the 22 anchors, check that inferred heads point where
  they should); the error model the comparison assumed; floor heads (X-Dot / Sharpy at 0.15 m) aimed at floor marks
  are near grazing — the solve is fine noise-free but the real accuracy there is unknown; the Godot fold's layout on
  screen (not opened in the owner's GUI).
