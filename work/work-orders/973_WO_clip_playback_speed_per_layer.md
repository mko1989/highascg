# WO-973 — Per-layer clip playback speed
**Area:** engine, amcp, godot-client
**Status: DONE (06.11.26, verified on the box over AMCP on PRV ch3 with a burned-in-timestamp clip; take path covered by smokes, not driven through a real look take) — owner QA**

Owner show note (06.11): "Playback speed setting for clips on layers."

## 1. Investigation

- This Caspar build (v2, 2.5.1-based, `~/caspar-build/src-v2/src/modules/ffmpeg/producer/ffmpeg_producer.cpp`) has **no SPEED
  parameter and no CALL SPEED** (CALL knows only LOOP / IN / START / OUT / LENGTH / SEEK). It does take per-clip libavfilter
  chains at PLAY / LOAD(BG) time: `VF` (video) and `AF` (audio) (`ffmpeg_producer.cpp:343-344`; `FILTER` feeds both). So
  speed = `setpts` + `atempo` given at load: a speed change on a running layer needs a re-load (no live CALL). No C++ change.
- Probed live on PRV ch3 layer 90 (non-air), clip = generated 12 s 50p testsrc2 with the pts burned in, so the picture says
  where in the clip it is (INFO `time` is a channel-time counter and is useless here: it runs 1x under any speed).
  - `VF "setpts=PTS/2"` alone: plays at 2x without a seek, but with `IN/SEEK` it jumps ahead (IN 250 → shows 11.96 after 2 s).
    Cause: the producer appends `fps=...:start_time=<seek>` after the user filter, and a halved pts falls below start_time.
  - `VF "setpts=(PTS-STARTPTS)/x+STARTPTS"` keeps the first pts: IN 250 SEEK 250 at 2x shows 9.00 after 2 s, at 0.5x 7.00 after 4 s. 
  - `LENGTH` / `OUT` are measured in **output** time: LENGTH 150 (3 s) at 2x ran to source 11, not 8. So LENGTH must be divided by
    the speed (0.5x: x2). IN / SEEK stay in clip time (channel frames, as before).
  - `AF atempo=x` keeps pitch; atempo < 0.5 is chained (0.25x = atempo=0.5,atempo=0.5). The layer's audio-route `pan=` filter comes first.
- Where a look layer becomes PLAY/LOADBG: `scene-take-lbg-jobs.js` (`loadOpts`) → `amcp-layer-diff-plan.js` → `amcp-command-plan.js`.
  A PRV edit goes `preview-push` → `decidePreviewPush` (WO-955 restages when trim changes). PGM edits apply on the next take.
- Web: `client/components/scenes-shared.js` take-payload whitelist would have dropped an unknown `speed` key (WO-570 trap) → added.
  Look layers are stored whole in the project, so no project-slice whitelist is involved.

## 2. What was done

- `src/caspar/clip-speed.js` (new): `normalizeSpeed` (1/junk → null, clamp 0.25–4, 0.01 steps), `atempoChain`, `speedFilters`,
  `scaleLength`, `clipSupportsSpeed` (plain video files only: no stills / routes / HTML / NDI / shm / URLs).
- `amcp-command-plan.js`: `opts.speed` → ` VF "setpts=…" AF "…atempo…"` after FILTER, and LENGTH divided by speed; only on a command that
  carries a clip. `amcp-layer-diff-plan.js` passes `speed` into the LOADBG.
- `scene-take-lbg-jobs.js`: `loadOpts.speed` from `layer.speed` (single-clip layers only; playlists untouched; dropped for empty starts).
  `scene-take-payload.js` + web `scenes-shared.js` carry `speed`. `scene-transition.js layerVisuallyEqual`: a speed change makes the layer
  differ (a take reloads it). `routes-scene-preview-push.js trimKey`: speed joins trim, so a speed edit on a look staged on PRV reloads PRV (take, forceCut).
- Godot: `clip_trim_model.gd` (`speed_of`, `speed_patch` — 1x clears the key, `supports_speed`), `layer_inspector.gd` "Speed ×" spin row
  (0.25–4, step 0.05, SpinBox = maths + focus select like the neighbouring fields; disabled for stills / routes / templates / timelines).
  It sits directly under the Trim row (not inside the folded body, so it is visible).
- Tests: `tools/smoke/smoke-wo973-clip-speed.test.js` (9, curated in offline-test-files-2.js), `godot/client/tests/test_wo973_clip_speed.gd`.

## 3. Verified

- Box (PRV ch3, layer 90, cleared after; test clip deleted), strings produced by the real serializer: 2x without seek (5.00 at 2.5 s);
  0.5x (2.00 at 4 s); 0.25x (1.00 at 4 s); IN/SEEK 2x (9.00 at 2 s) and 0.5x (7.00 at 4 s); LENGTH 150 at 2x holds on the last frame 7.96
  (trim out 8.0); 0.5x LENGTH 50 holds 5.98; LOOP+IN+LENGTH at 2x loops every 1.5 s wall (7.0 at 4.0 s, 5.08 at 4.5 s).
  Screenshots/stack: scratchpad `stack.png`.
- Smokes 9/9; preview-push / WO-955 / WO-961 / WO-598 / WO-601 groups green; Godot suite 26040 passed 0 failed (before the final edits to the
  .gd files nothing changed afterwards); check-max-file-lines 0; eslint clean (1 pre-existing warning). Offline suite 5385/5392: the 2 reds are
  "contract docs" (WO-974 routes) and WO hygiene (stale INDEX / WO-972 link) — not this WO.
- NOT proven: a real look take / preview-push through the API and the Inspector row on glass; audio pitch/sync by ear (atempo is chained as documented);
  a speed edit on the on-air look does NOT change PGM until the next take (owner declined the live PGM reload for trim in WO-955; a live re-LOAD would
  re-seek and flash). Speed is not part of the layer-style clipboard.
