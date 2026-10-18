**Status: IN PROGRESS (2026-10-18) — steps 1–2 done on the box; steps 3a–3c (look editor: compose frame over live PRV, move/resize, crop, layer fields; Sources panel + drop to add; remove/reorder) done on the box. Next: layer inspector depth (content fit, loop, audio, transitions per layer → WO-601), effects/PIP/border (J, needs WO-598 C3), route sources (WO-156 rules server-side), multiview editor (M). Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (foundation), WO-598 (contract/thin-client decisions), WO-597 (atlas). First feature WO after the foundation; previs (WO-607) follows it.**

# WO-600 — Godot port: live operation core (deck, PRV/PGM, compose tiles, look editor, take, sources, live inputs, multiview editor, timers)

## Investigation

Full inventory (Haiku, spot-checked): [`work/godot-port/inventory/live-core-scenes-preview.md`](../godot-port/inventory/live-core-scenes-preview.md).
Scope: **144 JS files (74 components / 16,401 LOC, 70 lib / 10,850 LOC) + 20 CSS files (4,772 LOC)**.

| # | Sub-feature | JS files / LOC | Fate in Godot |
|---|-------------|---------------|---------------|
| A | Operator-GUI mode gate + preview-hole rect reporting | 5 / 1,008 | **Not ported.** Replaced by atlas *demand* (WO-597 §D). No rects, no 150 ms throttle, no three suppression latches (interaction 300 ms / compose-holes / foreground-tab), no `document.title` marker. |
| B | PRV/PGM preview panel + compose preview sources | 17 / 3,101 | Rebuilt: tiles = `TextureRect` + `AtlasTexture` on the shm atlas; overlays via `Control._draw()`. JPEG / WebRTC / WebCodecs modes are not needed locally (remote → WO-610). |
| C | Operator compose tiles (free tiles) | 5 / 1,377 | Rebuilt as Controls; `operator-compose-tiles-geometry.js` (pure) ported 1:1. |
| D | Scenes deck (looks grid, main columns) | 11 / 1,543 | `HFlowContainer` of `LookCard` scenes; Godot drag API for reorder/drop. |
| E | Scenes editor shell, look edit, take | 9 / 1,838 | `HSplitContainer` shell; take via server command (WO-598). |
| F | Look compose frame (layer stack editor) | 7 / 2,020 | `Control` with `_draw`/`_gui_input` move/resize/crop; `layer-crop.js` ported 1:1. |
| G | PRV preview push pipeline (look edits → PRV bus AMCP) | 13 / 2,104 | **Decision in WO-598:** move to server (preferred) or port the AMCP builders unchanged. |
| H | Scene/look state model + persistence | 10 / 1,822 | `SceneState` autoload; serialize/migrate ported; **project JSON must stay byte-compatible** with the web client (WO-598 golden tests). |
| I | Transitions | 2 / 113 | Pure → port. |
| J | Global border, PIP overlays, effects | 9 / 2,233 | Registries + AMCP builders pure → port (or server, WO-598). Fixed layer numbers 996/997/998 and PIP band 260–979 must match `src/`. |
| K | Sources panel (media, effects, templates, placeholders, ingest) | 16 / 2,683 | `Tree` + typed drag payloads; OS file drops via `Window.files_dropped`; uploads per WO-599 HTTP layer. |
| L | Live inputs + live audio | 16 / 3,227 | Forms; keep the rule "PGM never plays `alsa://`; capture on a dedicated channel, PGM uses `route://`" (`live-audio-routing.js:1-3`). |
| M | Multiview editor | 8 / 1,659 | Control canvas; `multiview-editor-canvas-layout.js` solver ported 1:1 (`solveCellDimensions*`, `getContainedVideoRect`). |
| N | Mapping, screen destinations, editor defaults | 8 / 1,217 | Settings/Device View forms (WO-605/608). |
| O | Playback timers + clocks | 8 / 1,306 | `playback-clock.js`, `playback-timing-clock.js`, `layer-playhead-resolve.js` pure → port; `Label` + progress bar. |

### Load-bearing facts found (all cited in the inventory)

1. **The client is the editor of the show document.** `sceneState` (+ timelines, multiview, program
   output) is exported whole and pushed by `POST /api/project/autosave` with an optimistic `rev`
   (`client/app.js:164-200`, 409 `stale_rev` retry ≤ 3, 410 `project_gone` latch); the server
   echoes `project_sync` to every client, which imports it silently (`client/lib/app-ws-handlers.js:221-244`)
   and re-applies the last `scene.live`. ✔ read by hand. A Godot client must speak exactly this
   protocol and produce **the same project JSON**, or a web client and the Godot client editing
   the same show will corrupt each other. → WO-598.
2. **Browser-side AMCP:** 12 client files send raw AMCP via `/api/raw` (34 call sites),
   `/api/amcp/batch`, `/api/amcp/raw-batch` (✔ grep). The PRV push pipeline (G) builds AMCP batches
   in the browser (`lib/scenes-preview-push-scene.js`, 488 LOC; `components/scenes-editor-support.js`
   takeGroup fan-out). → WO-598 decides server-side vs. port.
3. **Takes already work by id on the server:** `routes-scene-take.js:84-90` resolves `sceneId` from
   the stored project when `incomingScene` is absent (WO-585, used by Companion). The web client
   still sends its own `buildIncomingScenePayload()` (`scenes-preview-runtime.js:215-240`). ✔ read by hand.
4. **Shared constants duplicated client/server:** layer bands (`LOOK_LAYER_*`, PIP 260–979,
   borders 996–998), `scene-look-kind.js` ("keep in sync with src/engine/scene-look-kind.js").
   Godot must take them from one source → WO-598 exports them as JSON from `src/` at build time.
5. **Drag contract:** Sources → deck/compose/multiview/tiles use `application/json`
   `{type, value, label}` with a `text/plain` fallback (`operator-compose-tiles.js:305-307`).
   Godot drag data keeps the same dictionary shape.
6. **Firefox-specific workaround to drop:** deck reorder is pointer-based because ESR does not fire
   `dragstart` reliably (`scene-list-column-reorder.js:6`) — Godot's drag API is reliable.
7. Dead code found: `scenes-compose-handlers.js` `startRotate`/`startScale` unwired (`:242`).

## Port plan

Order (each step usable on the box behind the fallback switch):

1. **Read-only live view (canvas mode):** deck (D) showing looks + on-air/preview highlight from
   `scene.live`; PRV/PGM tiles drawn from the shm canvas (B, canvas mode); playback timers (O).
2. **Operate:** click look → PRV; take/cut/FTB (E); transitions (I); live state round-trip.
3. **Edit:** look compose frame (F), layer stack (H), sources panel + drops (K), global border/
   PIP/effects (J) — needs WO-598 project-model parity first.
4. **Atlas mode:** switch the preview tiles + compose tiles (C) to WO-597 atlas; then the
   multiview editor (M) and live inputs (L).

## Acceptance

- Parity checklist `work/godot-port/parity/live-core.md` generated from the inventory's "What the
  operator can do" bullets (one tick per bullet), ticked by the owner on the box.
- Web and Godot clients open on the same project: edits in either appear in the other within
  one autosave cycle; no `stale_rev` storms (journal), project JSON diff after round-trip = ∅.
- Atlas mode: dragging/resizing a preview tile = zero AMCP lines.
- Ported pure modules carry their JS unit tests as gdUnit4 tests with identical expected values.

## What was done

**Step 1 (2026-10-17):** `godot/client/features/live/`:
- `deck_model.gd` — pure port of the deck rules with source refs: screen count (`scenes-editor.js:45`),
  looks per main incl. `'all'` (`scene-state.js:266-272`), PGM/PRV per main (`scene-live-main-sync.js:62`
  `resolveBusLookIdsForMain`, incl. the project `liveSceneIdByMain`/`previewSceneIdByMain` fallback and the
  armed-PRV rule for PGM-only mains). 7 unit tests.
- `deck_view.gd` — columns per main, cards red = PGM, green = PRV, accent = global; rebuilds (coalesced per
  frame) on `project`, `scene.*`, `channelMap`, full `state`.
- `live_tab.gd` — operator channel (shm surface `opgui`, canvas mode) above the deck, NO SIGNAL dimming.
**Step 2 start (2026-10-17):** card click = stage on PRV, double-click = TAKE (both `POST /api/scene/take-look`,
WO-598 C1); per-column **TAKE** (PRV → PGM) and **FTB** (`POST /api/ftb`, web body: 0.5 s at the main's fps);
right-click = **rename** (first edit through `ProjectSync`). Verified on the simulator: PRV/TAKE 200 with the
take engine's AMCP and `scene.live` updated (deck re-highlights: Look 1 PGM red, Look 3 PRV green — screenshot),
FTB 200 (ch1 cleared from `scene.live`), rename persisted (server rev 2 → 3).

**Step 2 — transitions (I) + timers (O) (2026-10-17/18):** `features/live/`:
- `transitions.gd` (1:1 transition-presets.js + transition-duration.js) and `pgm_timer_model.gd` (playback-timer(-format).js
  rules) — **golden-tested**: expected values generated by running the client JS under node (`tests/test_transitions_timer.gd`),
  plus the WO-250/WO-297 smoke cases mirrored. `look_edits.gd` = SceneState setGlobalDefaultTransition /
  applyGlobalDefaultToAllLooks / setDefaultTransition on the project `scenes` envelope (tested).
- `osc_mirror.gd` (server `osc` WS snapshots + deltas, merged like osc-client.js), `pgm_timer_view.gd` (clip | time,
  bar, tiers, idle label), `transition_row.gd` (type · frames · easing, PGM-only list via `preview_bus_available`).
- Deck: default-transition toolbar + "Apply to all looks", transition on each card, right-click menu Rename… /
  Transition… / Use default transition; timer under each main's header. Not ported: the web's rAF extrapolation
  (`playback-timing-clock.js`) — the server already sends elapsed at ~25 Hz; revisit if sparse-OSC codecs stutter.

**Step 3a — look editor (2026-10-18)** — unblocked by WO-598 C2 (`/api/scene/preview-push`) + B (byte-compatible wire JSON):
`features/live/look_editor.gd` (compose frame over the live `prv<N>` surface, select/move/8-handle resize with aspect lock + Shift,
layer list, X/Y/W/H/opacity), `preview_pusher.gd` (web pacing 16 ms / 200 ms, serialized: deck sync → preview-push → autosave),
`compose_math.gd` (edgeResizeDeltaToFill golden-tested, 64 cases from the JS; move snapping per the WO-611 #4 fix, which this
port found in the web code and which was fixed there too). Card menu "Edit look…".

**Steps 3b/3c (2026-10-18):** `POST /api/scene/new-layer` (server builds the layer a media drop creates with the web's own modules:
next free number, editor defaults, images never loop, native fill for the content fit via ffprobe resolution; nothing stored),
`media_panel.gd` (Sources tree from `/api/media`, filter, web drag payload), drop → append + select + PRV push, Remove, ▲/▼
(reorder = web reorderLayers, renumber from 10), crop mode (crop math golden-tested; effects[{type:'crop'}]), overlay fix
(boxes paint above the PRV picture).

## What was VERIFIED

- Against the simulator's real project (5 looks): column "Main 1 · 2 looks" = Look 1 + Look 3 (`mainScope '0'`),
  **Look 3 marked PGM** (= `liveSceneIdByMain[0]`) — same result as the web deck's rules (screenshot, 2026-10-17).
- Live operator video from the pattern bridge in the same window.

- **Step 2 on the box (2026-10-18, owner's second screen = PGM ch1 on DP-7, PRV ch2):** three looks in the project;
  deck take of "Opening" → Caspar log `LOADBG 1-10 "PROJECTS/AIRPORT/1. TLO 1 …" LOOP MIX 25 linear` + `PLAY 1-10`
  (the look's transition); "Background" set to WIPE 30 through the deck path → server rev 358; PGM timer counted
  0:13 → 0:59 / 1:00 with green → red tier; default row shows the auto sentinel 12 resolved to 25 fr @ 50 fps.
  Headless 266/0; `--check` boot OK.

- **Step 3a on the box (2026-10-18, PRV ch2):** editor on "Background" → PRV nudge, box exactly over the clip in the live
  PRV picture; real XTEST drag → 8 streamed `MIXER 2-10 FILL` nudges, **no reload**, stored x/y 0.308/0.311 (= 100 px / 30 px on
  a 480×270 frame); real corner drag → scale 0.6 → 0.5 both axes, top-left anchored, aspect 1.0. Headless 345/0, `--check` OK.

- **Steps 3b/3c on the box:** real XTEST drag Sources → frame added layer 11, PRV re-taken (`LOADBG 2-11 …`); ▼ Down renumbered
  10/11; Remove dropped the layer, numbers kept (web); new-layer on a 3840×1344 clip → native fill 2.0×1.244 at x −0.5; real
  crop drag → `MIXER 2-10 CROP 0 0 0.79 1` nudge, effects stored. Server smoke `smoke-wo600-new-layer` 5/5; Godot 387/0.

Inventory facts 1, 2, 3 re-checked by hand (refs above). The remaining refs are Haiku-read and
must be re-grepped when each sub-feature is started.
