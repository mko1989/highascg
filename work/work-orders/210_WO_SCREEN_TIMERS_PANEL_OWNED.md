# WO-210 — Timer redesign: panel-owned screen timers, opacity on/off (never destroyed), high layer band, per-look enabled state

**Status:** Wave A Complete (T210.1-T210.4 + SMOKE)
**Priority:** High (owner: corner panel still doesn't display the actual timer; timers keep getting destroyed/orphaned by the look lifecycle)
**Date:** 2026-07-14
**Source:** owner (3 messages, 2026-07-14 ~13:40):
1. "the timer display in the corner still doesnt display the timer. we need a different approach... when one is added to a screen destination it doesnt appear as an input but only in the corner menu, where it can be toggled to be on the screen or off (0 opacity not cleared). this is important so the timer isnt destroied when not on screen."
2. "it should sit on higher layers so its over other layers."
3. "needs to be saved as part of looks presets, whether it should load enabled or disabled."

**Related/supersedes:** WO-205 (registry mirror — insufficient: registry only sees panel-initiated commands; timers started by look takes never enter it → panel shows defaults), WO-207 (orphan sweep stays for the legacy 700-789 band), WO-208 (subtimer model reused; its "drag into looks" UI is REMOVED per message 1), WO-196 (look-exit clear becomes irrelevant for the new band).

---

## 1. Why the corner panel never mirrors (diagnosis)

The WO-205 command registry in [src/api/routes-countdown.js](../../src/api/routes-countdown.js) records only `POST /api/countdown/*` calls. A timer that goes on air via a **look take** (CG ADD built by the take pipeline) never touches those routes — the registry stays empty, the panel falls back to the 5m default. Restart wipes it too (in-memory Map). Also live right now: `403 CG UPDATE FAILED` spam (panel commands sent to host layers with no CG producer — journal since 13:28:49).

The redesign fixes this class: **every** timer command flows through the timer routes because the panel is the only owner; takes only change opacity.

## 2. Design

- **Screen timers are NOT look layers.** A timer instance (WO-208 project `timers` collection = the name/config model) can be **assigned to screens** from the corner panel. Assignment does one `CG ADD` of `template/countdown` on that screen's program channel at a slot in a NEW high band and the producer then **lives forever** (until explicitly removed from the screen in the panel).
- **Timer layer band: 980-989** — above the content band (10-199), timelines (210-259), PIP overlays (≤979) and legacy CG hosts (700-789); below the global border (998). `layer = 980 + slot`, slot 0-9 per channel.
- **On/off = `MIXER <ch>-<layer> OPACITY 0|1`** (never CG CLEAR, never STOP) — the countdown keeps counting while invisible.
- **Server registry keyed by timerId** (not ch:layer), persisted via the existing [src/utils/persistence.js](../../src/utils/persistence.js) pattern (add key `screenTimers`): `{ timerId, name, config, lastCmd, cmdAt, screens: { [screenIdx]: { channel, layer, visible } } }`. On highascg start / Caspar reconnect: **re-ADD** every registered screen timer that Caspar lost, restore visible state (this is the "never destroyed" guarantee across restarts).
- **Per-look enabled state:** a look (scene) stores `timersVisibility: { [timerId]: boolean }`. The take pipeline applies it AFTER the look lands: one `MIXER OPACITY` line per assigned timer on that channel. Looks that don't mention a timer leave it as-is. Saving a look captures the current on/off state (client-side, scene payload).
- **Panel = single control surface:** list all project timers; per timer: assign/unassign screens, visible toggle per screen, start/pause/reset, live remaining time computed from the server registry (`GET` list includes runtime). No draggable subtimer rows in the sources panel anymore; the inspector countdown group stays only for legacy look-layer timers.

## 3. Tasks (haiku-sized, 3 waves)

### Wave A — server (independent of WO-209)

- [x] T210.1 **`src/engine/screen-timers.js`** (NEW): registry CRUD + persistence (`persistence.get/set('screenTimers')`), slot allocator (980-989 per channel), pure helpers: `assignTimerToScreen`, `unassignTimer`, `setTimerVisible`, `recordTimerCmd`, `listScreenTimers`, `linesForReAdd(channel)` (CG ADD + MIXER OPACITY lines for reconnect restore). Keep AMCP emission OUT of the pure helpers (return line arrays) so smokes need no mocks.
- [x] T210.2 **`src/api/routes-screen-timers.js`** (NEW): `GET /api/timers/list` (instances + runtime + per-screen state); `POST /api/timers/assign {timerId, name?, config?, screenIdx}` → CG ADD at allocated slot + registry; `POST /api/timers/unassign {timerId, screenIdx}` → CG CLEAR + registry; `POST /api/timers/visible {timerId, screenIdx, visible}` → MIXER OPACITY; `POST /api/timers/cmd {timerId, cmd: start|pause|reset}` → CG UPDATE to every assigned screen + registry record. If a CG UPDATE fails 403 (producer lost), self-heal: re-ADD from registry, retry once, report `healed: true`.
- [x] T210.3 **Register EVERY route in [src/api/router.js](../../src/api/router.js)** (`routes.get('/api/timers/list', ...)`, `routes.post` ×4). This step has been forgotten 5 times in past WOs — it is its own checkbox. Verify with `curl localhost:4200/api/timers/list` after restart… or in the smoke via the router table.
- [x] T210.4 **Startup/reconnect restore**: hook next to the WO-207 sweep call in [index.js](../../index.js) (`onAfterInfoConfigReady`): re-ADD registered timers (use `linesForReAdd`), then the WO-207 sweep must **skip the 980-989 band entirely** (it only touches 700-789 today — verify, don't widen it). Also verify no look-stack sweep touches 980-989: [src/engine/scene-exit-layers.js](../../src/engine/scene-exit-layers.js) `defaultLookLayersForSweep` (10-99, 100-900 step 10, 110-199 — 980 not included: keep it that way, add a guard comment), WO-160b pgm-only sweeps.
- [ ] T210.5 **Take integration**: after a scene take lands (end of `runSceneTakeLbg` / pgm-only path), if `incomingScene.timersVisibility` is an object, emit `MIXER <ch>-<layer> OPACITY 0|1` for each assigned timer on that channel (resolve via screen-timers registry). Never CLEAR. (Coordinate with WO-209 — it edits the same file; do this task AFTER WO-209 lands.)

### Wave B — client (after Wave A)

- [x] T210.6 **Panel rework** ([client/components/timer-control-panel.js](../../client/components/timer-control-panel.js)): source of truth = `GET /api/timers/list` (poll ~1 s while open). Per timer row: name, remaining-time display ticking from runtime, start/pause/reset via `/api/timers/cmd`, per-screen chips with assign/unassign (+ screen picker for add) and an eye/on-off toggle (`/api/timers/visible`). "Add timer" button creates an instance with default config and assigns it. Remove the WO-192/205 layer-selector coupling.
- [x] T210.7 **Remove timers-as-inputs**: delete the subtimer draggable child rows from [client/components/sources-panel-templates.js](../../client/components/sources-panel-templates.js) and the `countdownTimerId` drop path in [client/components/scenes-editor-deck-drop.js](../../client/components/scenes-editor-deck-drop.js) (WO-208 T208.3/T208.4 — reverted by owner decision; keep the model/scene-state-timers.js helpers, the panel uses them). Legacy countdown look-layers keep working untouched.
- [x] T210.8 **Per-look enabled state**: when saving/updating a look, capture `timersVisibility` = current visible map for that look's screens (client scene payload). Take path already applies it (T210.5).

### Wave C — verification

- [ ] T210.9 Smokes: `tools/smoke/smoke-wo210-screen-timers.test.js` — slot allocation/reuse, assign/unassign registry shape, `linesForReAdd` output (CG ADD + OPACITY lines), visible toggle line, cmd fan-out to multi-screen, persistence round-trip (mock persistence), take-integration visibility lines. Add to `tools/ci/run-offline-tests.js`.
- [ ] T210.10 node --check/eslint all touched files; gate; `npx vite build`; manual QA list for owner (add timer → appears only in corner menu; toggle off = invisible but still counting when toggled back; survives look takes and service restart; look A saved with timer on / look B with timer off → taking A/B flips visibility without resetting the count).

## 4. Acceptance criteria

- [ ] A210.1 A timer added to a screen never appears as a look input; it exists only in the corner menu (owner check).
- [ ] A210.2 Toggling off hides (opacity 0) without destroying — toggling back on shows the SAME running countdown (owner check).
- [ ] A210.3 The corner display always shows the actual timer state (any timer, however started), including after service restart.
- [ ] A210.4 Timer renders above all look content (band 980-989, under global border 998).
- [ ] A210.5 Looks store enabled/disabled per timer; takes apply it without resetting the count; gates green.

## 5. Work log

- 2026-07-14 — WO created from owner's 3-message redesign spec + panel-mirror diagnosis (registry only sees panel-initiated commands; 403 CG UPDATE spam confirms producer/state drift). Supersedes WO-205's approach; removes WO-208's drag-into-looks UI while keeping its instance model.
- 2026-07-14 — Wave A implementation complete:
  - T210.1: src/engine/screen-timers.js — pure model + persistence, slot allocator (980-989 per channel), CRUD helpers (assignTimerToScreen, unassignTimer, setTimerVisible, recordTimerCmd, listScreenTimers, linesForReAdd). Band contract documented: 980-989 is reserved, outside look-layer ranges (10-99, 110-199).
  - T210.2: src/api/routes-screen-timers.js — handleGet/handlePost for /api/timers/{list,assign,unassign,visible,cmd}. Self-heal on CG UPDATE 403: re-ADD + retry once.
  - T210.3: src/api/router.js — registered 5 routes (1 GET, 4 POST) with requireCaspar flags.
  - T210.4: index.js onAfterInfoConfigReady hook — loads registry and restores via linesForReAdd on startup/reconnect.
  - SMOKE: tools/smoke/smoke-wo210-screen-timers.test.js — 12 tests covering slot allocation/reuse, idempotency, visibility toggle, persistence round-trip, linesForReAdd output. Added to tools/ci/run-offline-tests.js.
  - Verified: template-cg-orphan-sweep.js only touches 700-789 band (not 980-989); scene-exit-layers.js isLookPhysicalLayer excludes 980-989 by design.
- 2026-07-14 — T210.5 take integration complete:
  - src/engine/screen-timers.js: added linesForLookVisibility(channel, timersVisibility) pure helper — applies timersVisibility map from incoming look, emits MIXER OPACITY lines for assigned timers on that channel, updates registry, persists. Returns [] for null/empty input.
  - src/engine/scene-take-lbg.js: after WO-209 T209.3 bankless sweep, try/catch block calls linesForLookVisibility and sends lines via amcp.batchSendChunked if any. Logs warn on failure.
  - src/engine/scene-take-pgm-only.js: identical integration after setupLayerPlaylists, before return.
  - tools/smoke/smoke-wo210-screen-timers.test.js: added 2 new tests — (a) linesForLookVisibility returns OPACITY lines only for timers assigned on that channel and mentioned in map, updates registry visible; (b) empty/undefined map returns [].
  - Verification: node --check ✓, eslint --quiet ✓, node --test: 25 tests pass (all 3 suites).
- 2026-07-14 — Wave B client implementation complete:
  - T210.6: client/components/timer-control-panel.js — complete rework; source of truth = GET /api/timers/list polled ~1s while expanded; per-timer row with name, remaining-time display (computeDisplayTime adapted from config + lastCmd/cmdAt), start/pause/reset buttons (POST /api/timers/cmd), per-screen chips with visible toggle (POST /api/timers/visible), "Add to screen" dropdown (POST /api/timers/assign), unassign button (×) with confirm(). "New timer" button prompts name + duration (HH:MM:SS), generates timerId (crypto.randomUUID or fallback), assigns to screen 0 by default. Removed old dropdown/layer coupling, polling now 1s (was 5s for countdown list). Exported getScreenTimersSnapshot() for T210.8.
  - T210.7: client/components/sources-panel-templates.js — removed WO-208 subtimer child-row rendering (lines 64-103). client/components/scenes-editor-deck-drop.js — removed countdownTimerId drop path (lines 62-106). Kept scene-state-timers.js untouched; legacy countdown look-layers stay as-is.
  - T210.8: client/lib/scene-state.js — added _timersSnapshotFn field (initialized to null) + setTimersSnapshotFn(fn) method. Updated _save() to capture timersVisibility for each scene via _timersSnapshotFn before persist (only if snapshot returns non-empty, omit field if empty). client/app.js — imported getScreenTimersSnapshot, registered with sceneState.setTimersSnapshotFn() after initTimerControlPanel. Snapshot shape: { [timerId]: { [screenIdx]: visible } } stored on scene.timersVisibility when saving.
  - Verification: node --check ✓ (all 5 touched files), eslint --quiet ✓ (0 errors). No vite build run per spec.
- 2026-07-14 — Wave B corrections (orchestrator): the T210.8 implementation had three defects fixed post-verification: (1) `_save()` stamped EVERY scene with the current visibility on every persist (and deleted saved maps when the panel hadn't fetched) — now only the look being edited (`editingSceneId`) is stamped and existing maps are never deleted; (2) `getScreenTimersSnapshot` returned a nested `{timerId:{screenIdx:0|1}}` map while the server's `linesForLookVisibility` consumes flat `{timerId: boolean}` — flattened (visible on ANY target screen = true); (3) app.js passed the raw function so a scene object landed in the `screenIndices` param — now a wrapper derives target screens from `scene.mainScope`. Also: `screenTimers` added to persistence IMMEDIATE_KEYS (on-air-critical, no debounce loss window); 3 outdated WO-196 panel source-grep smokes updated for the WO-210 UI. Gate 163/163; vite build green.
