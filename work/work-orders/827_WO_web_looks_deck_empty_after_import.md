# WO-827 — Web client: Looks deck says "No looks" after a server import (+ six ReferenceErrors)

**Status: DONE (29.10.2026, fresh-profile firefox-esr against the box: deck shows the looks; 0 compose errors; offline 3641/0; CI lint 0 errors)**

Found while checking the WO-818 note ("web Scenes/Looks tab showed 'No looks for Dioda/Proj' … may be a stale dist-web").
It was not stale: a real bug.

## Investigation

- Reproduced on firefox-esr with a fresh profile (empty localStorage) against http://127.0.0.1:4200: both columns
  read "No looks for Dioda." / "No looks for Proj." while Godot showed 13 + 9 looks from the same server.
- Server side fine: `GET /api/project` → `scenes.scenes` has 22 looks, `mainScope` 0 ×13 and 1 ×9.
- Temporary `console.log`s in the bootstrap path showed the import **succeeds**:
  `project 2 22` → `report server-bootstrap none true []` (hardware matches, no modal) → `imported 22`.
  So `sceneState.scenes` held all 22 looks while the deck still showed none.
- Cause: `sceneState.loadFromData` emits `'imported'` (`client/lib/scene-state.js:483`, and the deck-ingest path
  at :221). The only listener is `client/app.js:265` (deck sync/autosave for local imports). The scenes editor,
  which draws the deck, re-renders on `change`, `softChange`, `previewScene`, `editingChange` and `screenChange`
  (`client/components/scenes-editor.js:343-390`), **not on `imported`**. The first paint happens before the
  async import lands, and nothing repaints afterwards.
  - Browsers with a localStorage copy (`_load`) painted that cached deck instead. That is a stale deck, not an
    empty one: another client's `project_sync` was invisible until some unrelated change re-rendered.
- The same console showed `[preview] compose cell draw failed: layer is not defined` 14× while a timeline played
  on PGM. `client/components/preview-canvas-draw-stacks.js` timeline stack: the WO-326B contentZoom block was
  copied from the look stack (`:106`) into the timeline loop. There it read undefined `layer`, `px`, `py`, `pw`
  and `ph`, threw on every frame, and so the compose preview never drew timeline clips.
  - contentZoom is a look-layer feature. Only `src/engine/scene-take-lbg-jobs.js` applies it on air; timeline
    playback never does.
- Why lint never caught it: `eslint.config.js` had `'no-undef': 'off'` for `client/**`. A no-undef sweep over
  the client found four more latent ReferenceErrors:
  - `device-view-bands-render.js:425`: bare `lastPayload`, where the closure only has `ctx.lastPayload`.
    Removing the virtual-camera output threw before the device-graph edges were pruned.
  - `inspector-countdown.js:236,237,309,310`: `readNum` was never defined in this module. It exists only
    inside `inspector-countdown-controller.js`'s closure. Every keystroke in the amber/red threshold and
    timer/aux font-size fields threw, so those fields never saved.
  - `sources-panel-helpers.js:193-195`: `timelineState` was not imported. Right-click → Rename timeline threw.
  - `app-ws-handlers.js:146`: `refreshSceneLiveFromServer` was not imported (it lives in `scene-live-sync.js`).
    A `scene.live` seq gap threw instead of re-pulling state.

## What was done

- `client/components/scenes-editor.js`: `sceneState.on('imported', …)` → `previewPanel.scheduleDraw()` and
  `scheduleRender()`. Render only, no writes, so the WO-341 echo rules are untouched.
- `preview-canvas-draw-stacks.js`: dropped the copied contentZoom block from the timeline stack. Copying it
  correctly was the alternative, but it would have made the preview differ from air.
- `device-view-bands-render.js`: now reads `ctx.lastPayload`.
- `inspector-countdown.js`: added a module-level `readNum`, the same as the controller's.
- `sources-panel-helpers.js`: imports `timelineState`.
- `app-ws-handlers.js`: imports `refreshSceneLiveFromServer`.
- `eslint.config.js`: client `no-undef` is now `'error'`. The three Node-side scripts under `client/tools`
  (operator-desktop, to-server patches) get node globals.
- `tools/smoke/smoke-wo827-web-deck-import-repaint.test.js` (curated list) pins the listener, the absence of
  the timeline contentZoom copy, and the lint rule.

## Verified

- firefox-esr, fresh profile, Xvfb, after `npm run build:client`:
  - before: both columns said "No looks" (web0.png / web2.png);
  - after: Dioda shows Loop1, Loop czysty …; Proj shows the KV LOOP looks, with the PGM ring on the live look;
  - 0 `compose cell draw failed` lines in the console (14 before).
- Clean worktree of HEAD plus these changes: `npm run lint` gives 0 errors and 216 warnings (cap 216);
  `format:check` is clean.
- Offline suite: 3643 tests, 3641 pass, 0 fail, 2 skipped. The new smoke has 3/3.
- Not exercised by hand: the countdown, timeline-rename, vcam-remove and seq-gap paths. Those fixes are
  import/definition-only, and lint now proves each identifier resolves.
