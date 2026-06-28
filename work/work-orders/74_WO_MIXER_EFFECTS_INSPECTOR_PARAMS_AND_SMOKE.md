# Work Order 74: Mixer effects — inspector live params, AMCP smoke, catalog parity

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** Phase A–D shipped (2026-06-28) — dashboard clip effects N/A (not implemented in WO-22)  
**Priority:** **High** — effects are in the Sources browser but param edits must reliably reach Caspar on air  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [22_WO_MIXER_EFFECTS.md](./22_WO_MIXER_EFFECTS.md) — Effects tab, drag-drop, inspector editors, look-take / timeline AMCP
- [07_WO_AMCP_PROTOCOL_API.md](./07_WO_AMCP_PROTOCOL_API.md) — `/api/mixer/*` routes
- [25_WO_PIP_OVERLAY_EFFECTS.md](./25_WO_PIP_OVERLAY_EFFECTS.md) — related per-layer visual params pattern

**Smoke test (shipped in Phase A):**
- `tools/smoke/smoke-mixer-effects-catalog.test.js`
- `npm run smoke:mixer-effects`

---

## 1. Problem statement

WO-22 shipped the **Effects** tab in the Sources browser (13 draggable mixer effects) and inspector parameter editors backed by `client/lib/effect-registry.js`. Gaps remain:

| Gap | Today | Impact |
|-----|-------|--------|
| **No automated parity test** | Manual UI-only verification | Client params, REST routes, look-take lines, and timeline playback can drift (e.g. chroma key format, levels field names, grid layer) |
| **Inspector param change → AMCP** | Scene/timeline preview refresh on edit; **no guaranteed live MIXER on PGM/PRV** when tweaking effect sliders in inspector | Operators adjust chroma/crop in inspector and expect immediate on-air result |
| **Per-effect “primary” params** | All schema fields shown equally | Complex effects (levels, perspective) overwhelm the inspector; operators need curated **primary** controls per effect in looks / layers / clips |
| **Dashboard clip inspector** | WO-22 checklist mentions dashboard; verify parity with scene layer + timeline clip |

**Goal:** Every effect from the Sources browser has **tested** client→AMCP mapping, and the looks/layers/clips inspector exposes **specific, effect-appropriate parameters** that apply to Caspar immediately (preview + program) without Reset/Commit buttons.

---

## 2. Goals (normative)

### G1 — Smoke: full Sources browser effects catalog

Offline test iterates **all 13** `MIXER_EFFECTS` entries:

1. Catalog completeness (type, label, `amcpCommand`, schema, defaults via `createEffectInstance`)
2. **Line-builder parity:** `effectToAmcpLines` (client) === `buildEffectAmcpLines` (look-take) === `buildEffectAmcpLinesPlayback` (timeline)
3. **REST parity:** `POST /api/mixer/{amcpCommand}` and `POST /api/mixer/effect` capture AMCP identical to line builders (modulo optional trailing `0` duration)

Run in CI / pre-push: `npm run smoke:mixer-effects`

### G2 — Inspector: per-effect exposed parameters

Extend `effect-registry.js` with optional **`inspectorParams`** (subset of schema keys) or **`primaryParams`** flag per schema field:

```javascript
// Example
{
  type: 'chroma_key',
  schema: [
    { key: 'key', label: 'Key', type: 'select', primary: true, ... },
    { key: 'threshold', label: 'Threshold', type: 'float', primary: true, ... },
    { key: 'softness', label: 'Softness', type: 'float', primary: false, ... },
    // ...
  ],
}
```

| Surface | Behaviour |
|---------|-----------|
| **Looks (scene layers)** | Primary params visible by default; “Advanced” expands remaining schema fields |
| **Timeline clips** | Same as looks |
| **Dashboard cells** | Same pattern if `effects[]` supported on dashboard overrides |

Primary set (v1 proposal — adjust after operator feedback):

| Effect | Primary params |
|--------|----------------|
| Blend Mode | `mode` |
| Brightness / Contrast / Saturation | `value` |
| Levels | `minIn`, `maxIn`, `gamma` (advanced: `minOut`, `maxOut`) |
| Chroma Key | `key`, `threshold`, `softness` (advanced: `spill`, `blur`) |
| Crop | `left`, `top`, `right`, `bottom` |
| Clip (Mask) | `left`, `width`, `top`, `height` |
| Perspective | corner pairs collapsed to 4 inputs in advanced; primary: none (advanced-only v1) |
| Grid | `resolution` |
| Keyer | `enabled` |
| Rotation | `degrees` |
| Anchor | `x`, `y` |

### G3 — Live AMCP on inspector param change

When the operator edits an effect param in the inspector for a **selected layer/clip that is currently on preview or program**:

1. Patch project state (existing behaviour)
2. **Additionally** call `POST /api/mixer/effect` (or typed `/api/mixer/{command}`) with `{ channel, layer, effectType, params }` derived from `effectToAmcpBody`
3. Resolve `channel` / `layer` from:
   - Scene layer: preview channel + caspar layer index (same as fill/opacity mixer path)
   - Timeline clip on air: timeline playback engine layer mapping (`TIMELINE_LAYER_BASE + stack`)
4. Debounce rapid slider drags (~80 ms) — match opacity/fill inspector pattern
5. **No** `MIXER COMMIT` button; batching follows existing AMCP coalesce rules

### G4 — AMCP implementation fixes (done in Phase A)

Fixes required for smoke to pass (verify in Work Log):

- `mixerChroma`: support Client format `CHROMA key threshold softness spill blur`
- `mixerLevels`: accept `minIn`/`maxIn`/`minOut`/`maxOut` aliases from client body
- `mixerGrid`: include `channel-layer` in AMCP (not channel-only)

---

## 3. Tasks

### Phase A: Smoke + AMCP parity ✅

- [x] **T1.1** Add `tools/smoke/smoke-mixer-effects-catalog.test.js` — full catalog, line parity, REST capture
- [x] **T1.2** Add `npm run smoke:mixer-effects`
- [x] **T1.3** Fix `amcp-mixer.js` chroma / levels / grid to match `effect-registry.js` line builders
- [x] **T1.4** Fix `routes-mixer.js` grid handler to pass layer

### Phase B: Inspector primary params UI ✅

- [x] **T2.1** Add `primary` flag to `effect-registry.js` (levels, chroma, perspective)
- [x] **T2.2** Update `inspector-effects.js` — primary block + collapsible Advanced
- [x] **T2.3** Style advanced section in `06c-inspector-effects-pip.css`
- [x] **T2.4** Dashboard clip inspector — N/A (no `renderEffectsGroup` on dashboard yet; follow WO-22 if added)

### Phase C: Live AMCP from inspector edits ✅

- [x] **T3.1** Add `client/lib/effect-apply-live.js` — `scheduleLiveEffectApply` with channel/layer resolve
- [x] **T3.2** Wire `renderEffectEditor` onChange → debounced live apply (PGM look + timeline on air)
- [x] **T3.3** Preview path unchanged — `scenes-refresh-preview` on state patch; live apply skips when not on PGM
- [x] **T3.4** Timeline clip — `TIMELINE_LAYER_BASE + layerIdx` when playback position inside clip
- [ ] **T3.5** Optional live Caspar spot-check via `HIGHASCG_INTEGRATION_PORT` (manual QA)

### Phase D: Docs & index ✅

- [x] **T4.1** Update `work/wiki/WO_04_Testing_And_Smoke_Scripts.md`
- [x] **T4.2** Add row to `project_status.md`

---

## 4. Acceptance criteria

- [x] `npm run smoke:mixer-effects` passes offline — all 13 effects
- [x] Inspector shows **primary** params per effect; advanced params collapsible
- [x] Editing effect params on an on-air layer/timeline clip sends AMCP within 80 ms debounce
- [x] Look-take and timeline playback still apply full `effects[]` (regression covered by smoke line parity)
- [x] No Reset/Commit buttons added

---

## 5. Technical notes

- **Single source of truth:** `client/lib/effect-registry.js` — server line builders should stay in sync manually until a shared build step exists (out of scope)
- **Caspar pipeline order:** effect order in UI is cosmetic; tests assert per-effect command strings only
- **Chroma “None”:** sending `CHROMA None …` disables key; document in operator wiki when live apply ships

---

## Work Log

### 2026-06-28 — Phase A: smoke test + AMCP fixes

**Work Done:**
- Added `tools/smoke/smoke-mixer-effects-catalog.test.js` — catalog, client/server line parity, REST `/api/mixer/*` + `/api/mixer/effect` capture for all 13 effects
- Added `npm run smoke:mixer-effects`
- Fixed `src/caspar/amcp-mixer.js`: Client chroma format, levels field aliases, grid with channel-layer
- Fixed `src/api/routes-mixer.js`: grid route passes layer

**Instructions for Next Agent:**
- Run `npm run smoke:mixer-effects` after any effect-registry or amcp-mixer change
- Optional: live Caspar QA (T3.5) — take look to PGM, tweak chroma in inspector, confirm on-air
- Consider extracting shared effect→AMCP module to remove triplicated switch in lbg-helpers / timeline-playback-helpers / effect-registry

### 2026-06-28 — Phase B–D: inspector primary params + live AMCP

**Work Done:**
- `effect-registry.js`: `primary` flags on levels/chroma/perspective; `effectPrimarySchema` / `effectAdvancedSchema` helpers
- `inspector-effects.js`: primary params + Advanced `<details>`; live apply on param change / effect add
- `client/lib/effect-apply-live.js`: debounced PGM look + timeline-on-air MIXER via `postAmcpPreviewPipeline` + REST mirror
- Wired scene layer + timeline clip inspectors with `liveApplyContext`
- CSS for advanced effect params block
- Smoke test extended for schema partition; wiki + WO status updated

**Instructions for Next Agent:**
- Manual QA on live Caspar (T3.5) if available
- Dashboard effects inspector if product adds dashboard `effects[]` support

---
*Work Order created: 2026-06-28 | Parent: [`00_PROJECT_GOAL.md`](./00_PROJECT_GOAL.md) · Related: [`22_WO_MIXER_EFFECTS.md`](./22_WO_MIXER_EFFECTS.md)*
