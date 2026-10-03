# WO-590 — Template layers ignore layer position on PGM; LT page fixed at 1920×1080 on a 3072×1024 channel

**Status: IMPLEMENTED 03.10.26 — offline suite 2555 pass / 1 fail (unrelated, WO-586 shader label) / 2 skip; template probed headless at 3072×1024 and 1920×1080. NOT deployed: needs a highascg restart (owner's call). Owner QA: move/resize a template layer on a live look, check it follows on PGM.**

Owner, 03.10 (on WO-589's Confetti Center): *"even when center is picked its not centered. also positioning the layer that the template is on does not move the template, so i cant position it exactly where i want."*

## 1. Investigation

- **The channel isn't 1080p.** `/api/scene/live`: ch1 look "loop" has `composeCanvas {w:3072,h:1024}`; `/api/state` OSC format is `3072x1024`. The Caspar HTML producer renders the page at **channel** resolution.
- **The page size was fixed.** Every `template/lower-thirds/lt-*.html` sets `html, body { height:1080px; width:1920px; overflow:hidden }`. On a 3072×1024 frame the page fills only the left 1920 px. "Center" lands at x=960, not 1536, and the bottom 56 px of the page fall outside the 1024-high frame.
- **Layer position never reaches the template on PGM.**
  - The journal shows the take path: `[scene-take-lbg] template CG layer 11 → lower-thirds/lt-confetti-center` (16:42–16:50, incl. `(continuity UPDATE)` when the layer was edited).
  - `buildSceneTemplateCgAmcpLines` (`src/engine/scene-template-cg.js`) sends only `CG CLEAR/ADD/PLAY/UPDATE` to host `700+n` (`resolveTemplateCgHostLayer(11) = 701`).
  - The layer's resolved fill (`job.f`; for templates it is the raw `layer.fill`, `scene-native-fill.js:352`) is emitted only into `job.mixerLines` on the look-band physical layer `job.pLayer` (`scene-take-lbg-jobs.js:315`). Nothing plays on that layer.
  - Same gap in `scene-take-pgm-only.js` (non-shader branch).
- **PRV already does it right.** `client/lib/scenes-preview-push-scene.js:323` puts the template CG on the layer and sends `MIXER FILL` to that same layer. So moving the layer worked in the editor/preview but not on air.
- Shaders (WO-322) play on `job.pLayer` and already get their FILL there. They must not get a second FILL.

## 2. What was done

- **`src/engine/scene-template-cg.js`:**
  - New `templateHostFillLines(cl, fill)` → `MIXER <ch>-<host> FILL x y sx sy 0`, or `[]` when there is no usable fill.
  - `buildSceneTemplateCgAmcpLines` takes `opts.fill` and stages the FILL right after `CG CLEAR`, **before** `ADD` (cut and crossfade variants), so the template never shows at stale geometry.
  - `buildSceneTemplateCgUpdateOnlyLines` takes `opts.fill` too, so a moved/resized layer on a live look follows on air without restarting the template (the continuity path).
  - Without `fill`, output is byte-identical to before (shader band, standalone LT API, countdown callers).
- **`scene-take-lbg-amcp-pipeline.js`** (full + continuity) and **`scene-take-pgm-only.js`** (non-shader only) pass `job.f`.
- **`template/lower-thirds/lt-confetti-center.html`:**
  - The page is `100vw × 100vh`, so it is the channel frame at any resolution.
  - The confetti canvas backing store is resized to `innerWidth × innerHeight` per burst.
- **Not changed:** the other nine `lt-*` templates still hard-code 1920×1080. Changing them would shift existing on-air looks on this channel. That is left to an owner decision.

Fill semantics now match PRV: the layer rect is where the template's full frame goes. A centered template sits at the center of its layer box. A box whose aspect differs from the canvas stretches it, as with media in stretch mode.

## 3. What was VERIFIED

- New `tools/smoke/smoke-wo590-template-cg-host-fill.test.js` (5 tests, added to the curated CI list):
  - FILL on host 701, before ADD (cut + crossfade);
  - continuity UPDATE re-applies FILL;
  - no or invalid fill gives exactly the old output;
  - source guard that both pipelines pass `job.f`.
  - It passes, along with the existing template-CG, WO-322 shader-routing and WO-196 countdown smokes (35/35).
- Full offline suite: 2558 tests, **2555 pass / 1 fail / 2 skip**. The failure is `smoke-wo577-shader-controls` (`sh-sa-fluidic-space.json: junk label "Value"`, from the WO-586 import), which predates this change. 0 files over 500 lines. ESLint: 0 errors; the 1 warning (`sendAmcpLinesSequential` unused in pgm-only) is pre-existing at HEAD.
- Headless Chrome, real template, `position: center`:
  - 3072×1024 viewport → graphic center **(1536, 512)**, canvas 3072×1024, burst spans the frame (viewed);
  - 1920×1080 → (960, 540), unchanged.
- **Not yet proven live:** the server change needs a highascg restart. After that: take a look with the template, move/scale the layer, and check `MIXER 1-701 FILL …` in the AMCP log and the picture on PGM.
