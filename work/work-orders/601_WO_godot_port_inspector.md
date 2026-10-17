**Status: OPEN (2026-10-17) — investigation + port plan written; nothing implemented. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (foundation, shared input controls), WO-600 (selection sources: deck, compose frame, timeline). Side findings §3 are web-client bugs to fix independently of the port.**

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

## What was done

Nothing yet.

## What was VERIFIED

Side findings re-checked by hand (`git grep`, file reads). Everything else is the Haiku inventory.
