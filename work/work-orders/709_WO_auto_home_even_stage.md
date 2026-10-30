# WO-709 — Auto follow: home position (the stage lit evenly) after nobody is seen

**Area:** tracking-vr
**Status: DONE server side (23.10.26: smoke-wo709 9/9, smoke-wo708 18/18, offline suite 2925 / 2922 pass / 1 known WO-308 fail; live-box probe 23.10 by the lead (API + home on the box, overlay in the GUI); owner QA: two people on stage)**

Owner, 23.10.26: *"after a while with no person detected the fronts should reset to a home position which is lighting
the stage evenly."*

Built together with WO-708 (same director, `src/tracking/auto-director.js`); shared contract in the session
scratchpad `wo708-contract.md`.

## Investigation

- **Today nobody in view = hold forever.** `src/tracking/auto-follow.js:36-38`: the replace pin writes the marker
  held at its last point with status 0 (`detect-pin.js:198-204`); the engine keeps aiming there
  (`src/fixtures/follow-engine.js:236-241`). There is no timeout and no other target.
- **The stage rectangle exists server-side only as raw project data.** `project.previs.tracking.grid` is
  Godot-owned; the detect service reads only `grid.z_offset` (`src/tracking/detect-service.js:199-204`). The meaning
  is defined by the Godot twin `godot/client/features/previs/tracking/tracking_model.gd:54-64` (`normalize_grid`:
  keys `width` 0.5…200, `depth` 0.5…200, `spacing`, `x_offset`, `y_offset`, `z_offset`, defaults
  `GRID_DEFAULT` `:11`) and `:112-117` (`grid_corners`): the rectangle is centred on `x_offset` across X
  (`x_offset ± width/2`) and on `y_offset` along Y (`y_offset ± depth/2`), at `z = z_offset`. (The contract wrote
  `{ x, y, width, depth }`; the real keys are `x_offset` / `y_offset`.)
- **The engine has no notion of a non-marker target.** `follow-engine.js:232` only looks up hub markers, and its
  read-through weight counts only `following` as tracking (`:244`).
- **Non-crossing beams.** A minimum-total-Euclidean-length matching of heads to points never has two crossing
  segments (swapping a crossing pair always shortens the total, triangle inequality), so `hungarian.js` `assign`
  on plain distances gives it.

## What was done

- **`src/tracking/auto-director.js`: the home state.**
  - **Idle.** `idle_s` is the time since the last person was seen (coast included). It is 0 while anyone is seen,
    and while detection is off.
  - **Home active** = something wants Auto (a pool head or a managed PTZ camera) AND (forced, OR detection on +
    nobody seen + `idle_s ≥ after_s`). `after_s` defaults to 10, with a range of 3…600, and persists in
    `~/.highascg/tracking-auto.json`.
  - **From boot:** an empty stage goes home after `after_s` too.
  - **Leaving:** any person seen ends a timed home at once and is followed at once (the join delay applies only when
    someone is already followed).
  - **`POST /api/tracking/auto/home {now:true}`** forces home until someone who was not in view at the press appears.
    `{now:false}` cancels it.
  - **The heads.** While home is active, `resolveAuto` returns every pool head's point as
    `{ x, y, z, status: 1, stale: false, home: true }`, and `ptzTargetOf` returns 'home' for managed cameras.
  - **The points** are recomputed only when the pool (ids, pose x / y) or the grid changes.
- **`src/tracking/auto-split.js`:**
  - **`normalizeGrid`** mirrors the Godot `normalize_grid`: the same `GRID_DEFAULT`, width / depth 0.5…200, spacing
    0.1…50, and non-numbers fall back to the default.
  - **`homePoints(grid, n)`:**
    - rows = round(√(n·depth/width)), cols = ⌈n/rows⌉, then rows = ⌈n/cols⌉, so no row is empty.
    - The points go row by row from downstage. Each row's points are centred in their own cells across the full
      width (inset half a cell), so a short last row still covers the stage.
    - z = `z_offset`; x / y are centred on `x_offset` / `y_offset`, as in the Godot `grid_corners`.
  - **`homeAssign`** maps heads to points by `hungarian.js` on plain floor distance from the fixture pose. That is a
    minimum-total-length matching, so no two beams cross.
- **`src/fixtures/follow-engine.js`:** a target with `home: true` gives the state `'home'` and counts as tracking for
  the read-through fade. The engine adds `aim_z` as for any target, so a head aims at the height it would light a
  person at that spot.
- **Why this approach:**
  - **Rejected: hub markers for the home points.** They would show up as phantom markers in the previs and PSN.
  - **Rejected: a fixed preset per head.** The project has none, and it would not follow re-patching.
  - **Chosen:** home points derived from the grid the operator already measured.

## Verified

- **`tools/smoke/smoke-wo709-auto-home.test.js`: 9/9.**
  - Home: not at 9 s, active after 10 s, `target.home`, z = z_offset, a stage-right head gets a stage-right point.
  - Home from boot; a person appearing leaves at once, is followed on A1, and `idle_s` goes to 0.
  - `after_s` 3 works and 601 gives 400.
  - Forced home with someone in view; it ends on a new person; `now:false` cancels.
  - Detection off: no timed home (hold) but the forced home works.
  - Home points for n = 1…16: inside the rectangle, rows and columns evenly centred; 2 × 2 for a 10 × 6 m stage with
    4 heads; one row on a wide stage; the offsets are the centre.
  - No crossing beams over three rig layouts, plus left-to-right order on a truss.
  - The grid defaults are parsed from `tracking_model.gd` `GRID_DEFAULT` and its clamp / corner lines.
  - The engine reports state 'home'.
- The WO-708 suite covers the PTZ 'home' target (`smoke-wo708-auto-split` 18/18). The offline suite counts and gates
  are in WO-708.
- **Not verified (lead / owner):** on the box, empty the stage for 10 s and watch the fronts spread over the grid in
  the previs and on the rig.
- **Owner QA:**
  1. Fronts on Auto, then walk off stage. After 10 s the fronts spread evenly over the stage rectangle, with no beams
     crossing.
  2. Walk back on: they pick you up at once.

### Live box (23.10.26, lead)
- After the restart, `home.idle_s` counted 8 → 13 → 18 with cam_1 / cam_2 detecting nobody.
- `home.active` went true at 10 s.
- `GET /api/tracking/follow`: both Focus Profiles in state **home**, at pan −2.89° / −10.36°, tilt ≈105°.
- The grid is 6 × 3 m centred (0, 3), so 2 heads → points (−1.5, 3) and (1.5, 3). Profile 1 (x −2.5) takes the left
  point and Profile 2 (x +2.5) the right, so the beams don't cross. The pans are not mirror images because of the
  per-head WO-700 beam offsets.
- Art-Net output was on (`artnet`).
- Seeing the stage lit evenly = owner QA.
