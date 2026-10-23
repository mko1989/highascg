# WO-708 — Auto follow: split the fronts across several people, pins 1–9

**Status: DONE server side (23.10.26: smoke-wo708 18/18, wo709 9/9, wo707 6/6, related smokes 160/160, offline suite 2925 / 2922 pass / 1 known WO-308 fail; live-box probe 23.10 by the lead (API + home on the box, overlay in the GUI); owner QA: two people on stage)**

Owner, 23.10.26: *"ok, so it worked quite nicely for first tests. second thing is more than one presenter on auto it
should split the lights so they follow half front lights one presenter the other the second and so on. […] if they
should be pined as 1...9 with the pin comes quick sets, follow with at least 1 fixture, ability to quickly adjust how
many should follow."*

Shared contract with WO-709 / WO-710 (Godot overlay) / WO-711 (PTZ): the session scratchpad `wo708-contract.md`
(marker ids, split rules, API, WS, persistence).

## Investigation

- **Today's Auto is one person.** `src/tracking/auto-follow.js:20-41` keeps one hub marker, `AUTO_MARKER_ID` 64999,
  driven by one `DetectPin` in replace mode. `DetectPin._tracked` (`src/tracking/detect-pin.js:217-255`) picks one
  person: sticky by track, else nearest the last, else the largest. A second person is never followed.
- **Every Auto head aims at that one marker.** `src/fixtures/follow-engine.js:232` resolves
  `marks.get(fx.follow)`, so all heads with `follow == 64999` aim at the same point. There is no per-head choice.
- **Wiring.** `src/tracking/register.js:141-144` (pinTick) builds the person list (fused world persons with 2+
  solved cameras, else camera persons) and steps auto-follow; `:210` (withPins) merges its attachments for the
  `marker` badge on detections.
- **The follow engine's patch** comes from `project.fixtures` via `src/fixtures/follow-service.js:122-128`
  (`engine.configure`), exposed to register.js as `_follow.engine` (`register.js:458`). The fixture pose is
  `fx.pose { x, y, z }` (`src/fixtures/follow-patch.js:79`), the floor point used for "nearest head".
- **Reusable maths.**
  - `DetectPin` replace mode already does the per-person pick, velocity EMA + prediction + smoothing, and the
    floor-cast of a camera box (`detect-pin.js:188-213`, `pointOf` `:92` → `detect-model.js:119` `boxPoint`). Fed a
    person list filtered to one key, it follows exactly that person and holds (status 0) when they are gone.
  - `src/tracking/hungarian.js:26` `assign(cost, gate)` is a rectangular min-cost assignment.
- **Presenter names.** `src/tracking/presenters.js:100-103` (`view`) carries `person` = the bound person key;
  `list()` (`:228`) gives every presenter with its name.
- **register.js is at 497 lines** (`node tools/ci/check-max-file-lines.js`), so the director and its routes must live
  in their own files.
- **Text-pinning smokes on register.js** (must keep passing): smoke-wo707 (`const wanted = …`, `autoFollow.step(…)`),
  wo616-follow-artnet, wo624-tracking-pick, wo624-fixture-calibrate, wo616-beam-spot, wo667-posed-dummies,
  wo675-presenters / bodies.

## What was done

- **`src/tracking/auto-director.js` (new): the director.**
  - **Lanes.** Each followed person is a lane: one hub marker driven by its own `createAutoFollow` (WO-707's replace
    `DetectPin`) fed only that person's entry. The pick, the smoothing and the camera-box floor-cast are all
    DetectPin's; nothing is re-implemented. Pinned persons drive **Pin k = 64980 + k** ("Pin k"); up to 9 unpinned
    persons drive **A1…A9 = 64999…64991** (A1 keeps the WO-707 name "Auto — tracked person"). The A lanes are
    compacted so A1 is always the first. A marker exists only while its lane does.
  - **Join.** The first person is followed at once (WO-707, and leaving home "at once"). With someone already
    followed, a newcomer must be seen for `JOIN_S` = 0.4 s first, so a one-frame false detection never re-splits.
  - **Lost.** A lane whose person is gone holds (status 0) for `LOST_S` = 3 s, then drops. A pin frees its key at
    the same time and keeps its heads / ptz settings.
  - **Re-acquire (extension, see Deviations).** A new person matched within DetectPin's own re-acquire gate
    (`REACQUIRE_MAX_FLOOR_M` 0.75 m for world persons, `REACQUIRE_MAX_CENTER_DIST` 0.15 of the frame on the same
    camera) near where a lane was lost inherits that lane, and its pin. This is the same rule the single WO-707 pin
    used; without it, every ByteTrack / fusion id churn would split the rig with a phantom for 3 s.
  - **Split.** `resplit()` runs only when the signature changes: the lane ids, each slot's head count and the pool
    fixture ids. Position jitter never re-splits. The assignment maps fixture → lane id, not marker, so a compaction
    that renumbers a marker moves no head.
  - **Other parts.** `resolveAuto(fx, marks)` (engine hook); `ptzTargetOf(camId)` (slot camera → that slot's person,
    else `auto` → A1, else 'home' while home is active, else null); `setPtz(svc)`; `snapshot()` (the GET body);
    `pin` / `slot` / `home` (the POSTs, validated).
- **`src/tracking/auto-split.js` (new): the pure maths.**
  - `splitHeads`:
    - Explicit slots take their n heads first, the counts capped in slot order.
    - The rest is shared evenly between the share lanes, which are the pinned slots with heads 0 in slot order, then
      the unpinned persons.
    - Both stages are a `hungarian.js` assign with each lane repeated once per head. The remainder lanes get an
      extra copy with a 1e6 cost, so exactly `rem` of them are used, and those go to the nearest heads.
    - Hysteresis: a head that already follows a lane costs `STAY_M` (0.5 m) less to keep it. Only the `prev`
      argument triggers it, so a fresh split is purely nearest.
  - `homePoints`, `homeAssign` and `normalizeGrid` belong to WO-709.
- **`src/tracking/auto-store.js` (new): persistence.**
  - Slot heads / ptz and `home.after_s` go to `~/.highascg/tracking-auto.json` (written atomically, tmp + rename).
  - `HIGHASCG_TRACKING_AUTO_FILE` overrides the path. Under `node --test` (NODE_TEST_CONTEXT) the default is a
    private mkdtemp dir, using `projects-root.js` `underTestRunner`.
  - Pins stay in memory only.
- **`src/tracking/auto-routes.js` (new): HTTP and WS.**
  - `handleAuto` serves GET `/api/tracking/auto` and POST `…/pin`, `…/slot`, `…/home`. Every POST answers with the
    new snapshot. The path literals are written so `tools/dev/gen-api-contract.js` lists them.
  - `createAutoBroadcast` sends WS `tracking:auto`: the snapshot is looked at ≤ 5 Hz and sent only when it changed.
    Positions are rounded to cm and `idle_s` to whole seconds, so an idle stage sends nothing.
  - `followProject` keeps the director's grid on the active project (`loadFullProject` + `onProjectChanged`).
- **`src/tracking/auto-follow.js`:** `createAutoFollow({ id, name })`. The defaults are WO-707's marker 64999, so its
  smoke is unchanged.
- **`src/fixtures/follow-engine.js`: the hook, as in the contract.**
  - `this.resolveAuto = null` in the constructor.
  - In `tick()`: `const auto = fx.follow === AUTO_MARKER_ID && this.resolveAuto` and
    `const m = auto ? this.resolveAuto(fx, marks) : fx.follow ? marks.get(fx.follow) : null`.
  - A target with `home: true` gives the state `'home'`, and it counts as tracking for the WO-632 read-through
    weight.
  - With the hook unset, the expression is the old one. The file was already not prettier-clean at HEAD (a 94-line
    reformat), so only the new lines were kept prettier-neutral. A whole-file reformat would move the line that
    smoke-wo698 pins.
- **`src/tracking/register.js` (497 → 482 lines):**
  - The director replaces `autoFollow`: `auto.step({ …, fixtures })` in pinTick and `auto.attached()` in withPins.
  - `handleAuto` is chained after `handlePresenters`, and `autoWs.tick` runs in the 33 ms loop.
  - In onBoot: `_follow.engine.resolveAuto = auto.resolveAuto` and `followProject(auto, ctx)`; onShutdown
    unsubscribes.
  - `reply` now comes from auto-routes.js.
  - To make room, the `/api/tracking/verify` handler moved verbatim into `VerifyWalk.handle()`
    (`src/tracking/verify-walk.js`). The same replies are re-tested through the module in smoke-wo708.
- **`tools/smoke/smoke-wo707-follow-auto.test.js`.** Only the register.js wiring assertion changed: the two lines it
  pinned (`const wanted = …`, `autoFollow.step(…)`) no longer exist, because the director works out the pool itself.
  It now pins `const fixtures = …`, the `auto.step({ … fixtures })` call, and the pool filter
  `f.follow === AUTO_MARKER_ID` in auto-director.js. The other 5 tests are untouched and still exercise
  `createAutoFollow` with the defaults.
- **`docs/wiki/api/contract/{http,ws}.md`** are regenerated by `node tools/dev/gen-api-contract.js` (smoke-wo598
  requires it). They also pick up WO-712's `/api/server/duties` + `server:duties`, which another agent added in
  parallel.

### API as implemented

```
GET /api/tracking/auto → { pool: [fixture ids], primary: 64999,
  persons: [{ key, marker, slot, x, y, name?, heads: [fixture ids], ptz: [cam ids], lost }],
  slots: [{ slot, key, heads, ptz }] ×9, home: { active, after_s, idle_s, forced },
  ptz: [{ id, name, enabled, state }] }
```

- **The fields:**
  - `x, y` are metres to cm. For a followed person they come from the lane marker (smoothed); for an unfollowed
    person, from the raw floor point. They are null for a camera person on an unsolved camera.
  - `heads` is [] while home is active.
  - A lost lane is listed with `lost: true`.
- **POST pin `{ key, slot }`:**
  - slot must be an integer 0…9 (400); key must be `camera:tid` / `w:<id>` (400); the key must be a current person
    or a held lane (404).
  - Pinning moves the key out of any other slot, and replaces the slot's previous key.
  - slot 0 unpins, and is idempotent.
- **POST slot `{ slot, heads?, ptz? }`:**
  - slot must be 1…9; heads an integer 0…the current pool size.
  - ptz must be an array of `[A-Za-z0-9_.:-]{1,64}` ids. With a PTZ service set, unknown ids give 400.
  - A camera moves out of any other slot.
- **POST home `{ after_s?, now? }`:** after_s must be a number 3…600; now must be a boolean.
- **Errors:** a body that is not JSON, or not an object, gives 400. A null director gives 503.

### Deviations from the contract

- **Re-acquire inheritance:** a lost lane, and its pin, passes to a new key near where it was lost (see above). The
  contract's signature is "the followed person keys"; here it is the lane ids, which are identical except for that
  inheritance.
- **Join delay:** `JOIN_S` 0.4 s for a second or later person (not in the contract). The first person is followed at
  once.
- **Split hysteresis:** `STAY_M` 0.5 m. A fresh split is still pure nearest.
- **Grid keys:** the real keys are `x_offset` / `y_offset` (the Godot twin), not `x` / `y`.
- **POST home `{ now: true }`** ends on someone who was not in view when it was pressed, so it also works with
  people on stage. `{ now: false }` cancels it.
- **Timed home only while detection is enabled.** With detection off, heads on Auto hold as in WO-707. A forced home
  still works.
- **The PTZ list in GET** takes `state` from `ptz.status()`, which may be an array or `{ cameras: [...] }`.
- **A camera in a slot** whose person is absent does not fall back to A1. It gets 'home' or null, as the contract's
  "else" reads.

## Verified

- **`tools/smoke/smoke-wo708-auto-split.test.js`: 18/18.**
  - One person: all heads on A1 (WO-707).
  - Two persons: half / half by nearest. The same split for camera persons (the DetectPin floor-cast, one camera).
  - An odd pool: the remainder goes to the nearer person.
  - The join delay; no phantom A2 on a flicker.
  - A pin with an explicit count takes its nearest head. Pin marker 64981 "Pin 1", A1 compacted.
  - Share + explicit mix, and the slot-order caps; leftover heads stay unassigned with no share person.
  - Sticky when the persons swap sides.
  - lost_s: a hold with status 0, then the re-split and A2 removed.
  - Re-acquire inherits the lane and the pin.
  - A pin frees its key after lost_s and keeps its settings.
  - PTZ: slot / auto / 'home' / null, the one-slot-per-camera rule, the `ptz` block in GET.
  - API shape + validation.
  - WS: one send while idle, a send on change.
  - Persistence: a temp file under the test runner, the env override, a reload by a new director, pins not
    persisted, a broken file falls back to defaults.
  - The engine hook: unset = the plain 64999 lookup; the same marker through the hook gives an identical status; no
    target → 'no marker'; non-Auto heads never call the hook.
  - Through the real tracking module (module-registry boot): GET auto, POST slot 400, and verify GET / POST still
    answering.
  - The register.js / follow-engine.js wiring pins.
- **WO-707: `smoke-wo707-follow-auto` 6/6.**
- **The register.js / follow-engine smokes: 160/160** (wo616 follow-artnet / tracking-pin / marker-hub /
  verify-walk / beam-spot, wo624 pick + calibrate, wo667, wo675 presenters + bodies, wo698, wo700, wo615 ×4, wo630,
  wo631, wo632, wo695, wo598 api-contract).
- **`npm run -s test:ci`:** 2925 tests, 2922 pass, 1 fail. The failure is the known WO-308 pointer-confine test. The
  new smokes are not registered yet; the lead adds them to `tools/ci/run-offline-tests.js`.
- **Gates:**
  - max-file-lines: 0 over.
  - eslint on src/tracking, src/fixtures and the smokes: clean.
  - prettier --check: clean on every new / touched file except follow-engine.js, which was already dirty at HEAD.
  - unwired-exports: no new orphans of mine. The only two flagged are WO-712's in-progress `server-duties.js`.
- **`~/.highascg/tracking-auto.json` was not created by any test run** (checked after the suite).
- **Not verified (lead / owner):**
  - On the live box: GET /api/tracking/auto after a server restart.
  - Two people in front of cam_1 / cam_2, split half / half.
  - A pin plus a head count from the WO-710 overlay.
  - The PSN / Art-Net output carrying the extra markers.
  - The PTZ service wiring (`auto.setPtz(svc)`, `svc.step(now, auto.ptzTargetOf)`), which the lead wires.
- **Owner QA:**
  1. Put the fronts on Follow → **Auto**, and two people on stage: each gets half of the fronts, the nearest ones.
  2. Pin one of them as 1 with 1 head: they keep exactly one head, and the other person gets the rest.
  3. One person walks off: their heads hold for 3 s, then go to the person who is left.

### Live box (23.10.26, lead, server pid 1367233)
- `GET /api/tracking/auto` → `pool` = both Focus Profiles (the owner set both to Auto), 9 slots, `ptz: []`, nobody in
  view.
- Two people splitting the fronts was not tried (nobody on stage) → owner QA.
- GUI relaunched: the overlay shows top-right in Previs → 3D ("Track 0 · no one detected · home · Home now · after −
  10s +"). Screenshot: scratchpad `gui-712.png`.
