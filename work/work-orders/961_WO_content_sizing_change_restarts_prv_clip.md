# WO-961 — Changing a look layer's content sizing restarts its clip on PRV

**Area:** engine, godot-client
**Status: DONE (05.11.26 — smoke 4 tests + the 31 existing preview-push / snapshot tests green, test:ci and Godot suite green; GUI e2e 20 in the --air sandbox: before = preview take, `PLAY 2-10`, PRV playhead 2.32 s → 0.00 s; after = nudge, MIXER only, 2.40 s → 2.56 s) — owner QA**

Owner 05.11: *"when i change content sizing the clip restarts in prv, it shouldnt."*

## 1. Investigation

- The client path (Godot look editor):
  - `layer_inspector.gd:236` `_on_fit` emits `{"contentFit": fit}` (`:240`), asks the server for the refit
    (`POST /api/scene/layer-fit`, read-only: it stores nothing) and emits the new `{"fill"}` (`:243`). Both patches go
    through the look editor → deck sync → `preview_pusher.gd:49` `POST /api/scene/preview-push`. Nothing on the
    client asks for a reload; `look_editor_fit.gd` only reads the clip size for the editor's boxes.
- The server path:
  - `src/api/routes-scene-preview-push.js:42` `decidePreviewPush` picks a MIXER nudge when the web's shared rule
    `isGeometryOnlyPreview` (`client/lib/scenes-preview-snapshot.js`) calls the edit geometry-only, else a preview take
    (`:146`, `forceCut: true`), which re-PLAYs every clip of the look.
  - That rule's content key `previewContentCompareKey` holds `contentFit` (`scenes-preview-snapshot.js:16`, filled at
    `:50`). So every content sizing change was "content" → take → the clip restarted from the top on PRV. WO-155
    fixed the "every param edit restarts" class, but contentFit stayed in the content key on purpose there (the web's
    in-browser push), and the Godot editor inherited it through the server's WO-598 C2 decision.
- contentFit never needs a reload: the take itself only turns it into a MIXER FILL. `scene-take-lbg-jobs.js:200` and the
  nudge (`routes-preview-nudge.js:241`) call the same `getResolvedFillForSceneLayer` (`scene-native-fill.js:402`),
  whose `resolveSceneLayerFill` maps contentFit → stretch mode (`mapContentFitToStretch`, `:299`, used at `:382`). For
  templates (shaders included), routes and timelines it returns the raw fill whatever the contentFit, so nothing about
  them depends on it either (`look_thumb_math.gd`'s "shader templates stretch" is the thumbnail's own drawing rule).
  `contentFit` reaches no LOADBG / PLAY / CG parameter.
- Reproduced in the GUI e2e sandbox with a throwaway real Caspar (`node tools/e2e/run-gui-e2e.js --air
  --e2e=20_wo961_content_sizing_no_reload`, 2 × 720p, PRV = ch 2, `e2e_bars.mp4` 4 s, not looped), before the fix,
  Content sizing Native → Stretch:
  ```
  push mode take, PRV time 2.32 → 0.00
  AMCP: MIXER 2 COMMIT | PLAY 2-10 | MIXER 2 COMMIT | MIXER 2 COMMIT
  ```

## 2. What was done

- `src/api/routes-scene-preview-push.js`: `decidePreviewPush` compares the staged PRV look and the edited look through
  a new `withoutContentFit(scene)` (every layer's `contentFit` dropped), for the geometry-only check and for the WO-601
  overlay-only check. A content sizing change is now a nudge like any resize; the nudge still gets the real layers, so
  `getResolvedFillForSceneLayer` resolves the fill with the new contentFit (the numbers a take would send), and
  `registerStagedScene` stores the new contentFit as the staged state. A clip / loop / audio / trim (WO-955) change
  made together with it still reloads.
- Why on the server and not in `previewContentCompareKey`: that rule is also the web client's own in-browser
  decision (WO-155); same reasoning as WO-955. The server change fixes every client that pushes through
  `/api/scene/preview-push`, which is the Godot editor.
- No client change was needed (`layer_inspector.gd`, `look_edits.gd`, `look_editor_fit.gd` untouched).
- `tools/smoke/smoke-wo961-content-fit-nudges-prv.test.js` (new, to be added to the curated CI list): every fit change
  alone → nudge (absent = native); with a clip swap / loop flip / trim → take; the handler nudges with the new
  contentFit and never takes; `resolveSceneLayerFill` gives different fills for native / stretch / horizontal /
  vertical (the nudge shows the new sizing). It fails 2/4 without the fix.
- `godot/client/e2e/scenarios/20_wo961_content_sizing_no_reload.gd` (new, needs `--air`; without it one step says it was
  not run): makes a look from the clip, opens it in the editor (staged on PRV), picks Content sizing → Stretch, then →
  Fill width, and checks per change: the server's AMCP ring (`<sandbox>/data/amcp-last50.txt`) has MIXER lines for
  PRV and no PLAY / LOAD / LOADBG on it, the preview push mode is `nudge`, and Caspar's INFO playhead did not go back.

## 3. Verified

- Smokes: WO-961 4/4 + WO-955, WO-598, WO-601 PIP, WO-155 snapshot = 35/35. eslint clean, `check-max-file-lines` OK.
  `npm run test:ci` 5325 pass / 0 fail (5 skipped); Godot suite 25992 passed, 0 failed.
- GUI e2e 20 in the --air sandbox (real Caspar 2.5, throwaway), after the fix 4/4:
  ```
  Stretch:    push mode nudge, PRV time 2.40 → 2.56
              AMCP: MIXER 2-10 FILL 0 0 1 1 0 DEFER | MIXER 2-10 ANCHOR 0 0 0 | MIXER 2-10 ROTATION 0 0 DEFER |
                    MIXER 2-10 OPACITY 1 0 DEFER | MIXER 2 COMMIT
  Fill width: push mode nudge, PRV time 4.00 → 4.00 (the clip had reached its end; no restart)
              AMCP: the same MIXER lines, no PLAY
  ```
  (The 1280×720 test clip on a 720p channel fills the same rect for every fit, hence FILL 0 0 1 1; the smoke covers
  that the resolved fill changes with the fit.)
- The live server was not restarted; the fix reaches the box with the next node restart. Owner QA: change content
  sizing on a playing look staged on PRV — the clip keeps playing and re-sizes.

Not changed, noted: a volume / audio route / mute change on a look layer is still "content" and re-takes PRV (restarts
the clip) — those need MIXER VOLUME / audio filter work, not a compare-key change.
