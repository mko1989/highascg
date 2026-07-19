# WO-267 — CG Studio: dead Play button, canvas placement, drag-to-position editing

**Status:** Implemented (owner acceptance A267.1 pending — canvas-offset trigger unverified offline)
**Priority:** HIGH (owner report 2026-07-18, todos18.07.26)
**Depends on:** WO-265 (studio on :4200 / workspace tab)

## Owner report
1. "the cg studio canvas is showing up way lower than it should be."
2. "the cg studio needs to be able to edit the templates by drag and dropping on the canvas to resize reposition."
3. "the play button doesnt play the animation."

## Ground truth (verified 2026-07-18)
- **Play button root cause (CONFIRMED):** on template select the studio runs `showPreviewInState()` → `studioHoldIn()` (`public/app.js:52-61`), which fast-forwards `animateIn` and leaves the engine at `state = 2` (`lt-engine.js:345-357`). The Play button calls `window.play`, and `play()` only animates from `state === 1` (`lt-engine.js:414-432`) — at state 2 it is a silent no-op. Play has therefore NEVER replayed after the initial hold; it isn't a WO-265 regression.
- **Margin/position stomp (found while reading):** `applyStyles` sets `container.style.margin = my+'px '+mx+'px'` (`lt-engine.js:234-240`, same in `lt-engine-core.js`) — the shorthand erases the `margin-left/right: auto` that implements `position: center|right` (`:224-233`). Any marginX/marginY edit breaks horizontal anchoring. Must be fixed before drag-positioning writes margins continuously.
- **"Canvas way lower": NOT reproducible from code.** `.preview-frame-wrap` is 16:9 (`public/studio.css:128-135`), `#preview` is 1920×1080 absolute top-left scaled by `min(w/1920, h/1080)` (`app.js:22-27`) — geometry is self-consistent. Candidate mechanisms: (a) wrap taller/shorter than 16:9 in the workspace-tab iframe (aspect-ratio not binding as expected) leaving the top-left-anchored scaled iframe off-center; (b) `.preview-pane` overflow-clipping a too-tall wrap (bottom-anchored lower-thirds would clip first ⇒ "lower"). T267.3 hardens both mechanisms defensively (center the scaled iframe mathematically, cap wrap by pane height); A267.1 verifies live since the trigger is unknown.
- Engines: `lt-engine.js` (all lower-thirds except corner-bracket) and `lt-engine-core.js` (corner-bracket). Both already gate studio-only exports on `?studio=1` (`isStudioMode`, `window.studioHoldIn`).
- Inspector fields carry no DOM identity (`app.js createFieldControl`) — drag edits need `data-*` keys to sync values back without a full re-render.

## Design

**T267.1 — Play = replay** (both engines + `public/app.js`)
Engines (studio mode only): export `window.studioReplay()` — `ensurePlayableDefaults(); syncStyleFromActiveData();` then run `cfg.animateIn` at normal speed, land at `state = 2`, `clearDisplayTimer()`. (animateIn's opening `.set()` calls make it self-resetting — verified in lt-classic-box.) Studio Play button prefers `win.studioReplay`, falls back to `win.play` (non-studio contexts unchanged). Stop button stays `stop()` (animate out; after it, state 1 → Play works either way).

**T267.2 — margin fix** (both engines)
Replace the `margin` shorthand with individual `marginTop/Bottom/Left/Right` writes that respect the `position` anchor: left → `marginLeft: mx`, right → `marginRight: mx`, center → horizontal auto preserved; vertical always `marginBottom: my` (`marginTop` cleared). Behavior identical for the default left case, fixes center/right.

**T267.3 — canvas placement hardening** (`public/app.js` `scalePreview` + `studio.css`)
`scalePreview` computes `scale = min(w/1920, h/1080)` AND centers: `transform = translate((w-1920s)/2, (h-1080s)/2) scale(s)` — correct for ANY wrap shape, so a non-16:9 wrap can no longer shift the stage. CSS: `.preview-frame-wrap { max-height: 100% }` so the pane can never clip it. Re-scale on wrap resize via `ResizeObserver` (covers workspace-pane resizes that don't fire iframe window resize).

**T267.4 — drag-to-position + wheel-to-resize** (`public/app.js` + engines, studio mode only)
- Engines export `window.studioGetPlacement()` → `{ rect: container.getBoundingClientRect(), position, marginX, marginY }` and `window.studioSetPlacement({position, marginX, marginY})` (merges into `style`, `applyStyles()`), plus `window.studioGetFontSizes()` → computed `{ titleFontSize, subtitleFontSize }`.
- Studio: transparent overlay div above the preview iframe (the iframe swallows pointer events otherwise). Pointer-drag on the graphic's hit-rect moves it: stage coords = overlay px / scale; horizontal anchor snaps by the graphic's center third (left|center|right), `marginX` = distance from the anchored edge, `marginY` = distance from the bottom; live-applied via `studioSetPlacement` (rAF-throttled), committed into `payload.style` + inspector inputs on pointerup. Wheel over the graphic = proportional resize: scale `titleFontSize`/`subtitleFontSize` ±5%/notch from `studioGetFontSizes`, clamped to the registry min/max, same commit path. Cursor affordances (move/ns-resize) + a one-line hint under the canvas.
- Inspector sync: `createFieldControl` tags inputs `data-style-key`/`data-data-key`; drag/wheel commits update matching inputs directly (no re-render, no focus loss).

**T267.5 — smokes** (`tools/smoke/smoke-wo267-studio-canvas-play.test.js`, curated gate)
Engine source asserts on BOTH engines: `studioReplay` exported under `isStudioMode`, no `style.margin =` shorthand remains, placement helpers exported. Studio asserts: Play prefers `studioReplay`; `scalePreview` translates+centers; overlay wiring + `data-style-key` tagging present. Pure-fn tests for the anchor/margin math (extract `placementFromDrag(stageRect, graphicRect)` as a testable function).

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, curated gate ONLY, `node --check` + repo eslint, <500 lines/file (split `public/app.js` if the overlay pushes it over), tabs + JSDoc in src/, template files match template style, honest checkboxes. Engines ship on-air — studio-only additions MUST stay behind `isStudioMode()` so playout behavior is untouched (margin fix excepted: it's a correctness fix, verified identical for the default case). Resync launcher bundle after `src/cg-studio/public` edits.

- [x] T267.1 studioReplay in both engines + Play button uses it
- [x] T267.2 margin shorthand → anchor-aware individual margins (+ major corruption repair, see log)
- [x] T267.3 scalePreview centering + wrap max-height + ResizeObserver
- [x] T267.4 drag-to-position + wheel-to-resize + inspector sync
- [x] T267.5 smokes in curated gate
- [ ] A267.1 (owner) live: canvas sits correctly in the tab (report back if still offset — T267.3 is defensive, root trigger unverified); Play replays the intro every click; dragging the graphic moves it with sensible left/center/right snapping and the inspector fields follow; wheel resizes text; exported template plays with the edited placement on air

## Work log

**2026-07-18 — implemented. Two serious latent engine bugs found and fixed along the way:**
- **`lt-engine-styles.js` was corrupted by a past mechanical rename** (the WO-120 split): DOM chains like `container.<ctx>.style.marginLeft`, `document.body.<ctx>.style.fontFamily`, element ids and even `createElement` tags had been rewritten through the context accessor — **every `applyStyles()` call in lt-engine-core threw a TypeError**, so the corner-bracket template (and anything else on engine-core) never applied styles at all. Fully repaired.
- **`lt-engine-core`'s `S.setContext({ cfg, data, style, activeStep, ... })` was a snapshot**, but `update()`/`play()` REBIND `data`/`style`/`activeStep` afterwards — the styles module worked on stale originals. Replaced with live getters.

Details:
- T267.1 `studioReplay()` in BOTH engines (studio-gated exports): normal-speed re-run of `animateIn` (self-resetting via its opening `.set()` calls), lands at state 2. Studio Play button prefers it; `play()` semantics for CG untouched. Root cause recorded in Ground truth: `studioHoldIn` leaves state 2 where `play()` no-ops — the button was dead since WO-32, not a WO-265 regression.
- T267.2 individual `marginBottom`/`marginLeft|Right` per position anchor in `lt-engine.js` and (post-repair) `lt-engine-styles.js`; center keeps auto-centering (mx ignored) instead of the shorthand silently breaking it.
- T267.3 `public/placement-math.js` (UMD: browser global + CJS for smokes) — `fitStage` (fit AND center in any box), `stageFromOverlay`, `placementFromDrag`. `scalePreview` now translates+scales from `fitStage`; `.preview-frame-wrap` capped `max-height:100%` + `overflow:hidden`; `ResizeObserver` on the wrap re-fits on workspace-pane resizes.
- T267.4 pointer-capture drag overlay above the preview iframe (iframe swallows pointer events): hit-tests the graphic via `studioGetPlacement`, live-applies rAF-throttled `studioSetPlacement` during drag, snaps anchor by center third, commits `position/marginX/marginY` into `payload.style` AND the inspector inputs (now tagged `data-field-section/key` — updated in place, no re-render). Wheel over the graphic scales title/subtitle font sizes ±5%/notch clamped to registry ranges. Hint line under the canvas.
- T267.5 `tools/smoke/smoke-wo267-studio-canvas-play.test.js` (14 tests: placement math incl. clamps, both-engine studio-gate + shorthand-gone asserts, styles-corruption-repaired asserts, live-getter asserts, app wiring) in the curated gate. Launcher cg-studio bundle resynced.
- NOTE the engine fixes ship to AIR templates (lower-thirds on playout) — margin behavior for `position:left` defaults is bit-identical; center/right with explicit margins CHANGES (from broken to correct). The styles-file repair changes corner-bracket behavior from throw-on-style to working styles. Owner should eyeball lower-thirds after deploy (A267.1).

**2026-07-18 (later) — live verification (owner: "look at cg studio issues"):**
- Headless firefox-esr screenshot of `http://127.0.0.1:4200/cg-studio/index.html` at 1495×830: preview frame renders centered and unclipped with the new fitStage math; drag hint visible. (Gallery appeared empty only because `--screenshot` fires before the async template fetch — `GET /api/cg-studio/templates` returns all 9 templates and `/studio-assets/` HTML+thumbnails serve 200.)
- Engine runtime exercised in Node with a DOM stub (scratchpad `engine-stub-test.js`): all five studio exports present after `init` under `?studio=1`; `studioGetPlacement` returns rect+anchors; `studioSetPlacement({position:'right',marginX:120,marginY:60})` yields `marginLeft:auto / marginRight:120px / marginBottom:60px` (anchor-aware fix confirmed); `studioReplay()` resolves at state 2.
- Studio UI fixes are live immediately (public/ + template/ files served no-cache from disk; no rebuild needed). The workspace-tab experience with real pointer input remains A267.1.

**2026-07-18 (round 2) — owner retest: "canvas still displays too low; play should be play in, stop play out."**
- "Too low" ROOT CAUSE finally reproduced (headless screenshot at a tall 1250×920 pane): the stage was mathematically centered — in a tall pane that puts a ~230 px dead zone above a smallish canvas, which reads as "displays too low". The centering was never broken; the LAYOUT CHOICE was wrong. Fix: `.preview-pane` top-aligns (`justify-content: flex-start`) so the stage sits directly under the toolbar; wrap width cap raised 960→1600 px so wide panes get a bigger stage. Re-screenshot confirms stage at top. (In-frame fit/centering from round 1 unchanged.)
- Buttons relabeled to match their semantics: "Play in" (studioReplay — intro) / "Play out" (engine `stop()` — outro, works from the held state, no-ops when already out). Smoke extended (16 tests). Launcher bundle resynced.
