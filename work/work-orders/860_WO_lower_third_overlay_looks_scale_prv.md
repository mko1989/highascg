# WO-860 — Lower-third looks: overlay take over PGM, Scale % that works, the template visible in the look editor PRV

**Area:** engine, godot-client
**Status: DONE (30.10, 2nd pass §5 same day) — smokes wo860 10/0, Godot 23442/0; live on Caspar ch3/ch4 (PRINT frames), deck ▶/■ and inspector in the Godot client (test-agent screenshots + journal)**

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

## 4. Open (first pass — answered by §5)

- ~~No explicit "take the overlay off" control~~ → §5 (deck ■, auto take-out).
- ~~A PGM overlay host stays tracked after its lower third has animated out~~ → §5 (cleared when played out).
- Not yet tried on the owner's screens: the PGM-only thumbnail backdrop (this box's mains all have PRV; covered by the
  Godot test).

## 5. Second pass — auto take-out, deck stop, hold duration in the inspector

Owner, 30.10 (answering "do you want an off button or an on-air marker?"):
> it should be taken automatically out once its playedout. add hold duration in the inspector. make the play button
> change to stop when on screen, hitting it plays out the cg.

### 5.1 Investigation

- The lower-third engine already plays itself out: `template/lower-thirds/lt-engine.js:97-115` `readDisplayDurationSec`
  (default 10, 0 = hold) + `scheduleDisplayStop` → `CORE.stop()` once the intro is done. `CG STOP` runs the same
  outro. What stayed behind was the server side: the transparent host on 700 and its `pgmOverlayHosts` entry (§4).
- **Measured** (Look 23's lines replayed alone on PRV 1 / ch2 layer 700, `PRINT 2` every second, pixels counted against
  a frame after `CG CLEAR`): 0 px at 1 s, 16.9 k at 2 s, 19.7 k 3→13 s, 3.2 k at 14 s, 38 at 15 s, **0 from 16 s**. So
  intro ≈ 2 s, outro 13→15 s for a 10 s hold. (Channel 7, 720p, did not render the template at all — not chased; the
  4K PRINT files must be moved only after Caspar has written them, and one name per second collides.)
- "Hold duration in the inspector": the field existed ("Hold s", `lower_third_section.gd` NUMS) but was the last row
  of the Lower third group, below Title px / Sub px / Scale %, itself under the media-only rows (content sizing, clip
  start, audio, volume, fade, playback mode) — off the bottom of the Inspector on the box's screen (test-agent
  screenshot). Opening a look in the editor also threw `Nonexistent function 'forget' in base 'Nil'`
  (`layer_inspector.gd:120`): `show_layer({})` runs on the not-yet-adopted Inspector page, before `_ready` built `_trim`
  (the known lazy-page pattern), so the open path aborted with a script error every time.

### 5.2 What was done

- `src/engine/overlay-look-live.js` (new): the on-air registry (channel → look → hosts, timer, until) replacing
  `overlay-look.js`'s host map. `templateHoldSec` reads the hold the way the engine does (active data step > `style` >
  top level > 10 s; non-lower-third templates = 0), `lookHoldSec` = the longest, 0 if any template holds.
  `markOverlayLive` arms the take-out at **hold + 7 s** (`LT_IN_OUT_MS`: intro + outro + ~1 s, from the measurement):
  `CG CLEAR` + `MIXER OPACITY 1 0` on its hosts, `untrackTemplateHosts`, entry dropped. A re-take re-arms; another
  overlay or a normal look declaring the host takes it over (entry loses the host, dropped when empty).
  `stopOverlayLook`: `CG ch-host STOP 0` (outro), broadcast, wait `OUTRO_MS` 3 s (outro measured ~2.3 s), then the same
  clear — unless a later take re-declared the host meanwhile. Every change broadcasts `scene.liveOverlay`
  (`{pgm channel: [{sceneId, hosts, until}]}`); `get-state.js` serves it under `scene`. In memory only (the WO-207
  start sweep clears the 700+ band).
- `overlay-look.js`: `buildOverlayLookLines` also returns per-template holds; `takeOverlayLook` marks PGM overlays live
  and logs `hold=Ns|until stop`. `pgmOverlayHosts` / `releasePgmOverlayHosts` re-exported from the registry;
  `scene-take-lbg.js` passes `self` so a takeover broadcasts.
- `POST /api/scene/overlay/stop {channel|mainIdx, sceneId?}` (`routes-scene.js` → `routes-scene-take-overlay.js
  handleOverlayLookStop`): answers once the outro has started; no sceneId = every overlay on that PGM.
- Godot deck: `deck_overlay.gd` (new) — `on_air(scene.liveOverlay, channelMap, main, id)`; `deck_view.gd` shows ■
  (`assets/ui/icons/stop.svg`, new) instead of ▶ while the card's overlay is on its main's PGM, ■ → `stop_overlay`
  (POST above, "Play out ok" in the deck status). The deck already rebuilds on any `scene*` change, so ▶ returns with
  the broadcast.
- Inspector: "Hold duration" (suffix s, tooltip "…0 = stays until stopped (the deck card's ■)") is now the **first row**
  of the Lower third group (`lower_third_section.gd` `HOLD`, rows built by `_num`). Web inspector: label "Hold duration
  (s)" + the same tooltip (position unchanged there). `layer_inspector.gd`: `_trim` null-guard.

### 5.3 Verified

- Offline: `tools/smoke/smoke-wo860-overlay-take-out.test.js` 5/0 (hold precedence, timer with mocked clock: nothing
  before hold + 7 s, then CLEAR + broadcast `{}`; hold 0 = no timer; takeover; stop = STOP then CLEAR; the route with a
  raw JSON body by mainIdx; wiring pins) + `smoke-wo860-overlay-looks` 5/0. Godot `test_deck_overlay_wo860` + full
  suite 23442/0.
- Live (node restarted; main 2 = PGM ch3, Look 23):
  - Auto take-out: take 13:05:21.93 `hold=10s` → `ch=3 cleared hosts=700` 13:05:37.93 (then hold + 6 s); after the
    7 s change: 13:10:27.95 → 13:10:44.95. `scene.liveOverlay` `{}` afterwards.
  - Deck (test-agent client on Xvfb :120, live server): ▶ on Look 23 → PGM 2 shows "Janusz" over the running video,
    the card shows ■; ■ → journal `stop ch=3` 13:13:08.79, `cleared` 13:13:11.80; 0.7 s after ■ the card is ▶ again
    with the outro under way; 4 s later PGM 2 clean. (`wo860_stop_sequence.png` in the session scratchpad.)
  - First ■ attempt refused "channel or mainIdx required": the router hands handlers the raw JSON text; fixed with
    `parseBody` (the smoke now passes a string, like the router).
  - Inspector: Look 23 ⚙ → layer → "Hold duration 10.0 s" right under the group title, no script error in the client
    log (was 1 per editor open). Typed 4 → project `cgData` 4 everywhere → API take logged `hold=4s`, cleared 11 s
    later. Restored to 10 through the same field; PGM 2 back on `752c5d0c…`, no overlay on air.
- Not done: web deck has no ■ (the Godot client is the operator UI; web parity open). PRV overlays are not tracked
  (staging only, held).
