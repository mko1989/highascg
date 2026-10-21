# WO-655 — Server-built takes letterboxed every look from a 1920×1080 canvas

**Status: DONE (2026-10-21, smoke 36/0 + full suite 2880/0; box: PRV clip now inside the editor box at x 961)**

Found while verifying WO-654: after WO-653 the L11 box had the right width, but the PRV picture showed the clip
~235 canvas px further right than the box (editor box x 961, PRV ≈ 1200; PGM tile the same).

## Investigation

- Look 1 L11: fill x 0.3129 · y 0.0407 · 0.4074 × 0.4889 of 3072×1024 (= 961, 42, 1252 × 501), contentFit vertical.
  Server `calcMixerFill` fill-v keeps x — the box math (WO-653 port) was right.
- Prediction with a 1920×1080 authoring canvas mapped onto the 3072×1024 channel
  (`scene-native-fill.js mapProgramPixelRectToTargetOutput`: k 0.948, pillarbox ox 626): x = 601·0.948 + 626 = **1196**,
  y 42, h 501 — matches the measured ≈1193–1200.
- Cause: `routes-scene-take-look.js` and `routes-scene-preview-push.js` read `routing.getChannelMap(config)`, which has
  **no `programResolutions`** (node: keys listed, `programResolutions` undefined). `scene-take-payload.js canvasForMain`
  then falls back to `FALLBACK_CANVAS` 1920×1080 and stamps `composeCanvas: 1920×1080` on the incoming scene;
  `getProgramAuthoringResolution` prefers `composeCanvas`, so every Godot take / preview push letterboxed the look.
  The web client never hit this — it sent its own `composeCanvas` from the state channel map.
- `sceneLive` confirmed it: ch1 `composeCanvas {1920,1080}`. The smoke stubbed a map WITH programResolutions, so it
  never saw the real shape. Also wrong for the same reason: the take framerate (`?? 50`) and the nudge `res`.

## What was done

- `src/engine/scene-take-payload.js` `withProgramResolutions(map, ctx)`: keeps a map that has resolutions, else
  copies them from the live merged channel map (`ctx.state.getState().channelMap`, then `buildChannelMap(ctx)`).
- Both routes wrap their `getMap(...)` with it, so canvas, framerate and nudge resolution all read the real program.
- `tools/smoke/smoke-wo598-take-payload-parity.test.js`: WO-655 case with the routing-map shape (no resolutions) →
  composeCanvas 3072×1024 and the state fps.

## What was VERIFIED

- Related smokes 36/0; `npm run test:ci` 2880 pass / 0 fail; lint 0 errors; format, 500-line, unwired gates clean.
- Box: server restarted, `POST /api/scene/take-look {target:preview}` → sceneLive ch2 `composeCanvas {3072,1024}`; the
  PRV picture of L11 now sits exactly inside the editor box (x 961).
- Owner QA: next TAKE moves PGM's L11 to x 961 — **layer positions authored in Godot now land where the editor draws
  them; looks placed by eye against the old (shifted) PGM may need nudging once.**
