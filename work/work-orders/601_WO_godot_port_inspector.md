**Status: IN PROGRESS (2026-10-18) — look-layer mixer/audio + content sizing + clip start + crop (with WO-600) the media file inspector (facts, waveform, trim/mute defaults, used-in, rename, delete) the mixer-effects editor, the PIP overlay editor, the HTML-template group (reload + timers config), the lower-third editor, the countdown/timer editor, the screen-timer inspector and the lower-third data sheet ported and verified on the box. Next per plan: media preview + versions, CG/LT/timers, live sources, timeline props. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (foundation, shared input controls), WO-600 (selection sources: deck, compose frame, timeline). Side findings §3 are web-client bugs to fix independently of the port.**

# WO-601 — Godot port: inspector (layer / media / effects / PIP / CG / timers / live sources / timeline props)

## Investigation

Full inventory (Haiku, spot-checked): [`work/godot-port/inventory/inspector.md`](../godot-port/inventory/inspector.md).
Scope: **45 components (9,632 LOC) + 19 inspector-specific lib (2,462) + 6 CSS (1,660) = 13,754 LOC**;
adjacent but owned by other WOs: device-view / destination / previs / fixture inspectors (33 files, 7,308 LOC).

### Architecture today

- One root `div` re-rendered via `innerHTML` on every selection change (`inspector-panel.js:69-75,206-234`);
  sub-inspectors are plain DOM-building functions. `inspector-panel.js` (482) is the selection
  state machine (~16 window/document listeners, debounced refresh that defers while focused).
- Writes go to singletons (`sceneState.patchLayer` ×37 call sites, `timelineState`, `multiviewState`,
  `settingsState`, `dmxState`) then `document.dispatchEvent('scenes-refresh-preview')`; live-to-Caspar
  edits go over HTTP (`api-client.js`, 176 LOC). **The inspector never sends WS**; it consumes 9 WS
  types indirectly (`change`, `timeline.tick`, `timeline.playback`, `osc`, `state`,
  `companion.buttonPreview`, `global_border_sync`, `lower-third.state`, `connect`).
- 61 distinct HTTP endpoints (list in the inventory "Area totals").

### Sub-features (13)

Panel shell + selection routing · shared input primitives (math-input `evaluateMath`, drag-number:
threshold 5 px, sensitivity 0.5) · look layer geometry (fill/position/size/align, aspect-lock
solver) · layer mixer/audio · effects editor (`effect-registry.js` schemas) · layer playlist +
playback mode · media file inspector (WO-592: preview, waveform, trim/mute, versions, rename,
final delete) · PIP overlays (`inspector-pip-overlay.js` 486, debounced live push with
update-vs-remove+apply diff) · HTML template / lower third / countdown / screen timer · live sources
+ host channels (NDI, DeckLink, browser, webpage, live audio) · global border (slices, Art-Net) ·
timeline clip/flag/layer/keyframes · layer-style and look presets.

### Facts that shape the port

1. **Media preview is a hole today** (`inspector-media-file.js:188-211` measures a DOM rect and
   POSTs `/api/media/preview`). In Godot it is an atlas slot (WO-597) drawn in a `TextureRect` —
   the WO-592 media layer stays on the operator channel; only the rect contract changes.
2. **Waveform** is the inspector's only canvas (`inspector-media-file-wave.js:34`), peaks from
   `GET /api/local-media/{id}/waveform?bars=600` → `Control._draw()` polyline, trivial.
3. **Timing constants are behaviour** — keep them exactly (inventory "Port-risk summary"): PIP
   live debounce 200 ms, CG debounce 450, media transport tick 200, screen-timer ticker 250,
   scene-layer refresh 120, geometry throttle 80, scrub seek debounce 60, aspect memory 500,
   Companion preview retry 1200.
4. **Excel roster import** uses `exceljs` in the browser (`lower-third-roster-import.js:167`). Godot
   has no xlsx parser → move parsing to the server (Node already has the dependency):
   `POST /api/lower-thirds/roster/import` (multipart) → JSON rows. Benefits the web client too.
5. **Vite-only import** `?raw` fixture (`inspector-global-border-artnet.js:1`) → a Godot resource.
6. Hard-coded `http://127.0.0.1:4200/template/` (`inspector-webpage-host.js:51-53`) → server origin
   from the client config.
7. Render-time side effect: `inspector-countdown.js:86-106` creates a timer during render — port as
   an explicit action, not a draw-time effect.

### Side findings (web client, fix independently — verified by hand 2026-10-17)

- **Bug:** `scheduleGlobalBorderConfigSave()` dispatches `highascg-global-border-config-save` on
  `window` (`client/components/inspector-global-border-events.js:6`) but `app.js:285` listens on
  `document` — window-dispatched events never reach document listeners, so this autosave hook never
  fires (other autosave triggers may mask it). Needs its own small WO + owner check.
- Dead: `client/components/inspector-panel-routing.js` (173 LOC, 0 importers ✔).
- Unhooked events (no listener in `client/`): `highascg-inspector-render-external`
  (`inspector-panel.js:195`), `highascg-lower-third-state` (`app-ws-handlers.js:217`).

## Port plan

- `InspectorPanel` scene: `ScrollContainer` → `VBoxContainer` of collapsible `Section`s; one
  scene per sub-inspector, instantiated from a selection-kind → scene map (replaces the 16-listener
  state machine with one `SelectionBus` signal).
- Shared controls built once in WO-599: `NumberField` (drag + wheel + math expression),
  `FractionSlider`, `ColorField` (`ColorPickerButton`), `TimeField` (`parseTimeInput`).
- Pure modules ported 1:1 with tests: `fill-math`, `coordinate-origin`, `layer-crop`,
  `effect-registry`, `pip-overlay-registry`, `math-input`, `companion-location-parse`,
  `playlist-timeless`, `global-border-artnet-map`, `trailing-throttle`, `inspector-panel-selection-key`.
- Order: geometry + mixer (needed by WO-600 step 3) → media file → effects/PIP → CG/LT/timers →
  live sources → timeline props (with WO-602) → presets → global border.

## Acceptance

- Parity checklist `work/godot-port/parity/inspector.md` (one tick per "What the operator can do"
  bullet in the inventory), owner-ticked on the box.
- Ported pure modules pass their JS-equivalent tests in gdUnit4.

## Investigation addendum (2026-10-18) — effects never reached PRV through the server nudge
- Effects are not content keys (`client/lib/scenes-preview-snapshot.js:11-23 previewContentCompareKey`), so an
  effect edit on a staged look is "geometry only" → nudge. The web's own geometry-only push re-sends every
  effect line (`client/lib/scenes-preview-push-scene.js` `effectToAmcpLines` loop after the mixer part), but the
  server nudge emitted **crop only** (`src/api/routes-preview-nudge.js` `fx.type !== 'crop'`), so a Godot
  brightness/levels/chroma edit would have been stored but never shown on PRV.
- Neither side reset an effect that was *removed* on the nudge path (the full push does `MIXER CLEAR`).
- Caspar strips a trailing `DEFER` generically for every mixer transform (`caspar-build src-tree
  src/protocol/amcp/AMCPCommandsImpl.cpp:876`), so every effect line can join the nudge's single COMMIT.
- Fix: preview-push asks for `allEffects` + `resetEffects` (types per layer present in the staged look, absent
  now); identity params per type in `NEUTRAL_EFFECT_PARAMS` (keyer/rotation/anchor excluded: the layer's own
  ANCHOR/ROTATION are re-emitted every nudge and the keyer is straight-alpha state). Web drag nudges unchanged.

## Investigation addendum (2026-10-18) — every PIP overlay edit re-took the whole PRV look
- `pipOverlays` is a content key (`previewContentCompareKey`), so the server's preview-push chose a forceCut
  re-take: box log for one border-width change = `LOADBG 2-10 … LOOP IN 0 S…`, `LOADBG 2-11 … SEEK 0`, overlay CG
  lines, `PLAY 2-10`, `PLAY 2-11` — both clips restart on every slider tick.
- The web's own push does not: an unchanged clip gets mixer lines + `buildPipOverlayAmcpLinesAll` with the previous
  overlays (`client/lib/scenes-preview-push-scene.js`), and the inspector updates in place when types/sides keep their
  order (`inspector-pip-overlay.js` struct rule).
- Fix: preview-push mode `overlay` (`src/api/routes-scene-preview-pip.js`) = the web rule with overlays stripped from
  both sides → nudge + overlay CG lines on the PRV take chain. Outside-side overlays still re-ADD (server
  `canUpdateInPlace` excludes them, same as the web) — only the overlay template reloads, never the clips.

## Investigation addendum (2026-10-18) — CG / lower thirds / timers (web bugs found while porting)
1. **Lower-third Play never animates out** (`client/components/inspector-lower-third.js` fetchActiveOnLayer): it reads
   `GET /api/lower-thirds/active` with no channel → `resolveCgRequestChannel` falls back to channel 1's state while the LT
   runs on the edit bus (PRV), and it compares `st.layer` — rewritten to the 700+ CG host by `applyLtRoutingFields`
   (`src/api/routes-lower-thirds.js:127`, `src/engine/cg-routing.js:34`) — with the look layer number. Never equal → every
   Play is load + update + play. Box: Godot's server-side toggle (logical layer on the routed channel) sent `CG 2-702 STOP 1`.
2. **HTML template "Reload page" hits the wrong layer** (`inspector-html-template.js` reloadHtmlTemplateLayers): `CALL
   <ch>-<look layer> RELOAD`, but templates run on the CG host (box: `playback_timers.html` ADDed on `2-702`, look layer 12
   empty) and PGM bank B is +100. Godot uses `POST /api/scene/layer-reload` (server-resolved layers, only channels that stage
   the look) → `CALL 2-702 RELOAD`.
3. **timersConfig never reached scene.live from a take payload**: `buildIncomingScenePayload` (web, scenes-shared.js) and
   its server twin `buildServerIncomingScene` copy a fixed source field list without `timersConfig`, and the template reads
   its config only from `scene.live` (`template/playback_timers.js:79-95`). The web hid it on PRV by re-registering the full
   stored look (`/api/scene/live/preview`); PGM takes and every server-built push lost it. Also the preview-push nudge
   re-registered PRV without broadcasting `scene.live`. Fixed in both builders (parity smoke still green) + broadcast when a
   layer source changed.
4. **Every take sent lower-third data to countdown templates** (web `buildIncomingScenePayload` + server twin): the LT
   branch is `ltCfg || resolveLayerLowerThirdCgData(l)`, and the latter accepts ANY object `layer.cgData` — the countdown
   inspector writes its config there — so the row got `buildLowerThirdCasparCgData({})`. Box, before: re-take of a
   60 s countdown → `CG 2-702 UPDATE 0 {name:"",title:"",displayDurationSec:10,…}`; after the countdown branch:
   `{mode:duration,durationSec:60,…}`. Fixed in both builders (parity smoke green).
5. **Countdown "Position px" never stored** (`inspector-countdown-controller.js` getCurrentConfig): the config is rebuilt
   from a fixed key list without `posX`/`posY`, so the WO-320A override is dropped from countdownConfig, cgData and the
   CG set. Godot keeps the whole config. Also `#cd-duration` no longer exists (HMS input) — harmless, falls back to cfg.
6. **Any screen-timer settings save restarted / reset the timer** (`src/engine/screen-timers.js` assignTimerToScreen,
   re-assign branch): `changingDuration` was "config has a durationSec key", and every save sends the whole merged config
   (`timer-control-panel-inline-time.js` saveTimerConfigPatch — also the WO-381 position-applies-at-once path), so moving a
   running timer re-anchored `cmdAt` to now with the full duration, and a paused one's frozen `remainingSec` was reset.
   Box (curl): pause → `remainingSec 297.993`; px save → `300`. Fixed server-side (only a changed duration re-anchors) —
   covers the web dock/inspector too. Smoke `smoke-wo601-screen-timer-reassign` fails 2/2 on the old code.
7. (suggestion, not a bug) The roster's column guess has English needles only (`guessRosterMapping`): a Polish sheet
   ("Imię", "Nazwisko", "Stanowisko") maps nothing and the operator picks all three columns by hand. Adding Polish needles
   (imię/imie, nazwisko, stanowisko/funkcja/rola) to the shared lib would fix both clients — owner's call.
Bugs 1–2 and 5 stay in the web client (Godot no longer uses those paths) — candidates for a small web WO.

## What was done (2026-10-18)

| Piece | What |
|---|---|
| `src/api/routes-scene-layer-tools.js` | `POST /api/scene/layer-fit` (= web reapplyLayerFrameForContentFit, shared fit chain with new-layer) and `GET /api/scene/layer-options` (= resolveProgramLayoutForMain → audioOutputRoutesForLayout on the exact /api/settings payload) — computed with the web's modules, nothing stored |
| `godot/client/features/live/layer_inspector.gd` | content sizing (+ refit), clip start point, loop (only when the source can loop), straight alpha, rotation, audio route / route source channels, mute, volume fader + dB, fade on end |
| `godot/client/features/live/mixer_math.gd` | audio-volume-scale.js fader curve + dB text, media-ext.js sourceSupportsLoopPlayback — golden-tested against the JS |
| `godot/client/features/live/media_inspector.gd`, `media_math.gd` | media file inspector: facts, waveform + trim shading, trim/mute defaults, used-in, rename, final delete; parseTimeInput/formatMediaTimecode golden-tested |
| `godot/client/features/live/effects_model.gd`, `effects_section.gd` | mixer effects (inspector-effects.js): add one per type, remove, primary + collapsed advanced params, select/bool/float/int editors, crop in px of the content resolution (from layer-fit's `contentResolution`, fallback the channel). Schemas are NOT re-declared: `GET /api/scene/effect-registry` serves the web's `effect-registry.js` |
| `godot/client/features/live/pip_model.gd`, `pip_section.gd`, `param_field.gd` | PIP overlays (inspector-pip-overlay.js): stack ≤ `pipMaxStack` cards — type, ↑/↓ (index 0 behind), ✕, params with `visibleWhen` rows toggled in place; colours as CSS (`#rrggbb`, translucent → `rgba()`); legacy single `pipOverlay` read and cleared on the first edit. `param_field.gd` = shared schema editors (effects use it too). Registry endpoint also serves `PIP_OVERLAYS` + max stack |
| `src/api/routes-scene-preview-pip.js` | preview-push `overlay` mode (see addendum) |
| `godot/client/features/live/lower_third_model.gd`, `lower_third_section.gd` | lower thirds: 1:1 port of `buildLowerThirdCgData` / `buildLowerThirdCasparCgData` (byte-equal JSON golden) so each edit patches `source.lowerThirdConfig` + `cgData` synchronously (a TAKE right after typing never carries stale text); title/subtitle/font/position/sizes/scale/hold/colours, 450 ms debounced CG UPDATE, ▶ Play (flushes first), Delete. Roster not ported yet |
| `src/api/routes-scene-lower-third.js` | `POST /api/scene/lower-third` resolve / update / play / clear on the web's lower-third-cg-data.js + existing /api/lower-thirds handlers; edit-bus routing; play toggle by logical layer |
| `godot/client/features/live/template_section.gd`, `routes-scene-layer-tools.js` | HTML template group: Reload page (`POST /api/scene/layer-reload`), playback_timers Timers Config → `source.timersConfig` |
| `godot/client/features/live/countdown_model.gd`, `countdown_section.gd`, `src/api/routes-scene-countdown.js` | countdown/timer: binds a project timer instance (`project.scenes.timers`, auto-created; autosave carries it), name/mode/duration H:M:S/target/format/thresholds/position + px/hide/sizes/colours/aux, Start/Pause/Reset; edits patch `source.countdownConfig` + `cgData` at once, 450 ms later CG set + propagation to every other bound layer (other looks: deck sync). `POST /api/scene/countdown` = edit-bus routing onto `/api/countdown/*` |
| `godot/client/features/live/screen_timer_model.gd`, `screen_timer_panel.gd`, `deck_view.gd` ⏱, `live_tab.gd` | screen-timer inspector (inspector-screen-timer.js + settings form): readout on the server clock (`serverNowMs` offset — the web uses the client's own clock), transport, show/hide/fades, opacity, settings (position + px at once, rest on Save to every assigned screen), remove, add; all `/api/timers/*` |
| `src/api/routes-lower-third-roster.js`, `godot/…/lt_roster_model.gd`, `lt_roster_section.gd` | lower-third data sheet: server-side Excel/CSV parse with the web's lib (`POST /api/lower-thirds/roster/import`, port fact 4), mapping / search / row picker in Godot, `source.lowerThirdRoster` |
| `src/engine/screen-timers.js` | only a changed duration re-anchors a re-assigned timer (addendum 6) |
| `src/engine/scene-take-payload.js`, `client/components/scenes-shared.js`, `routes-scene-preview-push.js` | `timersConfig` kept in take/stage payloads; `scene.live` broadcast after a nudge that changed a source |
| `src/api/routes-preview-nudge.js`, `routes-scene-preview-push.js` | preview-push nudge carries every effect + identity resets for effects removed since the staged look (see investigation addendum) |
| `godot/client/run-client.sh` | `--check` boot bounded at 45 s: a parse error in `app/main.gd` hung the check (the quit timer lives in that script) instead of failing |
| (WO-600) `compose_math.gd`, `look_editor.gd` | geometry move/resize/crop already ported there |

## What was VERIFIED

- 2026-10-18 box (PRV ch2): inspector on layer 10 of "Background" → Fit canvas + mute + fader 50 % stored as
  `contentFit: fill-canvas` (refit fill 1.0×0.622), `muted: true`, `volume: 0.2512` (−12 dB); PRV re-taken because these
  are content keys (`LOADBG 2-10 …`, `MIXER 2-10 VOLUME 0`). Server smoke `smoke-wo601-layer-tools` 4/4; Godot 436/0.
- Media inspector on a library file: In "1.5" / Out "0:40" / Mute → stored {trimInMs 1500, trimOutMs 40000, muted}; usage 2 looks;
  adding the clip then copied them into the new layer (after the WO-611 #5 fix). Test defaults cleared afterwards. Godot 453/0.

- Effects editor, box (PRV ch2, look "Background" layer 10, real UI controls via `--probe-effect`, seeded with the
  look's crop and restored after): Caspar log, every step a nudge (no LOADBG/PLAY):
  `+brightness` → `MIXER 2-10 BRIGHTNESS 1 0 DEFER`; spin 1.4 → `BRIGHTNESS 1.4 0 DEFER`; `+levels` →
  `LEVELS 0 1 1 0 1 0 DEFER`; ✕ brightness → reset `BRIGHTNESS 1 0 DEFER`; restore → reset `LEVELS …`; each
  followed by `MIXER 2 COMMIT`. Stored look back to its crop only. Smokes: `smoke-wo601-effects-nudge` 5/5,
  layer-tools 5/5 (registry = web MIXER_EFFECTS), nudge + WO-598 push 27/0; offline suite 2640/1 (the known
  shader-library smoke, red on main too); Godot 477/0; `--check` proven to fail on a main.gd parse error.
- PIP editor, box (PRV ch2, "Background" layer 11 → CG slots 2-264…267, `--probe-pip`, restored after): +border →
  `CG 2-264 ADD 0 "pip_border" … width 4`; spin 9 → re-ADD width 9; +shadow → `2-265 pip_shadow`; ↑ → slots swap
  (shadow 264 behind, border 265); ✕ border → 265 cleared; restore → all four slots cleared. **Before the overlay
  mode** every step also sent `LOADBG`/`PLAY` for both clips; **after**: zero LOADBG/PLAY/STOP lines in the run.
  Smoke `smoke-wo601-pip-preview` 7/7 (decision, in-place UPDATE vs re-ADD, reorder/remove clears, handler never
  re-takes); offline 2647/1 (known shader-library smoke); Godot 509/0 (pip model 4 tests, golden vs node).
- CG/LT/timers, box (look "Background" on PRV ch2, `--probe-cg`, layers added and removed again — stored look back to 10, 11):
  LT layer 12 → title typed → `cgData.name = "Jan Kowalski"` immediately; ▶ Play → `CG 2-702 ADD 1 "lower-thirds/lt-classic-box"
  … Jan Kowalski`, `UPDATE 1`, `PLAY 1`; ▶ Play again → `CG 2-702 STOP 1`; Delete → `CG 2-702 REMOVE 1`. Timers layer: Compact
  → no AMCP (nudge), `GET /api/scene/live` ch2 `timersConfig.compact` None → True 2 s later (after the payload fix); Reload →
  `CALL 2-702 RELOAD`. Smoke `smoke-wo601-lower-third-template` 6/6, WO-598 payload parity green; Godot 523/0 (LT model
  byte-equal JSON for 4 configs incl. legacy/invalid values).
- Countdown, box (`--probe-countdown` on "Background", layer + timer removed after): timer `sc_<ms>_<7>` created and bound;
  H:M:S 0:01:00 → `cgData.durationSec 60`, `CG 2-702 UPDATE 0 {mode:duration,durationSec:60,…}`; Start/Pause/Reset →
  `UPDATE 0 {cmd:start|pause|reset}`; PRV re-take before/after the payload fix as in addendum 4. Smoke
  `smoke-wo601-countdown` 4/4; Godot 551/0 (countdown model 4 tests); offline 2657/1 (known shader-library smoke).
- Screen timers, box (`--probe-timers=0`, PGM ch1, timer removed after): `CG 1-980 ADD 0 "countdown/countdown"` + `MIXER 1-980
  OPACITY 1`; start → readout 00:04:57 after 2.2 s; pause; px save → `CG 1-980 UPDATE` with posX/posY and the readout stays
  00:04:57 (after the addendum-6 fix; was 00:05:00); Fade In → `OPACITY 1 25 linear`; opacity → `OPACITY 0.5`; Fade Out →
  `OPACITY 0 25 linear`; Remove → `CG 1-980 CLEAR`. Godot 583/0 (screen-timer model 4 tests, golden vs node); offline 2659/1.
- LT data sheet, box (`--probe-roster=people.xlsx`, layer removed after): import → `people.xlsx · 2/2 rows`, mapping guessed
  Name / Last name / Job title and stored in the layer; row 2 picked → `cgData` "Piotr 42" / "Guest"; Play → `CG 2-702 ADD 1
  … name:Piotr 42,title:Guest`, `PLAY 1`; Delete → `REMOVE 1`. Smoke `smoke-wo601-lt-roster-import` 3/3 (CSV, xlsx,
  oversize/empty/.xls/missing); Godot 599/0 (roster model 3 tests, golden vs node); offline 2662/1.
- My first probe run edited the look's existing crop (wrong card) and removed it; repaired through the seeded probe
  (deck sync), stored look verified. Owner QA: dragging the effect sliders interactively.

Side findings re-checked by hand (`git grep`, file reads). Everything else is the Haiku inventory.
