# WO-758 — Content sizing "fill canvas" does not fill the canvas

**Area:** engine, mapping
**Status: DONE (25.10 — smokes 24/0; live after node restart: layer-fit on the 3840×1792 canvas returns 0,0,1,1 for native, where it gave 2×1.659 before; owner QA on a non-canvas-sized clip)**

Owner 25.10: "when using for a layer in a look content sizing = fill canvas, it does not fill the canvas. math is wrong somewhere."

## Investigation

- The fit maths (`fillForContentFit`, web `client/lib`) is correct; its canvas input was wrong. `POST /api/scene/layer-fit`
  (`src/api/routes-scene-layer-tools.js:42` `handleLayerFit`, also `handleLayerReload` :79) and new-layer placement
  (`src/api/routes-scene-new-layer.js:95` `buildLayerForSource`) built the channel map with
  `routing.getChannelMap(config)`, the config-only map with no `programResolutions`. `canvasForMain` then fell back to
  1920×1080 for every main.
- The live canvas on this box is 3840×1792, from Caspar INFO CONFIG via `buildChannelMap(ctx)` /
  `withProgramResolutions(map, ctx)` (`src/engine/scene-take-payload.js:142`). The take path already used that.
- Live probe before the fix: `POST /api/scene/layer-fit {contentFit:"native"}` on a 3840×1792 clip returned
  `scaleX 2, scaleY 1.659`, i.e. 3840/1920 and 1792/1080. That is the clip measured against a 1080p canvas. Fill canvas
  scaled to "cover 1920×1080", which on the real 3840×1792 canvas is neither full nor in proportion.
- `routes-scene-look-preset.js:74` read the recall fps from the same config-only map, so it always got the 50 fallback.

## What was done

- The three routes wrap the config map in `withProgramResolutions(map, ctx)`, the helper the take path uses, so fit,
  reload, new-layer placement and look-preset fps all see the live canvas. Injected `deps.getChannelMap` (tests) still
  wins. No new canvas source: one helper, already the take's.
- `tools/smoke/smoke-wo601-layer-tools.test.js`: a case with no injected map and a 3840×1792 state canvas.
  Fill canvas on 1920×896 gives `{0,0,1,1}`; native gives `{0.25,0.25,0.5,0.5}`.

## What was VERIFIED

- Smokes `smoke-wo601-layer-tools`, `smoke-wo600-new-layer` and `smoke-wo601-look-preset-recall`: 24 pass / 0 fail.
- Live, 25.10 19:40 after `kill -TERM` of node (systemd restarted it in 7 s). `/api/state` canvas is
  `3840×1792 @50`. `POST /api/scene/layer-fit` on both looks (KV LOOP.mp4 and LOOP czysty.mov, both 3840×1792) in all five
  modes returns `{0,0,1,1}`, `contentResolution 3840×1792`. Before the fix, native on the same clip gave
  `scaleX 2, scaleY 1.659`. The Godot inspector takes its fit from this route (`layer_inspector.gd:147,230`,
  `look_editor_fit.gd`).
- Owner QA: fill canvas on a clip that is not canvas-sized (e.g. INTRO_v3 1920×896) fills PGM.
