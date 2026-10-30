# WO-860 — Lower-third looks: overlay take over PGM, Scale % that works, the template visible in the look editor PRV

**Area:** engine, godot-client
**Status: DONE (30.10) — smokes 539/0 + wo860 5/0, Godot 23432/0; live on Caspar ch3/ch4 (PRINT frames) and in the Godot look editor (screenshot)**

Owner, 30.10:
> the lower thirds templates and similar only looks should be treated differently than standard looks, they should
> not change the pgm but rather display over it on a cg layer, without touching the standard/video layers. (unless
> there is a video source in a look with the template, then treat normally). also tried a first lower third and the
> scale % parameter does nothing. also the template doesnt show up in the looks editor prv. this space should always
> show the prv channel directly (unless there is no, then use thumbnails hq)

Test look: "Look 23" (`de03131a-…`, project `mhp_harder`), main 2, one layer L10 =
`template LOWER-THIRDS/LT-CLASSIC-BOX`, `cgData.renderScale 100`, `displayDurationSec 10`.

## 1. Investigation

### (a) Scale % did nothing

- Both inspectors write the percent as `renderScale`: web `client/components/inspector-lower-third.js` (input
  `lt-render-scale`, 25–300) via `client/lib/lower-third-cg-data.js:115-135` (into `style`, `data` and the top
  level), Godot `godot/client/features/live/lower_third_model.gd:90-106`.
- Neither engine copy read it. `template/lower-thirds/lt-engine.js` `applyBoxSizeOverride()` (and the split copy
  `lt-engine-styles.js`) scaled the container from `style.boxScale` only, a **factor** (1.5) that CG Studio
  writes (WO-285). Nothing in `src/` reads `renderScale` either, so the value reached the template and was ignored.
- `renderScale` is not in `STYLE_KEYS` and must not be: `smoke-lt-engine-registry-sync` pins the engines' key
  vocabulary to the CG Studio registry. It is not needed: both clients send a structured `{data, style}` payload
  and `normalizeUpdatePayload` copies `style` whole.

### (c) "the template doesn't show up in the looks editor PRV"

- The editor does show the PRV channel directly: `look_editor.gd open()` takes `VideoSurfaces.texture("prv%d")`.
  For main 2 that is the `prv2` shm ring on channel 4 (`GET /api/video-surfaces`: `prv2` channel 4, active).
- Channel 4 held the template (`INFO 4`: layer 700, `lt-classic-box.html`, html producer playing; `MIXER 4-700
  OPACITY` 1, FILL 0 0 1 1), yet `PRINT 4` was fully transparent (RGBA extrema all 0).
- Replaying the server's own lines for Look 23 (`buildSceneTemplateCgAmcpLines`) on channel 2 and printing:
  **2 s: the lower third is on screen; 12 s: gone** (only the template's rule line remains). The look carries
  `displayDurationSec 10` — the lower third animates itself out after 10 s, on PRV as on PGM. An editor opened
  later, or a geometry nudge (MIXER only, no replay), shows an empty PRV.
- So the surface is right; the staged graphic times out. PRV is a staging bus: an auto-out there only hides what
  the operator is editing.

### (b) Template-only looks replace the PGM look

- Every take funnels through `runSceneTakeLbg` (`src/engine/scene-take-lbg.js`): diff against the on-air look,
  exit (fade + clear) every layer the incoming look lacks. A look with only a lower third therefore takes PGM to
  black + the lower third.
- Template CG already lives outside the look band: `resolveTemplateCgHostLayer` (`src/engine/cg-routing.js:33`)
  maps a look layer 10..99 to a CG host 700+ (shaders stay on the look band, WO-322). The exit side clears hosts
  through the WO-196/207 teardown (`scene-take-lbg-teardown.js:200-244`: exiting template layers + every tracked
  host the incoming look does not redeclare).
- Precedent for a look kind that bypasses the look pipeline: WO-572 audio-only looks branch in
  `routes-scene-take.js` before the layer-range validation (`handleAudioOnlyLookTake`) and never touch the video
  look.

## 2. What was done

### (a) — commit 322c2b15

- `lt-engine.js` + `lt-engine-styles.js` `applyBoxSizeOverride`: without an explicit `boxScale`, `renderScale / 100`
  drives the same container scale (anchored at the position corner, bottom). An explicit `boxScale` still wins
  (CG Studio). 100 % writes no transform.
- `tools/smoke/smoke-wo285-box-size-inspector.test.js`: renderScale 150 → `scale(1.5)`, "100" → no transform,
  boxScale beats renderScale — on both engine copies.

### (b) Overlay looks — `src/engine/overlay-look.js`, `src/api/routes-scene-take-overlay.js`

- `isOverlayLook(scene)`: every sourced layer is template CG whose host is on the 700+ band (shaders excluded —
  WO-322, they composite on the look band); empty layers do not count; audio-only looks keep their own branch. One
  video/media/route source makes it a normal look (owner: "unless there is a video source … then treat normally").
- `routes-scene-take.js` branches right after the WO-572 audio-only branch (`handleOverlayLookTake`), so the deck,
  the editor's TAKE, `take-look` (the editor's PRV pushes) and Companion all get it. The handler runs on the
  channel's take chain (`_sceneTakeChainByChannel`) so it never interleaves with a look take.
- PGM: `buildSceneTemplateCgAmcpLines` per layer (the look's transition fades the CG host in, the same ramp a
  normal crossfade take uses for templates), resolved fill like a take job. No LOADBG, no bank flip, no exit, no
  `scene.live` change. The hosts are remembered per channel (`pgmOverlayHosts`).
- A later normal PGM take adds those hosts to its `incomingTemplateHostLayers` (`scene-take-lbg.js`), so the
  WO-196/207 teardown leaves them; a host the new look declares itself is released (`releasePgmOverlayHosts`) — that
  look's template replaces the overlay there. The WO-196 "clear this host on the other PGM channels" pass skips a
  channel whose overlay owns the host (`scene-template-cg.js`), so a take on screen 1 cannot wipe screen 2's
  lower third.
- PRV (`target: 'preview'`): the overlay plays over whatever PRV shows, cut, and becomes PRV's look in
  `scene.live` — the next staging diffs it away like any look; a PGM take's PRV exchange `CLEAR`s the bus anyway.
  PRV overlays are not protected.
- Re-taking an overlay look replays it (CLEAR + ADD): lower thirds are fire-and-forget. There is no separate
  "take overlay off" yet — a PGM lower third leaves by its own auto-out; a held one (displayDurationSec 0) is
  replaced by the next overlay or a look declaring its host. Open if the owner wants an off button (§4).

### (c) Template visible in the look editor

- PRV staging holds lower thirds: `holdLowerThirdCgData` sets `displayDurationSec 0` (top level, `style`, every
  `data` step — the engine lets the active step override `style`) for `lower-thirds/*` templates. Applied to
  overlay looks on PRV and, through `buildTakeJobs({ holdTemplates })` = the bankless (PRV) take, to normal looks
  staged on PRV. PGM keeps the operator's auto-out.
- Look editor backdrop (`godot/client/features/live/look_editor_backdrop.gd`): the PRV surface as before when the
  main has a PRV bus; otherwise the look composited from HQ source thumbnails (`look_thumb.gd`, the deck card
  renderer, `?hq=1`) under the layer boxes, following the edits (`look_thumb.gd refresh`). `look_editor.gd` (494
  lines) only gains the hooks. Autoloads by node and the thumb factory injectable, so the headless runner can
  compile and test it.

## 3. Verified

- Offline: `tools/smoke/smoke-wo860-overlay-looks.test.js` 5/0 (overlay detection, hold, PGM/PRV lines,
  handleSceneTake PGM leaves `scene.live` alone + PRV registers, pipeline wiring pins); every smoke touching the take
  pipeline / template CG / lt-engine: 72 files, 539/0. Godot `test_look_editor_backdrop_wo860` + full suite 23432/0.
- Live, after a node restart (main 2 = PGM ch3 / PRV ch4, Look 23):
  - PGM overlay take: response `overlay: true`; `INFO 3` = layer 10 `KV LOOP PROJEKCJA 3` unchanged + 700
    `lt-classic-box.html`; PRINT 3: the lower third over the running video; `scene.live[3]` still `752c5d0c…`.
  - PRV: staged, PRINT 4 **13 s later still shows it** (held).
  - Normal take of `149fd497` (blackFHD) on main 2 right after the overlay: PGM swapped to black, layer 700 kept,
    PRINT 3 shows the lower third over the new look; PRV exchange cleared the PRV copy.
  - Godot client (test-agent on Xvfb :120 against the live server): Look 23 ⚙ → the editor frame shows PRV 2 with
    "Janusz / Testu" over the PRV video at 3 s and 15 s; PGM 2 untouched.
  - Restored PGM 2 to `752c5d0c…` afterwards.
- (a) LT smokes 42/0 (wo285, lt-engine-registry-sync, wo267). Live on Caspar channel 2 layer 290 (CG ADD of
  `LOWER-THIRDS/LT-CLASSIC-BOX` with `style.renderScale`): 100 → the box as designed; 150 → 1.5× and still
  anchored at the left margin / bottom (PRINT frames compared).

## 4. Open

- No explicit "take the overlay off" control (deck / Companion). Lower thirds leave by their own timer; ask the owner
  whether held overlays need an off button or a deck marker.
- A PGM overlay host stays tracked after its lower third has animated out (transparent layer) until replaced — harmless.
- Not yet tried on the owner's screens: the PGM-only thumbnail backdrop (this box's mains all have PRV; covered by the
  Godot test).
