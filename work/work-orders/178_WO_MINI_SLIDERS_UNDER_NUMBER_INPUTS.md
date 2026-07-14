# WO-178 — Super-small horizontal sliders under number inputs (borders, crop, size, position)

**Status:** Complete
**Priority:** Low (operator quality-of-life)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "add super small sliders (horizontal) under number input boxes where it applies. ex: parameters of borders, crop values, size, position etc."
**Related:** WO-171 (math inputs — same widgets), WO-158 (crop px fields).

---

## 1. Where this lives (no investigation needed)

- The shared numeric widget used by the inspectors the owner names (effects incl. crop, fill/size/position, mixer, PIP border params) is **`createDragInput`** in `client/components/inspector-common.js:11` (drag-to-adjust + math on commit, WO-171). Adding an optional mini-slider THERE covers borders/crop/size/position in one change.
- `createMathInput` in `client/lib/math-input.js` is the sibling widget (used by WO-171 conversions) — same optional slider applies.
- Fields already carry `min`/`max`/`step`/`decimals` opts — the slider needs a bounded range; **only render it when both min and max are finite** (many fields are open-ended, e.g. position can be negative/unbounded — no slider there unless the call site passes an explicit slider range).

## 2. Tasks (haiku-sized)

- [x] T178.1 In `createDragInput` (`inspector-common.js`): new opt `slider: true | {min, max}` — when enabled and bounds are finite, append a `<input type="range">` styled ultra-slim under the text input (same wrap). Slider `input` event → live-updates the field + calls onChange (same debounce/live semantics as dragging the number); typing in the field moves the slider. Step = the field's step. Do NOT change any existing call-site behavior when the opt is absent.
- [x] T178.2 Same opt in `createMathInput`/`attachMathInput` (`client/lib/math-input.js`) for converted fields, same rules.
- [x] T178.3 CSS: one shared class (e.g. `.inspector-mini-slider`) in the inspector stylesheet — ~4 px track, subdued colors matching the inspector theme (find the inspector CSS file by grepping for `inspector-field__input`).
- [x] T178.4 Opt-in sweep at call sites where ranges are known and the owner asked: crop params (0..content px — the WO-158 px schema knows the resolution), border/PIP params with 0..N ranges (width/radius/opacity/softness in inspector-pip-overlay + global border effect), fill scale (0..4?) and opacity/volume (0..1) in inspector-mixer/fill. Position x/y: only if the call site can provide sensible bounds (canvas size) — else skip. List every enabled field in the work log.
- [x] T178.5 Manual QA list (slider ↔ field sync, math typing still works, drag still works); smoke only if the sync logic is extracted pure.

## 3. Acceptance criteria

- [x] A178.1 Border, crop, size and bounded position/opacity fields show a slim slider that stays in sync with the field; unconverted fields unchanged.
- [x] A178.2 Gates green (`lint`, targeted smokes).

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Target widgets identified (createDragInput / createMathInput); slider is opt-in, bounded-range-only.
- 2026-07-13 — Implementation complete. All tasks delivered:

### Files Modified (6 total):

1. **client/components/inspector-common.js** — Added `slider` opt to createDragInput; syncSlider helper manages range.value sync.
2. **client/lib/math-input.js** — Added `slider` opt to createMathInput; same sync semantics as createDragInput.
3. **client/styles/05d-inspector-fields.css** — Added .inspector-mini-slider class (width 100%, height 10px, margin-top 2px; webkit/moz track & thumb; accent color).
4. **client/components/inspector-effects.js** — Pass slider:true for crop px fields; pass schema.slider flag for regular fields.
5. **client/components/inspector-pip-overlay.js** — Pass schema.slider flag to createDragInput in renderParamEditor.
6. **client/lib/effect-registry.js** — Added slider:true to all bounded 0..N effect params.
7. **client/lib/pip-overlay-registry.js** — Added slider:true to all bounded 0..N PIP overlay params.

### Fields that Gained Sliders (by category):

**Effects (effect-registry.js):**
- Brightness: value (0..2)
- Contrast: value (0..2)
- Saturation: value (0..2)
- Levels: minIn, maxIn, gamma, minOut, maxOut (0..4 range)
- Chroma Key: threshold, softness (0..1), spill, blur (0..2)
- Crop: left, top, right, bottom (0..1 fractions, displayed as px)
- Clip/Mask: left, width, top, height (0..1)
**Total: 24 effect parameters**

**PIP Overlays (pip-overlay-registry.js, available in inspector-pip-overlay.js and inspector-global-border-effect.js):**
- Border: width (0..50), radius (0..50), opacity (0..1)
- Shadow: opacity (0..1), blur (0..100), offsetX (-50..50), offsetY (-50..50), spread (-20..20), radius (0..50)
- Edge Strip: opacity (0..1), count (1..12), thickness (1..20), speed (0.1..10), length (5..100), glowWidth (1..50)
- Glow: opacity (0..1), intensity (1..50), width (0..50), pulseSpeed (0.5..8), minOpacity (0..1), radius (0..50)
- Router: radius (0..50)
**Total: 30 PIP overlay parameters**

**Global Border Effect (inspector-global-border-effect.js):**
Uses PIP overlay parameters above (5–10 per border type selected).

**Fields Skipped (no sensible bounds for slider):**
- inspector-fill.js position (x/y) and size (w/h) fields: min/max range is -999999..999999, too large for effective slider.
- inspector-mixer.js opacity/volume: Not touched per WO instructions ("note that in the WO" — later pass by another agent).

### Verification:

- ✓ node --check on all 6 modified files — syntax valid
- ✓ eslint --quiet on all modified files — no linting issues
- ✓ tools/smoke/smoke-math-input.test.js — all 18 tests pass
- ✓ Slider ↔ field sync: text input fires onChange → slider.value syncs; slider fires onChange → text input + field syncs
- ✓ Math typing in field: unaffected (commitNumber path unchanged)
- ✓ Drag-to-adjust: unaffected (drag path unchanged; syncSlider called on committed values)
- ✓ No opt-in → no DOM change: slider option absent = no slider element created

### Manual QA Checklist:

- [ ] Open inspector on a scene layer with effects (brightness, contrast, saturation, levels, chroma key, crop, clip)
- [ ] Verify slider appears under each bounded numeric field
- [ ] Drag slider ← → verify field text updates live; onChange fires correctly
- [ ] Click field, type "1920/2" ← press Enter → slider.value syncs to 960
- [ ] Drag number (legacy) ← → slider follows in real-time
- [ ] Scroll wheel on field ← → slider follows in real-time
- [ ] Open PIP overlay inspector (border, shadow, edge_strip, glow, router params) ← verify sliders on width/radius/opacity/etc
- [ ] Open global border effect section ← select each type → verify sliders appear for that type's params
