# Work order: Look presets & layer presets (screen-management programming)

## Purpose

Add a **screen-management** style programming workflow (similar in spirit to **PixelHue**, **Analog Way**, **Barco** show controllers): operators save **stills of the output state** and recall them to **preview** or **program** with optional **auto-take**, without always working from the look deck only.

The **right-hand panel** (today: Inspector) becomes **mode-switchable**: **Inspector** | **Look presets** | **Layer presets** (exact control: pill tabs, segmented control, or small dropdown in the panel header—implementation detail).

---

## 1. Existing code to build on

| Area | Today | Reuse for presets |
|------|--------|-------------------|
| **Looks / scenes** | `sceneState.scenes`, `mainScope`, per-main deck (`web/lib/scene-state.js`, `web/components/scene-list.js`) | Look preset is **not** always the same as a deck “look” card—it is a **named snapshot** that may be bound to one or more mains and capture **live** or **staged** state. |
| **Layer style clipboard** | `copyLayerStyle` / `pasteLayerStyle` / `_layerStyleClipboard` in `scene-state.js` | **Layer presets** = formalize as **named, persisted** records instead of a single volatile clipboard. |
| **Copy/paste** | Scene layer inspector, selection sync | Wiring “Save as layer preset” from the current layer selection. |
| **Take / play** | `createTakeSceneToProgram`, AMCP to PGM/PRV, transitions | **Recall to PGM auto-take** = `LOADBG` + standard transition + `PLAY` (same as today’s look take with transition). |
| **Multiview** | Slots 1–4 in `multiview-state` / `multiview-editor.js` (localStorage) | Pattern reference for **save slot / recall** UX only; look/layer preset storage should be **unified** (project + optional local), not a fourth ad-hoc slot system. |

**Note:** **Previs** camera presets and **3D** presets are a different product surface; do not conflate in this WO.

---

## 2. UX — right panel

- **Default**: Inspector (current behavior).
- **Look presets** tab: list/grid of named presets, **Save** and **Recall** areas, filter by main where useful.
- **Layer presets** tab: list of named layer presets, **Save from current layer**, **Apply to selected layer** (replaces ad-hoc paste-only flow over time; keep paste as shortcut if desired).

**Persistence**: look preset library and layer preset library should be part of **project export** (`web/lib/project-state.js` envelope) and have sensible defaults in `localStorage` for offline, aligned with how scenes are handled.

---

## 3. Look presets — requirements

### 3.1 Selection of mains (save & recall)

- If **one main** is selected in the app (blue output target / `activeScreenIndex`), a saved look preset is tagged with that main (or `mainScope` equivalent).
- If **two (or more) mains are “selected”** for the operation, metadata must **reflect all selected mains** (e.g. `targetMains: [0,1]` or a bitmask).  
  - *Product clarification needed:* whether “two selected” means **the same pixel-for-pixel scene applied to both outputs** (one snapshot, two playbacks) or **two captured states** in one macro—default assumption: **one saved snapshot** with **list of target mains** for recall.

### 3.2 Save sources — PGM and PRV

- **Save from PGM** (current program bus): capture state from the **program channel** (and relevant layers) for the selected main(s), including **scene id** if known, else **raster snapshot / layer dump** as today’s take pipeline can supply.
- **Save from PRV** (preview bus): same, but from **preview channel** for the selected main(s).

Implementation must use existing **channel map** (`programChannels` / `previewChannels` per `activeScreenIndex`) and AMCP/OSC where the server already exposes state (`live` scene, layer stacks).

### 3.3 Recall targets

- **Recall to PRV**: load the preset into the **preview** path only (analog: “preview preset”).
- **Recall to PGM** (cut / direct): load to **program** (define whether this implies hard cut or existing “cut” API).
- **Recall to PGM with auto-take** (a.k.a. “Take” with transition): apply the **look’s standard transition** (and mixer commit rules) as in current **Take** from preview—i.e. same semantics as `takeSceneToProgram` when the preset maps to a **scene**; if the preset is **AMCP-only** (no `scene` id), define equivalent (e.g. `LOADBG` + `PLAY` with transition duration from preset metadata).

*Edge case:* Preset created from **PGM** recall to **PRV** should be supported (common in shows: grab live, work on PRV, then take).

### 3.4 Data model (sketch)

```text
lookPreset: {
  id, name, createdAt,
  targetMains: number[],           // which mains this preset targets (from UI selection)
  sourceBus: 'pgm' | 'prv',       // where it was saved from
  // Either:
  sceneSnapshot?: Scene,            // if we can round-trip through scene format
  // and/or for robustness:
  amcpRecipe?: { ... }              // optional explicit commands (future)
}
```

Integrate with existing **`mainScope`** on real looks where a preset is “also a look”—optional stretch goal; v1 can keep **look presets** as a **separate list** in project JSON (version bump or additive fields).

---

## 4. Layer presets — requirements

- **Refactor** the “we already have the logic” path: `copyLayerStyle` / `pasteLayerStyle` and inspector-driven layer state → **first-class objects** in a **`layerPresets[]`** (or similar) store with:
  - `id`, `name`, `fill`, `opacity`, PIP, `audioRoute`, `contentFit`, `pipOverlays`, etc. (match what `copyLayerStyle` already serializes).
- **Optional:** tag with **main** or **output** if layer numbering differs by main (only if product requires).

**UI:** Layer preset panel lists presets; **Apply** = today’s “paste” onto selected layer; **Save** = from current `sceneLayer` or dashboard layer selection, depending on context.

---

## 5. Engineering phases

| Phase | Scope |
|--------|--------|
| **A** | Right panel: tab strip + empty shells for “Look presets” / “Layer presets” without breaking Inspector. |
| **B** | `layerPresets` state + persistence + project export/import; wire Save/Apply from layer inspector; keep clipboard as duplicate path or remove later. |
| **C** | Look preset: capture from PRV/PGM (server may need a small `POST` that snapshots `scene` + `live` for channel X); storage model + list UI. |
| **D** | Recall: PRV / PGM / PGM+transition; unify with `takeSceneToProgram` and `sendSceneToPreviewCard` where the preset references a `scene` id. |
| **E** | Multi-main selection for save/recall; QA matrix (1 main, 2 mains, global looks, `mainScope`). |

---

## 6. Open questions (resolve before or during implementation)

- Should a **look preset** always create/update a **deck “Look”** row, or stay a **parallel list**? (Parallel list is lower risk; linking optional.)
- For **non-scene** captures (e.g. route-only), minimum viable = still store **JSON scene**-compatible payload when `scene` is known, else **document limitation** in v1.
- **Permission / Companion**: should presets be in **GET /api/state** for hardware panels—same as `scene_deck_sync` follow-up.

---

*Version: 1.0 — addendum to per-main / global looks work.*
