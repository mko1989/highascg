# WO-1087 — Test puppet people: simulated tracked persons with a random look that never leave the stage

**Area:** tracking-vr, godot-client
**Status: IN PROGRESS (15.11.26 — built, committed, running on the box; the avatar shows only after the owner's next GUI relaunch — see "Waiting for a relaunch")**

Owner 15.11 (follow-up to WO-1086, after relaunching the GUI): *"show me an avatar with random look. make it a test
puppet. make sure the test puppet doesnt leave the stage"*.

Meaning: a synthetic tracked PERSON (not a marker) that needs no camera, walks like a person on the tracking stage,
wears a random WO-1086 look, and reaches everything that consumes tracked people (previs avatars, Auto follow / the
WO-1085 spot handover, PSN through the follow service), clearly labelled as a test, off by default.

## Investigation

**What already simulates something:**

- **WO-978 marker puppet** (`src/tracking/puppet.js`, `/api/tracking/puppet`). It writes hub **marker** 1 along a fixed
  path. A marker is an operator-placed point with no body, no look and no world person, so the previs people layer and
  the Auto director never see it as a person.
- **WO-979 imitated camera** (`src/tracking/detect-sim.js`, `previs.tracking.detection.simulate`). It fakes the sidecar:
  picture **boxes** per tracking camera. Those become floor persons only through a solved camera (`boxToFloor`, fusion
  with 2+ cameras), and `previs.tracking.detection.simulate` is project data.
- **Neither can be used on this box.** The active project ("90C PGRP Hilton Wawer") has
  `previs.tracking = { grid }` only: no tracking cameras at all (checked through `loadFullProject()`). So detect-sim
  would make boxes on no camera, and switching it on means writing the project, which is forbidden.

**Where tracked people enter:**

- `src/tracking/register.js` passes world persons (fusion shape `{id, x, y, vx, vy, height, source, cameras, keys,
  score, area, age_s}`, `fusion.js:306`) to clients in `withPins` → WS `tracking:detections` `world.persons`.
- `pinTick` hands the detect pin and the Auto director `worldPersons(now)` (2+ solved cameras) or the camera persons.
  The director only considers people when `cfg.enabled && available` (`auto-director.js:206`). Detection is off here
  and the sidecar is not running, so a puppet person must also open that gate, but only while puppets run.
- `plane_z` in the snapshot is the grid's `z_offset` (`detect-service.js:246`): 0.639 m here, the top of the stage.
  The previs places every person's feet at `plane_z`.

**Why the current GUI cannot draw a camera-less person (this decided the Godot change):**

- `person_cards_model.cards()` builds a card only for a world person with a ranked **camera view**
  (`ranked_views`: a key `cam:tid` on a non-stale camera that is in the project's tracking cameras with a raster).
- With no project cameras (`_cams` is empty), no world person can ever become an avatar in the running client.
- So the avatar needs new Godot code (`puppet_cards`) and therefore a GUI relaunch. Nothing server-side can make the
  running client draw it without writing tracking cameras into the project.

**The stage:**

- `project.previs.tracking.grid` = `{width 3, depth 15, x_offset 11.05, y_offset -3.5, z_offset 0.639}`.
- Width runs along X and depth along Y (`handover_model.gd:48`, `auto-split.normalizeGrid`). The stage floor is
  therefore X 9.55…12.55 and Y −11…4.

## What was done

### `src/tracking/puppet-wander.js` (new, pure, seeded)

- **The walk.**
  - Walks to a random point on the stage (a leg of ≥ 1 m when the stage allows), brakes for it, then pauses 1–4 s.
    In 35 % of pauses it turns to look somewhere else.
  - Each leg has its own cruise speed (0.6–1.25 m/s), never above 1.4 m/s.
  - Speed changes by at most 0.8 m/s² and the turn rate is at most 1.6 rad/s. Speed is scaled by how far the
    heading is off, so it turns before it walks off.
  - `dt` is capped at 0.25 s, so a stalled timer never turns into a jump.
- **Hard stage bound.**
  - Every step ends by clamping into the grid rectangle inset by `MARGIN` = 0.45 m (the body is about 0.25 m each
    side of its floor point). The bound does not depend on the steering being right.
  - If the grid moves or shrinks while it walks, the next step puts it back inside: the bound wins over smoothness,
    and the previs avatar eases the position anyway.
  - A grid too small for the inset makes it stand still in the centre. A missing grid falls back to the
    `normalizeGrid` default.
- **Random look.**
  - Top, bottom (different from the top), skin and hair colour come from copies of the sidecar's `traits.py`
    palettes. The smoke parses `traits.py` and fails if the copies drift.
  - Hair: 12 % bald, 43 % long, 45 % short. Height 1.55–1.95 m. The look is `locked: true`.
  - Uses mulberry32 seeded RNGs.

### `src/tracking/puppet-people.js` (new)

- Runs 1–3 puppets as **world persons**: ids from 900001 (fusion counts from 1 per run), `source: 'puppet'`,
  `puppet: true`, `name: "TEST puppet n"`, `keys: []`, their own `traits`, `age_s: 0`.
- Runs on its own 30 Hz timer and re-reads the grid every 0.5 s.
- `GET / POST /api/tracking/puppet/people {enabled?, count? 1–3, seed?, new_look?, ttl_min?}`:
  - A `seed` makes the walk and the looks repeatable (tests). Without one, each start draws a fresh seed, so each
    start brings a new random look.
  - `new_look` re-rolls the clothes, hair and height and keeps the positions.
- Same safety as the marker puppet:
  - Kept in memory only: off at every server start and never written to the project. The smoke asserts the module
    does not touch project-scenes, autosave or files.
  - Switches itself off after 120 min.
- The route is written as a literal, so `tools/dev/gen-api-contract.js` lists it; the contract now has 601 routes.

### `src/tracking/register.js`

The file stays under 500 lines because `worldPersons` was folded onto one line.

- `withPins`: `pose3d.decorate(fusion.persons(now), now).concat(people.persons())`, so the puppets are in
  `tracking:detections` `world.persons`.
- `pinTick` and `pick()`: the person list gets `...people.pinPersons()` (`w:<id>` keys, camera `world`, floor point).
  The detect pin keeps the real config, so it never switches on for a puppet. The Auto director gets
  `cfg: { ...cfg, enabled: true }` and `available || people.live` while puppets run, so Auto follow and the
  WO-1085 lanes split across them with detection off.
- Route: `people.handle` runs after the marker puppet. On shutdown, `people.stop('shutdown')`.
- **Outputs:** lanes write hub markers as they do for any detected person. These leave the box as PSN or DMX only
  through the follow service's own output masters. Nothing here turns one on: `output_enabled: false` on the box
  before and after.

### Godot client (needs a relaunch)

- `person_cards_model.puppet_cards(snap)`: world persons flagged `puppet` become avatar cards with no camera. The feet
  are at `[x, y, plane_z]`, the height is clamped, the look is their own `traits`, and the tag is their name.
- `person_cards.gd`: in the avatars style the layer shows `cards() + puppet_cards()`. Cut-outs and dummies need
  camera video, so they show no puppet.
- `person_avatar.gd`: `set_tag()` adds a billboard label in amber with a dark outline over the head. `person_avatars.gd`
  sets it from the card, so a puppet reads "TEST puppet 1" and real people carry no label.
- `puppet_people_row.gd` (new, in the Markers section under the WO-978 marker puppet) holds:
  - a "Test people" switch;
  - a 1/2/3 picker (an OptionButton, so no number-field rules apply);
  - a "New look" button;
  - a status line (`puppet_model.people_summary`).

## What was VERIFIED

- **Property smoke** `tools/smoke/smoke-wo1087-puppet-people.test.js` (5 tests, curated in `offline-test-files-3.js`):
  - **40 seeds × 10 simulated minutes**, more than 300 000 steps. Ticks are irregular (10–120 ms) with stalls of
    0.2–2 s now and then. In every step:
    - the floor point stays inside the inset stage;
    - it moves at most 1.4 m/s × dt (no teleport);
    - it turns at most 1.6 rad/s × dt;
    - its speed changes by at most 0.8 m/s² × dt.
    - Over the runs it really walks (more than 0.3 m/s on average), pauses, and covers the stage: more than 1.8 m of
      the 2.1 m inset width and more than 12 m of the 14.1 m inset depth.
  - **Grid moved and shrunk under a running puppet:** inside on the next step and for 2000 steps after. A 0.6 m grid
    makes it stand at the centre. A junk grid never gives NaN bounds.
  - **Palettes:** they equal `traits.py`. 400 looks are all from the palettes, with top ≠ bottom, all three hair
    classes and heights in range. The same seed gives the same look, and different seeds give different ones.
  - **API:**
    - It is off at creation, and the idle status already shows the stage.
    - count 2 + seed gives the expected world/pin person shape, and the same seed gives identical persons after 600
      steps.
    - new_look changes clothes but not places.
    - count 4 / 0, a fractional seed and a non-object body are refused (400); DELETE answers 405.
    - Count changes, stop and the TTL switch-off all work.
  - **Wiring greps:** the register lines (world, pin, Auto override, route, shutdown) and the Godot lines.
- **Repointed and related smokes:**
  - `smoke-wo707-follow-auto` was repointed to the new `auto.step` line with the same strength.
  - 20 tracking smokes were rerun: 978, 1085, 1086, 667, 624, 708, 709, 616 ×3, 665, 979, 797, 675, 731, 1036, 598
    contract and others. All pass.
- **Godot:** `test_puppet_people_wo1087.gd` (3 tests) together with `test_puppet_wo978` passes 53/0. The tests show:
  - puppet cards need no camera, stand at `plane_z` and wear their own look;
  - `cards()` makes no double of a puppet;
  - the avatar layer draws one, in the right top colour, at the stage top and the right height, with "TEST puppet 1"
    over it, and drops it after the hold.
  - The headless `run-client.sh --check` boot is OK.
- **On the box:**
  - The node was restarted twice under `flock -o /tmp/highascg-node-restart.lock` with the PID>1 guard; it was up
    after 6–7 s each time.
  - `POST /api/tracking/puppet/people {"enabled":true,"count":1}` → seed 1314122551, "TEST puppet 1":
    - top purple [110,60,150], bottom red [200,40,44], skin [128,86,58], black short hair, 1.751 m.
  - 60 s of live sampling of `/api/tracking/detections` (297 samples):
    - 0 samples outside the inset stage;
    - it never came closer than 0.548 m to a stage edge;
    - it walked 33.4 m (0.56 m/s on average);
    - `plane_z` is 0.639 (the stage top).
    - Peak sampled speed was 2.17 m/s. This is a measurement artefact: the HTTP poll's clock is not the 30 Hz step
      clock. The bound itself (1.4 m/s) is proven offline.
  - `/api/tracking/auto` lists `w:900001` as a person, and the running GUI's Track panel shows "Person w900001".
  - `/api/tracking/follow` `output_enabled: false` is unchanged.
- **Screenshots of :0** (read-only x11grab):
  - `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/pp/shot1.png` and `shot2.png` (scratch, not kept) show the Previs tab in 3D, "People: avatars", looking down the stage
    (the black platform), with the Track panel listing "Person w900001".
  - **No avatar is drawn**, as the investigation predicts: the running client (started 21:22:22) has the WO-1086 code,
    whose `cards()` needs a project tracking camera, and this project has none.

- **Gate loop** (after the code commit e0ee0dca):
  - Exit 0: verify:script-paths, check-max-file-lines, check-unwired-exports, `node index.js --no-http`, lint,
    format:check, npm-audit-ci.
  - run-offline-tests exit 1: 6656 passed, 1 failed. The failure was `check-wos`, because INDEX.md was stale while
    this WO was still a placeholder. After `build-index`, `check-wos` is OK.
  - Godot full suite: 28652 passed, 0 failed.

## Waiting for a relaunch (the owner's GUI; agents may not relaunch it)

- The avatar of the test person (`puppet_cards`) and its TEST label.
- The "Test people" row in Previs → Tracking → Markers.
- After the relaunch, the puppet that is already running (it stays on until stopped, the node restarts, or 2 h pass)
  appears at once in People: avatars.

## Not verified

- **The avatar render itself:** proportions, colours under the venue light, the face, and whether it stands on the
  stage top rather than sunk or floating. Only geometry is tested. A read-only :0 screenshot after the relaunch
  closes this.
- **The WO-1085 three-front handover driven by the puppet.** No heads are on Follow → Auto in this project (the Auto
  pool is empty), so no lane got heads. The puppet is in the director's person list.
- **PSN:** not sent, because the output master is off. That is intended, and it was not switched on.
- **The camera-view tracking overlay:** there are no tracking cameras to overlay on.
