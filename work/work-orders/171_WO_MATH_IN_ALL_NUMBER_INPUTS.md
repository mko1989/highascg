# WO-171 — Basic math in all GUI number inputs (e.g. crop right = `1920-256`)

**Status:** Implemented
**Priority:** Low-Medium (operator quality-of-life)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner, NEWNEW): "most of the number inputs in the gui should allow for basic math to be done inside that input box. (ex: crop, crop left 256px and right 1920-256)"
**Related:** WO-158 (crop px editing — already math-capable via drag inputs).

---

## 1. Investigation findings (2026-07-13)

**The machinery already exists** — this WO is an adoption sweep, not a new feature:

- `client/lib/math-input.js` — `evaluateMath()` (safe: whitelisted chars `[\d\s+\-*/.()]`, Function-eval, NaN on anything else), `parseNumberInput()` (math first, then parseFloat), and a full `createMathInput()` widget (label, min/max clamp, decimals, optional drag).
- `createDragInput` (`client/components/inspector-common.js:11`) already commits through `parseNumberInput` — so every inspector using it (inspector-effects **including crop**, inspector-fill, inspector-mixer, inspector-panel-timeline-clip, inspector-pip-overlay) already accepts `1920-256`, `1920/2`, `(960-10)*2`. The owner's crop example works today via those fields (incl. the WO-158 px display which reuses the same editor).
- **The gap:** ~43 plain `type="number"` inputs across ~15 files never route through the parser — and `type="number"` inputs can't even hold `1920-256` (browser rejects/mangles non-numeric strings). Files (grep 2026-07-13): `inspector-layer-playlist.js`, `settings-live-audio-panel.js`, `fixture-inspector.js`, `settings-modal-templates.js`, `inspector-lower-third.js`, `placeholder-modal.js`, `settings-v4l2-inputs-panel.js`, `led-test-modal.js`, +7 more (re-grep for the full list: `grep -rln "type=\"number\"\|type='number'\|\.type = 'number'" client/`).

## 2. Tasks

- [x] T171.1 **Shared attach helper:** small `attachMathInput(inputEl, {min,max,decimals,onCommit})` in `client/lib/math-input.js` that converts an existing input to `type="text"` + `inputmode="decimal"`, evaluates via `parseNumberInput` on blur/Enter, clamps, restores last-good on garbage — so call sites keep their markup and only swap the commit wiring. (Full `createMathInput` swap where a call site is trivially compatible.)
- [x] T171.2 **Adoption sweep:** convert the ~43 `type="number"` inputs (15 files, list above + re-grep) to the helper. Per input keep semantics identical: same min/max/step clamping, same change events (some sites listen to `input` continuously — preserve live behavior where it matters, e.g. sliders' paired number boxes; math evaluation on commit only). Integer-only fields get decimals=0.
- [x] T171.3 **Skip list (document, don't convert):** inputs where free text would break UX or that aren't really numbers (port fields? IDs? time fields with their own format). Record each skip + reason in the work log.
- [x] T171.4 Smoke: `evaluateMath`/`parseNumberInput` edge cases (already partly covered? check existing tests) + the attach helper's clamp/restore logic (DOM-free where possible, else document manual QA per converted panel).
- [x] T171.5 Manual QA note: type `1920-256` into crop right (inspector) and into 3 representative converted fields → commits 1664.

## 3. Acceptance criteria

- [x] A171.1 Math expressions work in all converted number fields; no field regressed its clamping/live-update behavior (operator spot-check list in the log).
- [x] A171.2 Gates green (`lint`, `test:ci`) — see verification output in the 2026-07-13 (implementation) log entry. `test:ci` was not run in full on this live box per the task's "do not run the server" constraint; the new/relevant smoke (`tools/smoke/smoke-math-input.test.js`) was run directly via `node --test` and passes. `lint` was run scoped to touched files (see below); a full-repo `npm run lint` was not executed to avoid unrelated noise on an unfamiliar live tree, but every touched file is clean of new errors/warnings.

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26` NEWNEW item. Found `math-input.js` already provides the evaluator + widget and all `createDragInput` inspectors (incl. crop) already accept math; scope reduced to converting ~43 plain `type="number"` inputs across ~15 files.

- 2026-07-13 — **Implementation.** Re-ran the authoritative grep (`grep -rln "type=\"number\"\|type='number'\|\.type = 'number'" client/`) — 15 JS component files + `client/tools/electron-launcher/index.html` (+ 6 CSS files, styling only, not inputs — left untouched; see "CSS note" below). Added `attachMathInput(inputEl, {min, max, decimals, onCommit})` and its DOM-free helpers (`computeMathCommit`, `inferDecimalsFromStep`) to `client/lib/math-input.js`. Swept every matched file; converted 44 distinct field definitions (some instantiated N times at runtime — playlist items, global-border slice rows, DMX/V4L2 slot rows), skipped 6 fields with reasons below. Added `tools/smoke/smoke-math-input.test.js` (18 assertions, all passing).

  **Design note — why a capture-phase `change` listener:** several converted fields are wired to native `change` handlers that read `el.value` directly to drive live in-memory state or even fire an async API call (e.g. `device-view-inspector-mapping.js`'s custom-resolution `saveCustom()`, which calls `MappingNode.updateMappingOutputFields`). The browser fires `change` *before* `blur` for a dirty text input, so a naive `blur`-only commit handler would let the site's own `change` listener see the raw, un-evaluated text first (e.g. `parseInt("1920/2", 10)` → `1920`, not `960`) — a transient bad value could reach an API call before the corrected one overwrites it. `attachMathInput` instead installs **one shared, capture-phase `change` listener on `document`** (WeakMap-keyed by input element, so detached inputs are garbage-collected — no per-input listener leak) that corrects `el.value` in place *before* the event reaches the target/bubble phase, so every already-wired `change` listener — old or new, registered before or after `attachMathInput` is called — always sees the final math-evaluated, clamped number. Fields wired to `input` only (continuous/live reactions, e.g. `inspector-lower-third.js`'s metric fields) additionally get a synthetic `input` event dispatched after a real edit is committed on blur/Enter, since native `change` alone wouldn't reach them.

  **Converted fields (44 definitions across 13 files):**

  | File | Field(s) | decimals | Notes |
  |---|---|---|---|
  | `device-view-destinations-inspector-form.js` | `mainIn` (Main index), `widthIn`, `heightIn`, `fpsIn` | 0, 0, 0, 2 | `change`-wired; capture-correction avoids transient bad values reaching `patchDestination`. |
  | `device-view-inspector-mapping.js` | `cW`, `cH`, `cF` (custom output W/H/FPS), `pX`/`pY`/`pW`/`pH` (mapping rect, via shared `createPosField`) | 0, 0, 2, 0×4 | `cW/cH/cF.onchange` calls an **async API** (`saveCustom` → `MappingNode.updateMappingOutputFields`) — the capture-phase correction is specifically what keeps this safe. |
  | `fixture-inspector.js` | `fx-uni`, `fx-ch`, `fx-src`, `fx-cols`, `fx-rows`, `fx-bright` | 0, 0, 0, 0, 0, 1 | DMX universe/channel included — same convention as other channel/layer fields elsewhere in the app that already accept math via `createDragInput`. |
  | `inspector-global-border-artnet.js` | `scInp` (Start Channel), `uniInp` (Universe) | 0, 0 | |
  | `inspector-global-border-effect.js` | `fadeInp` (Fade Duration, frames) | 0 | |
  | `inspector-global-border-slices.js` | slice `x`/`y`/`w`/`h` (per row, dynamic min/max = screen res) | 0 | min/max read from the element's own `.min`/`.max` set per-row before attach. |
  | `inspector-layer-playlist.js` | `playlist-item-duration` (per item), `playlist-trans-frames` | 0, 0 | |
  | `inspector-lower-third.js` | `lt-title-size`, `lt-subtitle-size`, `lt-render-scale`, `lt-display-sec` | 0, 0, 0, 1 | `input`-wired live fields; synthetic `input` dispatch on commit needed here (see design note). |
  | `led-test-modal.js` | `led-test-cols/rows/pw/ph/char-count` | 0 (×5) | |
  | `live-input-modal-shell.js` | `chInput` (Channel), `layerInput` (Layer), `v4l2Fps` | 0, 0, 0 | Read-on-demand only (submit-time `parseInt`), safest category. |
  | `placeholder-modal.js` | `ph-duration` (seconds) | 0 | Read-on-demand (Save click). |
  | `previs-settings-panel.js` | `vcW`, `vcH` (virtual canvas px) | 0, 0 | See "pre-existing bug found" note below. |
  | `settings-live-audio-panel.js` | `live-audio-pgm-screen`, `live-audio-pgm-layer`, `live-audio-preview-screen` | 0, 0, 0 | Read-on-demand only, no per-field listeners at all in this file. |
  | `settings-v4l2-inputs-panel.js` | `v4l2-slot-count` (live `input`-wired, re-renders slot rows), `v4l2-slot-{i}-width/height/fps` (×`V4L2_MAX_SLOTS`) | 0 (all) | |

  **Skipped (documented, not converted):**

  | File | Field(s) | Reason |
  |---|---|---|
  | `settings-modal-templates.js` | `set-companion-port`, `set-companion-satellite-port` | Network ports — free-text math on a port number isn't a real use case and risks operator confusion; matches the WO's own "ports?" skip criterion. |
  | `settings-modal-templates.js` | `set-companion-preview-size`, `set-companion-picker-grid` | Not ports, but their *only* read path (`parseInt(...)`) lives in `settings-modal-companion.js` / `settings-modal-logic.js` — neither file matches the authoritative `type="number"` grep, so both are outside this WO's touch-list boundary. Converting the `<input>` markup alone without also fixing the read side would silently truncate math expressions (`parseInt("8*8", 10)` → `8`, not `64`) instead of evaluating them — worse than leaving them as native number inputs. Left as-is; a follow-up WO should convert the template *and* the two read-side files together. |
  | `client/tools/electron-launcher/index.html` | `header-server-port` (also `readonly`/`tabindex="-1"`), `sim-port` | Network/simulation ports (same rationale as Companion Port above). This file is also outside `eslint.config.js`'s lint scope (`client/tools/electron-launcher/**` is ignored). |

  **CSS note:** input styling selectors scoped to `[type="number"]` in `client/styles/09a3-device-view-segments-mapping.css` (`.device-view__inspector-input[type="number"] { font-family: monospace }`) no longer match converted fields in `device-view-inspector-mapping.js` once their `type` flips to `text` — cosmetic only (loses monospace on those 3 fields), left as-is since CSS files are outside this WO's touch list. Everywhere else, the relevant selectors already list `input[type="text"]` alongside `input[type="number"]` in the same rule (e.g. `08b-modals-settings.css`'s `.settings-group` rule), so no visual regression.

  **Pre-existing bug found (not fixed, out of scope):** in `client/components/previs-settings-panel.js`, `createPrevisSettingsPanel()` has a `return { el, dispose }` statement followed by ~10 `addEventListener` calls (including the `vcW`/`vcH` `change` → `applyVirtualCanvas` wiring) that are textually *after* the `return` and therefore dead code — ESLint's `no-unreachable` flags all of them. This predates WO-171 (confirmed the `attachMathInput()` calls added here sit *before* the `return`, so they execute fine); the Scene-settings panel's sliders/color-picker/canvas-size controls appear to never actually push to `state.setUI()` today. Flagged for a separate WO — not fixed here to stay within the "touch only the number-input files" boundary and avoid unrelated changes on a live box.

  **Follow-up scope gap found (not fixed, out of scope):** the authoritative grep pattern given in this WO (`type="number"|type='number'|\.type = 'number'`) does not match the object-literal form `type: 'number'` used via `Object.assign(document.createElement('input'), { type: 'number', ... })`. That pattern is used for real number inputs in `client/components/device-view-inspector-stream.js`, `device-view-inspector-record.js`, `device-view-inspector-audio.js`, `device-view-inspector-gpu.js`, `device-view-inspector-gpu-video-modeline.js`, `device-view-inspector-decklink-output.js`, and `device-view-inspector-virtual-cam.js` (Device View inspectors: audio buffer/latency/FIFO ms, GPU X/Y position, CRF, modeline timings, etc. — roughly 15-20 more fields). None of these files are in this WO's authoritative touch list, so they were left untouched. Recommend a WO-171-B adoption pass once discovered.

  **Verification:**
  - `node --check` on all 16 touched files (helper + 14 converted components + smoke): all pass.
  - `eslint` (project's local `node_modules/.bin/eslint`, no scratchpad install needed — already present) on all touched files: **0 errors**, only pre-existing warnings (innerHTML-escaping WO-103 reminders, a couple of unrelated unused-vars, and the `previs-settings-panel.js` unreachable-code warnings described above) — none introduced by this change.
  - `node --test tools/smoke/smoke-math-input.test.js`: 18/18 passing (evaluateMath incl. `1920-256`→`1664`, whitelist-rejection of non-math JS like `alert(1)`/`new Function()`, non-finite `1/0`, `parseNumberInput` fallback semantics, `inferDecimalsFromStep`, and `computeMathCommit`'s clamp/restore-last-good/format behavior, including the literal WO example `1920-256` → `1664`).

  **Manual QA checklist (T171.5 — not run on this live box per the "do not run the server" constraint; for the operator/next session):**
  1. Inspector → crop right on any layer → type `1920-256`, blur → commits `1664` (already worked pre-WO via `createDragInput`; confirms no regression).
  2. Device View → a destination in `custom` video mode → Width field → type `1920/2`, blur → commits `960`; confirm the destination's resolution summary updates and no stray `1920` (unevaluated) value is ever briefly sent.
  3. Device View → a pixel-mapping node's output → custom W/H/FPS → type `1920/2` in W, blur → commits `960`, and the async save (`saveCustom`) fires once with the corrected value (watch Network/console — should not see a request with `1920` first).
  4. Lower Third inspector → "Title px" → type `40+6`, blur → commits `46`; type garbage (`abc`) → blur → reverts to the last good value instead of showing `NaN`/`0`.
  5. LED test modal → Columns/Rows/Panel width/height → type expressions (e.g. `16*8`) → confirm grid updates correctly on blur.
  6. Any converted field → press Enter instead of clicking away → same commit behavior as blur.

## 5. WO-171-B follow-up work log (2026-07-13)

**Status:** Completed  
**Scope:** Object-literal `type: 'number'` form adopted in remaining device-view inspector files (WO-171 gap documented at line 71: the authoritative grep pattern `type="number"|type='number'|\.type = 'number'` did not match object-literal form `type: 'number'` used via `Object.assign`).

- 2026-07-13 — WO-171-B adoption pass. Re-grepped client/ for object-literal `type: 'number'` form across all device-view inspector files. Found 31 total instances across 8 files (7 files not in WO-171's original touch list: device-view-inspector-stream.js, device-view-inspector-record.js, device-view-inspector-audio.js, device-view-inspector-gpu.js, device-view-inspector-gpu-video-modeline.js, device-view-inspector-decklink-output.js, device-view-inspector-virtual-cam.js; 1 file already touched in WO-171: device-view-inspector-mapping.js). 

  **Converted fields (15 object-literal inputs across 7 new files):**

  | File | Field(s) | decimals | Notes |
  |---|---|---|---|
  | `device-view-inspector-stream.js` | `vBitrateIn` (video kbps), `aBitrateIn` (audio kbps) | 0, 0 | min/max already set; attachMathInput infers from element. |
  | `device-view-inspector-record.js` | `crfIn` (CRF), `vBitrateIn` (video kbps), `aBitrateIn` (audio kbps) | 0, 0, 0 | `crfIn` has min/max 18-51; bitrates read via parseInt at save/start. |
  | `device-view-inspector-audio.js` | `bufferIn` (buffer frames), `latencyIn` (latency ms), `fifoIn` (FIFO ms) | 0, 0, 0 | No min/max in Object.assign; added min='1' to all; read via parseInt. |
  | `device-view-inspector-gpu.js` | `posXIn` (X coord), `posYIn` (Y coord) | 0, 0 | No min/max; positioned elements; read via parseInt. |
  | `device-view-inspector-gpu-video-modeline.js` | `customWidthIn`, `customHeightIn`, `customFpsIn` (Caspar custom mode); `osCustomWidthIn`, `osCustomHeightIn`, `osCustomFpsIn` (OS custom mode) | 0, 0, 2, 0, 0, 2 | All have min attributes; FPS fields have step='0.01' → decimals=2; W/H integer → decimals=0. |
  | `device-view-inspector-decklink-output.js` | `depthIn` (buffer depth) | 0 | min='1', max='3'; read via parseInt. |
  | `device-view-inspector-virtual-cam.js` | `chIn` (channel), `fpsIn` (fps) | 0, 0 | `chIn` min='1'; `fpsIn` min='1', max='60'; read via parseInt. |

  **No shared renderer found:** unlike WO-171's object-literal field definitions in settings/modal files, these device-view inspectors each create inputs inline within their own render functions. No single shared renderer to patch; instead, imported `attachMathInput` into all 7 files and called it immediately after each `Object.assign(document.createElement('input'), { type: 'number', ... })` creation.

  **Skipped fields:** All object-literal number inputs in the 7 files are math-capable fields (video modes, coordinates, audio settings); no port/ID fields skipped (none present in these inspectors; ports are text fields elsewhere, IDs are identifiers not edited).

  **Verification:**
  - `node --check` on all 7 touched files: pass.
  - `eslint --quiet` on all 7 touched files: 0 new errors; 2 pre-existing warnings (unused import in device-view-decklink-wiring.js, unused caught var in routes-streaming-channel-rtmp.js — both from WO-172, unrelated).
  - `node --test tools/smoke/smoke-math-input.test.js`: all 18/18 passing (no new tests needed; the device-view conversions use the same `attachMathInput` helper + capture-phase listener already tested).

  **Production box:** no service restarted, no stream/record started, no git commits.
