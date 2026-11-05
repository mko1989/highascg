# WO-955 — A look layer's trim edit reloads PRV straight away

**Area:** engine
**Status: DONE (05.11.26 — smoke 3 tests + the 26 existing preview-push / nudge tests green; on the second dev box a trim Out edit alone reloaded PRV: 3 black frames per wrap before, 0 after; PGM untouched) — owner QA**

Owner 05.11 (after [WO-954](./954_WO_trim_black_tail_of_looping_clip_on_air.md)): *"Make a trim edit reload PRV straight
away, so step 3 isn't needed. yes to this."* (step 3 = click the look's card to stage it on PRV again). The "apply trim to
PGM now" idea was declined.

## 1. Investigation

- WO-954 measured the problem. After Trim → Out = 3.94 s on a look layer (the look staged on PRV ch 3), PRV still showed
  the 3 black frames at every wrap. The server journal for that edit has only
  `MIXER 3-10 FILL / ANCHOR / ROTATION / OPACITY` + `MIXER 3 COMMIT` (12:20:31): no reload carrying the new `LENGTH`.
  One click on the look card (a preview take) did reload it, and the next 9 s of PRV had 0 black frames.
- The path:
  - every look-editor edit goes through `preview_pusher.gd` → `POST /api/scene/preview-push`;
  - `src/api/routes-scene-preview-push.js` `decidePreviewPush` chooses a MIXER nudge when the web rule
    `isGeometryOnlyPreview` (`client/lib/scenes-preview-snapshot.js`) calls the change geometry-only;
  - that rule's content key (`previewContentCompareKey`: value, loop, straightAlpha, contentFit, audioRoute, volume,
    muted, pipOverlays, browserAsCg) has **no trim**, so a trim edit counts as "geometry only" and only MIXER is sent.
- The staged PRV scene keeps the layer trim: `scene-take-payload.js:98-99` copies `trimInMs` / `trimOutMs` when set,
  and `registerStagedScene` stores that payload. So the server can compare the staged trim with the edited one.
- A preview take (`take-look`, target preview, forceCut) sends `LOADBG … SEEK … LENGTH` from the layer trim
  (`scene-take-lbg-jobs.js:247-260`, WO-813). That reload is what PRV needs.

## 2. What was done

- `src/api/routes-scene-preview-push.js`:
  - `decidePreviewPush` now compares each sourced layer's `trimInMs` / `trimOutMs` (`trimKey`: layer number, in, out;
    absent = null) between the staged PRV scene and the edited look. Any difference → `take` (a preview take with
    forceCut, which reloads the clip with SEEK / LENGTH).
  - Every other edit is decided as before; geometry stays a MIXER nudge.
- Why on the server and not in the web's shared rule (`client/lib/scenes-preview-snapshot.js`): that rule is also the
  web client's own in-browser decision. The server check fixes every client that pushes through
  `/api/scene/preview-push` (the Godot editor) without changing the web's behaviour.
- Two other options were not taken:
  - a client-side "force take" flag: it would need every trim widget (fields, Trim in / out buttons, ↺ reset) to set
    it;
  - a `CALL LENGTH` on PRV: untested on this Caspar fork, and the owner declined the PGM variant of it.
- `tools/smoke/smoke-wo955-trim-restages-prv.test.js` (curated): trim out set / moved / cleared and trim in set →
  take; the same trim with a geometry change → nudge (absent = null); the handler sends the preview take
  `{ target: 'preview', forceCut: true }`.

## 3. Verified

- Smokes: WO-955 + WO-598 preview-push + WO-601 PIP / effects nudge = 29/29. eslint clean, `check-unwired-exports` (no
  new orphans), `check-max-file-lines` OK.
- On the second dev box (deployed, server restarted), with the WO-954 test clip (200 frames at 50 fps, the last 3
  black) looping in a look staged on PRV ch 3:
  - Before: PRV probe 9 s, 3 black frames at each of 2 wraps.
  - Layer → Trim → Out 3.94 s typed, **no card click**: the journal shows `[scene-take] preview-only path prv=3` and
    `PLAY 3-10`, and nothing on ch 2. The next 9 s of PRV had **0 black frames**, with wraps every 3.94 s
    (255 → 0 directly).
  - An opacity edit afterwards was still a MIXER nudge (`MIXER 3-10 … OPACITY 0.8`, no preview take).
- Cleanup: the probe was removed, `CLEAR 3-10` sent, and the test look and clip were deleted through the app. PGM ch 2
  stayed at its layer 1 throughout.

Note for operators: a trim edit now restarts the PRV copy of that look (the reload); it does not touch PGM. TAKE is
still what puts the trim on air (WO-954).
