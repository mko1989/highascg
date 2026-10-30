# WO-840 — Timer visibility lives in look presets (per screen), not in looks

**Area:** engine, godot-client
**Status: DONE (30.10, offline-verified: new smoke + Godot test; owner QA on the box pending: save a preset with a timer hidden, recall, watch the timer)**
**Source:** WO-806 G3; owner 30.10: *"timers should be saved in looks presets as they are per screen not per look."*
RULES.md "Timers" rule 1.
**Related:** WO-806 (G3), WO-210 (T210.8: the web look save stores `timersVisibility`), `src/engine/screen-timers.js`,
`src/api/routes-scene-look-preset.js`.

## 1. Investigation (start)

The web client stores `timersVisibility` on each look save, and taking that look shows or hides those timers. Godot
never ported it. The owner's rule: timers are per screen, so their visibility belongs to the look preset.

### Findings (verified in the code, 30.10)

- Save side (web): `SceneState._save()` stamped `scene.timersVisibility` on the look being edited via
  `_timersSnapshotFn(scene)` (client/lib/scene-state.js, registered in client/app.js from `scene.mainScope`;
  `getScreenTimersSnapshot` in client/components/timer-control-panel.js folded "visible on ANY target screen" into one
  flat map). That is a per-look, screen-merged value, which is exactly what the owner rule rules out.
- Take side: `finalizeTakeBankState` (src/engine/scene-take-lbg-bank-finalize.js) read
  `incoming?.timersVisibility || incomingSceneOpt?.timersVisibility` and sent `linesForLookVisibility(channel, map)`
  (src/engine/screen-timers.js) — filtered by channel, band-guarded, updates the registry. The finalize hook already
  runs once per program take on the screen's own channel, so it is the right place for a per-screen map.
- Preset shape: `scenes.lookPresets[].items[] = { mainIdx, sceneId, sourceKind }` (+ `empty: true` for an empty
  destination, WO-781). The deck sync / autosave pass preset items through verbatim (src/state/live-deck-state.js,
  src/engine/project-scenes*.js), so a new item field needs no server whitelist change. Two places DO whitelist item
  fields: the web `importLookPresetsFromServer` (client/lib/scene-state-look-logic.js) and the server `recallItems`.
- Recall paths: the web client does NOT call POST /api/scene/look-preset/recall — `runLookRecall`
  (client/components/scenes-editor-logic.js) fans out `takeSceneToProgram.batch` -> one POST /api/scene/take per screen
  (client/components/scenes-editor-support.js). Godot and Companion-style callers use the server recall, which calls
  `handleTakeLook` -> `handleSceneTake` -> `runSceneTakeLbg` -> `finalizeTakeBankState`. Both paths end in
  `handleSceneTake`, so one new body field (`timersVisibility`) threads both.
- Godot never had a timer snapshot: the timers list (`/api/timers/list`) is only polled while the Timers dock is open,
  so the preset page cannot rely on a cache.
- Timer records: `screens["<screenIdx>"] = { channel, layer, visible, opacity }`; a timer can sit on several screens
  with different `visible` flags — a per-item map must read `screens[mainIdx].visible`, not "any screen".
- No existing smoke pinned `timersVisibility` on looks (rg tools/smoke test: only the `linesForLookVisibility` unit
  tests in smoke-wo210-screen-timers-persistence-and-guards, which stay valid: the function is unchanged).

## 2. What was done

Design: the map `{ [timerId]: boolean }` is stored per preset item (`items[i].timersVisibility`), for the timers
assigned to that item's screen. Recall sends it with that screen's program take; the finalize hook applies it on the
take's channel. Items without a map (older presets, screens without timers, empty destinations) leave timers alone.
A plain look take applies nothing; legacy `timersVisibility` on looks stays in the data, is never read, never written.

Server
- `src/engine/timer-visibility-map.js` (new): `sanitizeVisibilityMap` — only boolean values survive (deck JSON /
  request bodies are untrusted). New file because screen-timers.js is at 499 lines.
- `src/engine/scene-take-lbg-bank-finalize.js`: the look-level read is gone; it applies `c.timersVisibility`
  (the preset item's map) through `linesForLookVisibility`.
- `src/engine/scene-take-lbg.js`: passes `opts.timersVisibility` to finalize (was `incomingSceneOpt`).
- `src/api/routes-scene-take.js`: `b.timersVisibility` is sanitised and added to the two PROGRAM `runSceneTakeLbg`
  calls (PGM/PRV-exchange take and the direct program take). Preview staging calls do not get it.
- `src/api/routes-scene-take-look.js`: forwards `timersVisibility` into the take body for `target: 'program'` only.
- `src/api/routes-scene-look-preset.js`: `recallItems` keeps each item's sanitised map; recall passes it to that
  screen's take (PGM recall only; PRV recall leaves timers alone); it is not echoed in the response.
- `src/engine/screen-timers.js`: doc comment only (function unchanged).

Web
- `client/lib/scene-state.js`: `_save()` no longer stamps `scene.timersVisibility`; the snapshot hook is now
  `(mainIdx) => map`.
- `client/components/timer-control-panel.js`: `getScreenTimersSnapshot(screenIdx)` returns ONE screen's flags (was the
  any-screen fold over the look's screens). `client/app.js`: registration simplified to match.
- `client/lib/scene-state-preset-actions.js`: save and overwrite stamp each item (with a look) with its screen's map.
- `client/lib/scene-state-look-logic.js`: server import of presets keeps the item map.
- `client/components/scenes-editor-logic.js` + `scenes-editor-support.js`: the recall carries the item map into that
  screen's POST /api/scene/take (batch and single-item paths).

Godot
- `look_preset_model.gd`: `with_timers(items, timers)` (pure) stamps items; `make_preset` / `overwrite` already deep-copy items.
- `look_preset_page.gd`: `capture()` applies it from `_timers`, re-read from `/api/timers/list` (`refresh_timers()`)
  right before a save or overwrite. Recall needs no client change (server recall reads the synced preset).

Why not alternatives: a separate `/api/timers/apply` call after the take would not ride the take (flicker, two writers);
applying inside the existing finalize hook keeps the one per-screen code path and its band guard.

## 3. Verified

- `node --test tools/smoke/smoke-wo840-preset-timer-visibility.test.js`: 11/11 (new, mocked, no live state):
  recall items keep only boolean entries and no map for plain items; PGM recall gives each screen its own map, PRV
  none; take-look forwards the map for program only and ignores a legacy look-level field; `finalizeTakeBankState`
  with a preset map emits `MIXER <ch>-<layer> OPACITY` on the right channel only for named timers (channel 3 vs 1), a
  plain take (also with a legacy look `timersVisibility`) emits nothing; web save/overwrite stamp per-screen maps
  (empty/timer-less screens none); server import keeps the map; source pins for the two program take call sites and the
  removed look stamp.
- Related existing suites: 85 files (every smoke/test that references scene-take-lbg, routes-scene-take, scene-state*,
  scenes-editor-*, timer-control-panel, client/app.js, screen-timers) -> 627 tests, 0 failures.
- Godot: `~/.local/opt/godot/godot --headless --path godot/client --script res://tests/run_tests.gd` -> 23221 passed,
  0 failed, including new `tests/test_look_preset_timers.gd` (verified it can fail by flipping an expectation).
- eslint on the changed JS: 0 errors (one pre-existing unused-var warning in timer-control-panel.js);
  `check-max-file-lines.js`: 0 files over 500.
- NOT done: no live probe (contract forbids restarts/API writes); web needs `npm run build:client` + reload to take
  effect; Godot loads from the tree on relaunch. Owner QA: save a preset with a timer hidden, show it, recall.
