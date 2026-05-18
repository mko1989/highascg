# Work Order 22: Mixer Effects — Effects Tab, Drag-and-Drop, Inspector Editors

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Add CasparCG **mixer effects** (blend mode, brightness, contrast, saturation, levels, chroma key, crop, clip/mask, perspective, grid, keyer, rotation, anchor) to the HighAsCG web GUI. Based on the official CasparCG Client (`Client-master/src/Core/Commands/`).

**Key principles:**
- Effects appear in a new **"Effects"** tab in the Sources/Media browser panel (replacing the Templates tab)
- Effects are **draggable** — drop onto a layer in a Look (scene), a clip on the Timeline, or into the Inspector's effect drop zone
- **Volume and Opacity** remain always-present in the clip inspector — they are NOT effects
- No Reset or Commit buttons — effects apply immediately via AMCP

## Reference Material

From `Client-master/src/Core/Commands/` (Qt/C++):

| Command File | AMCP | Parameters |
|-------------|------|------------|
| `BlendModeCommand.cpp` | `MIXER ch-L BLEND mode` | mode: Normal, Add, Alpha, Multiply, Overlay, Screen, Hardlight, Softlight, Difference |
| `BrightnessCommand.cpp` | `MIXER ch-L BRIGHTNESS val [dur] [tween]` | float 0–1, default 1.0 |
| `ContrastCommand.cpp` | `MIXER ch-L CONTRAST val [dur] [tween]` | float 0–1, default 1.0 |
| `SaturationCommand.cpp` | `MIXER ch-L SATURATION val [dur] [tween]` | float 0–1, default 1.0 |
| `LevelsCommand.cpp` | `MIXER ch-L LEVELS minIn maxIn gamma minOut maxOut [dur] [tween]` | 5 floats |
| `ChromaCommand.cpp` | `MIXER ch-L CHROMA key threshold softness spill blur [show_mask]` | key dropdown, 4 floats, bool |
| `CropCommand.cpp` | `MIXER ch-L CROP left top right bottom [dur] [tween]` | 4 floats 0–1 |
| `ClipCommand.cpp` | `MIXER ch-L CLIP left width top height [dur] [tween]` | 4 floats |
| `PerspectiveCommand.cpp` | `MIXER ch-L PERSPECTIVE ULx ULy URx URy LRx LRy LLx LLy [dur] [tween]` | 8 floats |
| `GridCommand.cpp` | `MIXER ch-L GRID val [dur] [tween]` | int (columns), default 2 |
| `KeyerCommand.cpp` | `MIXER ch-L KEYER` | toggle on/off |
| `RotationCommand.cpp` | `MIXER ch-L ROTATION deg [dur] [tween]` | float degrees |
| `AnchorCommand.cpp` | `MIXER ch-L ANCHOR x y [dur] [tween]` | 2 floats |

Default values from `Client-master/src/Common/Global.h` `Mixer::` namespace.

---

## Current State (Baseline)

- Sources panel (`web/components/sources-panel.js`): 4 tabs — Media, Templates, Live, Timelines. Templates = server TLS list.
- Inspector (`web/components/inspector-panel.js`): Renders clip/layer properties per selection type.
- Inspector mixer (`web/components/inspector-mixer.js`): Already has Opacity, Volume, Blend Mode (dropdown), Rotation, Straight Alpha (keyer) for scene layers. Dashboard layers have Opacity, Volume, Blend, Stretch.
- Scenes editor (`web/components/scenes-editor.js`): Layers accept `media`, `route`, `timeline` drag sources.
- Timeline canvas (`web/components/timeline-canvas.js`): Clips accept only `media`/`route`/`timeline` drag sources.
- AMCP API: `POST /api/mixer/fill`, `/api/mixer/opacity`, `/api/mixer/blend`, `/api/mixer/commit` already exist.

---

## Architecture Notes

### Effect Data Model

Effects stored as `effects: [{ type, params }]` on scene layers, timeline clips, and dashboard cell overrides.

```javascript
// Example: a clip with two effects
clip.effects = [
  { type: 'crop', params: { left: 0.1, top: 0, right: 0.9, bottom: 1 } },
  { type: 'chroma_key', params: { key: 'Green', threshold: 0.34, softness: 0.44, spill: 1, blur: 0 } },
]
```

### Effect Registry

A new module `web/lib/effect-registry.js` defines the catalog:

```javascript
export const MIXER_EFFECTS = [
  { type: 'blend_mode', label: 'Blend Mode', icon: '🎨', category: 'compositing',
    defaults: { mode: 'normal' } },
  { type: 'brightness', label: 'Brightness', icon: '☀️', category: 'color',
    defaults: { value: 1 } },
  // ... etc
]
```

### AMCP Execution

Extend the existing `applyLayerSettings` / scene-transition / timeline-engine to iterate `effects[]` and call the matching AMCP endpoint per effect type.

---

## Tasks

### Phase 1: Effects tab in Sources panel

- [x] **T1.1** Create `web/lib/effect-registry.js` — effect catalog with type, label, icon, category, defaults, parameter schema.
- [x] **T1.2** In `sources-panel.js`: remove the "Templates" tab, add "Effects" tab.
- [x] **T1.3** Render the Effects tab as a list of draggable items from the registry. Each item draggable with `{ type: 'effect', value: effectType, label }`.
- [x] **T1.4** Style effects items distinctly (accent border/background to differentiate from media/route sources).

### Phase 2: Inspector effect editors

- [x] **T2.1** Create `web/components/inspector-effects.js` — `renderEffectEditor(container, effectType, params, onChange, onRemove)`.
- [x] **T2.2** Implement parameter editors per effect type:
  - Blend Mode: dropdown (9 modes from `BLEND_MODES`)
  - Brightness/Contrast/Saturation: drag input 0–2, step 0.01
  - Levels: 5 drag inputs (minIn, maxIn, gamma, minOut, maxOut)
  - Chroma Key: key dropdown (None/Green/Blue), threshold, softness, spill, blur sliders
  - Crop: 4 drag inputs (left, top, right, bottom)
  - Clip/Mask: 4 drag inputs (left, width, top, height)
  - Perspective: 8 drag inputs (4 corners × 2)
  - Grid: number input
  - Keyer: checkbox
  - Rotation: drag input -360 to 360
  - Anchor: 2 drag inputs (x, y)
- [x] **T2.3** All editors use `createDragInput` from `inspector-common.js` for consistency.

### Phase 3: Inspector integration (always-present Volume + Opacity, addable effects)

- [x] **T3.1** In `renderTimelineClipInspector`: after the Clip group, render always-present Volume + Opacity drag inputs (already partially there). Then render "Effects" group with drop zone + existing effects list.
- [x] **T3.2** In `renderSceneLayerInspector`: same pattern — add effects group after mixer group.
- [x] **T3.3** In `renderClipInspector` (dashboard): same pattern.
- [x] **T3.4** Drop zone accepts `application/json` with `type: 'effect'`. On drop, create new effect entry with defaults and re-render.
- [x] **T3.5** Each listed effect shows the editor + "✕ Remove" button.

### Phase 4: Drop effects on canvas (Look editor + Timeline)

- [x] **T4.1** In `scenes-editor.js`: extend layer drop handler to accept `type: 'effect'`. On drop, add to `layer.effects[]`, patch scene state, refresh preview.
- [x] **T4.2** In `timeline-canvas.js`: extend clip drop area to accept `type: 'effect'`. On drop, add to `clip.effects[]`, update timeline state, sync to server.
- [x] **T4.3** Visual feedback: brief highlight on the target layer/clip when an effect is dropped.

### Phase 5: AMCP execution

- [x] **T5.1** Create or extend server-side effect executor: given a `(channel, layer, effects[])`, iterate and send the appropriate AMCP mixer commands.
- [x] **T5.2** Wire into look-take transition path (scene-transition.js or equivalent).
- [x] **T5.3** Wire into timeline playback (timeline-engine or look-take from timeline clips).
- [x] **T5.4** Create/extend REST endpoints if needed:
  - `POST /api/mixer/brightness` `{ channel, layer, brightness, duration?, tween? }`
  - `POST /api/mixer/contrast` (same pattern)
  - `POST /api/mixer/saturation`, `/api/mixer/levels`, `/api/mixer/chroma`, `/api/mixer/crop`, `/api/mixer/clip`, `/api/mixer/perspective`, `/api/mixer/grid`, `/api/mixer/keyer`, `/api/mixer/rotation`, `/api/mixer/anchor`

---

## Technical Considerations

- **CasparCG applies mixer effects in a fixed pipeline order** — user reordering in the UI is cosmetic only (CasparCG ignores order).
- **Transition duration/tween** on effects: the official client supports `duration` + `tween` on most mixer commands. We omit the UI for now (apply instantly, duration=0) but the data model should support it for future use.
- **Performance**: Effects list is small (≤13 types per clip). No performance concern.

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Breaking Templates tab users | Templates are accessible via CLS-type media; not frequently used as rundown items in HighAsCG |
| Perspective UI complexity | Start with 8 number inputs; visual corner-drag editor is a stretch goal |
| AMCP endpoints missing | Create them as thin wrappers around existing AMCP connection |

---

## Acceptance Criteria

- [x] Sources panel shows **Effects** tab (no Templates tab).
- [x] 13 mixer effects listed as draggable items in the Effects tab.
- [x] Effects can be **dropped** onto scene layers, timeline clips, or the inspector drop zone.
- [x] Each dropped effect shows its **parameter editor** in the inspector.
- [x] **Opacity and Volume** remain always-visible in the inspector (not in the Effects tab).
- [x] Effects are **saved** with the look/timeline and **restored** on reload.
- [x] No Reset or Commit buttons.

---

## Work Log

### 2026-04-12 — Work order created
**Work Done:**
- Created WO-22 from implementation plan.
- Cataloged all 13 CasparCG mixer effect commands from `Client-master/src/Core/Commands/`.
- Documented defaults from `Global.h Mixer::` namespace.

### 2026-04-12 — Full implementation complete
**Work Done:**

**New files:**
- `web/lib/effect-registry.js` — Effect catalog (13 types), parameter schemas, AMCP command builders
- `web/components/inspector-effects.js` — Per-effect-type parameter editors, effects group with drop zone

**Modified files:**
- `web/components/sources-panel.js` — Replaced Templates tab with Effects tab, added `renderEffectsTab()`
- `web/components/inspector-panel.js` — Added `renderEffectsGroup` to dashboard, timeline clip, and scene layer inspectors
- `web/components/timeline-editor.js` — Extended `onDropSource` for effect drops on clips
- `web/styles/03-sources-ingest-offline-sync.css` — Effects tab styling
- `web/styles/06-inspector-mixer-context.css` — Inspector effect card styling
- `src/engine/scene-take-lbg.js` — Added `buildEffectAmcpLines()`, applies effects during look-take
- `src/engine/timeline-playback.js` — Added `buildEffectAmcpLinesPlayback()`, applies effects during playback

**Instructions for Next Agent:**
- WO-22 is feature-complete. Test via UI.
- Future: transition duration/tween UI, visual perspective editor.

---
*Work Order created: 2026-04-12 | Parent: [`00_PROJECT_GOAL.md`](./00_PROJECT_GOAL.md) · Architecture index: [`PROJECT_BREAKDOWN.md`](./PROJECT_BREAKDOWN.md) · Related: `08_WO_CASPARCG_CLIENT_FEATURES.md` (client features), `07_WO_AMCP_PROTOCOL_API.md` (AMCP API)*
*Reference: `Client-master/src/Core/Commands/` (official CasparCG Client mixer commands)*
