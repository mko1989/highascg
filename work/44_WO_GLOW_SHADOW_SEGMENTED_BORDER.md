# WO-44 — Segmented glow & shadow borders (per-edge splits + ease toward cuts)

**Status:** Draft work order (not implemented)  
**Scope:** Caspar HTML templates `template/pip_glow.html`, `template/pip_shadow.html`; inspector schema `web/lib/pip-overlay-registry.js`; merged CG defaults `src/engine/pip-overlay-utils.js` (`PIP_OVERLAY_PARAM_DEFAULTS`); global border + PIP overlay AMCP/CG JSON paths (same templates).  
**Related:** WO-09 / WO-25 (PIP overlays), WO-43 (global border dual-layer / PGM stack).  
**Note:** `pip_glow.html` today contains an experimental `segmentation` numeric field driving a **repeating conic-gradient mask** on the single `#pip-frame` — **not** the geometry described below. This WO supersedes or refactors that approach after design sign-off.

---

## 1. Objective

Add a **segmentation mode** for **glow** and **drop shadow** overlays so operators can break the continuous frame effect into **discontinuous segments** with **visual taper** (ease) toward cut lines: lower effective **thickness / blur / intensity / opacity** (and shadow offset contribution where applicable) near each cut, so the effect reads as “split” rather than a single uniform ring.

Applies to:

- **PIP** glow/shadow on layer overlays (existing `inner` rect semantics).
- **Global border** on full-frame `inner` (same templates, WO-09 path).

---

## 2. Operator-facing modes (product spec)

Interpretation is **per logical edge** of the `inner` rectangle (top, right, bottom, left), unless noted otherwise. Cuts are **gaps or attenuation zones** in the effect, not necessarily transparent holes in video — exact visual (hard gap vs soft fade) is an implementation choice documented in §4.

### Mode 1 — `full` (default)

- **One** continuous effect **exactly** as today: single `box-shadow` (shadow) or single glow stack on `#pip-frame` (or equivalent).
- No extra cuts; no segmentation taper.

### Mode 2 — `bisect` (working name) — **preset: N = 2**

Same as **uniform segmentation with `segmentsPerEdge = 2`** (two equal parts per side, one mid-cut per edge; cross layout at center — see geometry note below).

### Mode 3 — `thirds` (working name) — **preset: N = 3**

Same as **uniform segmentation with `segmentsPerEdge = 3`** (three equal parts per side, two internal cuts per edge).

### Mode 4+ — **uniform N** (general case)

- **Arbitrary integer `segmentsPerEdge = N`** with **1 ≤ N ≤ 32** (hard cap; optional soft clamp §5.1).
- **Cross / corner policy** for N=2 remains as in original mode-2 spec; for **odd N > 1** center cuts align predictably; document corner taper overlap for all N.

**Ease requirement:** unchanged — taper toward **each** internal cut along the edge.

---

## 3. Schematic (ASCII)

**Mode 1 — full**

```
+--------------------------------+
|████████████████████████████████|  ← continuous glow/shadow
|██                            ██|
|██                            ██|
|████████████████████████████████|
+--------------------------------+
```

**Mode 2 — bisect (cross; taper at bold lines)**

```
+--------------------------------+
|██████████|        |██████████|
|█████                        █████|
|    ← H mid →          |
|█████                        █████|
|██████████|        |██████████|
+--------------------------------+
        ↑ V mid
```

(Actual mock should show taper fading near `|` lines; corners may need extra diagonal policy — see §2.)

**Mode 3 — thirds (per edge, example top side only)**

```
+--|--------|--------|--------+
   cut1    cut2    (3 equal runs along top)
```

Repeat analogously for right, bottom, left.

---

## 4. Technical approach (options — pick in Phase A)

**Constraint:** A **single** `box-shadow` on one element **cannot** apply different blur per pixel along the stroke. Segmentation requires **one of:**

1. **SVG / canvas stroke** — Draw the frame as four paths (or one path with dasharray) and use **mask/gradient** along stroke parameter for taper; shadow analog harder (may simulate with blurred strokes).
2. **Multiple DOM layers** — Stack up to **`4 × N`** edge strips (see §5.1 cap on **N**), each with its own shadow/glow and **linear alpha/width** gradient masks toward segment ends.
3. **Shader / filter** — SVG `feGaussianBlur` + custom `feComponentTransfer` masked by distance to cut lines (heavy; CEF compatibility TBD).

**Recommendation for Phase A:** prototype **(2)** for shadow (simpler: per-strip `box-shadow` or filter) and **(1)** SVG for glow (stroke-based glow via duplicate blurred strokes), **or** unified SVG for both if one model covers shadow well enough.

**Replace vs extend `segmentation` in `pip_glow.html`:**  
Map legacy experimental `segmentation` to the new model (`segmentMode` + `segmentsPerEdge`) or drop after migration table; document in registry changelog.

---

## 5. Data model & UI

| Field | Type | Description |
|--------|------|-------------|
| `segmentMode` | `'full' \| 'uniform'` | `full` = no cuts; `uniform` = **N equal parts per edge** (replaces fixed `bisect` / `thirds` only — N=2 ⇒ bisect, N=3 ⇒ thirds, N>3 ⇒ general). |
| `segmentsPerEdge` | `integer` | **Parts per edge** (≥ 1). Meaning: each of the four sides is divided into **N** equal-length runs separated by **N − 1** internal cuts (N=1 ⇒ full frame). |
| `segmentEase` | `0…1` normalized | Strength falloff toward cuts (default e.g. `0.5`). |
| `segmentEaseCurve` | optional enum | `linear` / `ease` / `ease-in-out` (default). |

**Presets (optional UI shortcuts):** “Bisect”, “Thirds”, etc. map to `segmentMode: 'uniform'` + `segmentsPerEdge: 2 | 3` without separate engine modes.

- Add to **`pip-overlay-registry.js`** schema for `glow` and `shadow` only (not border / edge_strip unless requested later).
- Extend **`PIP_OVERLAY_PARAM_DEFAULTS`** in `pip-overlay-utils.js` and **Art-Net** mapping in `src/artnet/artnet-receiver.js` (see §5.2).
- **Global border** inspector reuses same params via existing global border object.

### 5.1 Maximum `segmentsPerEdge` — hard cap + resolution-aware clamp

Operators want **large N** on very wide canvases; the limit is **visual usefulness**, **implementation cost** (DOM nodes / SVG complexity / `box-shadow` count), and **CEF paint cost** on Caspar’s HTML producer.

**Recommended policy (two layers):**

1. **Hard cap (constant)** — **`segmentsPerEdge ≤ 32`** (i.e. up to **31 internal cuts per edge**, **128** segment cells if each cell is one composited strip on all four sides).  
   - **Rationale:** A multi-layer implementation with up to `4 × N` active shadow/glow strips stays in a **low triple-digit** DOM/CSS budget; Caspar CEF remains responsive at 1080p50 / 2160p25.  
   - **If** implementation uses a **single SVG path + masks** (lighter per segment), re-benchmark and optionally raise cap to **48** or **64** in a follow-up — do **not** raise without profiling on target hardware.

2. **Soft clamp (resolution-aware, optional)** — Let **`L_min_px`** be the length in **CSS pixels** of the **shortest** of the four edges of `inner` after layout (template may approximate from normalized `inner` × viewport size). With **`S_min ≈ 40 px`**, **`N_eff = min(N_requested, floor(L_min_px / S_min), 32)`** with **`N_eff ≥ 1`** may be applied **inside the HTML template** (or server merge) as a defensive clamp. There is **no** WebUI “auto fit” control — operators pick **N** explicitly (inspector and DMX §5.2).

**Inspector UX:** numeric `segmentsPerEdge` with **min 1, max 32** only.

**DMX / Art-Net:** See §5.2 — discrete **1…32** on **`startChannel + 15`** when mode is uniform.

### 5.2 Art-Net & downloadable fixture (global border patch)

Relative to **`artnetPatch.startChannel`** (1-based DMX “Ch 1” of the patch):

| DMX | Param | Notes |
|-----|--------|--------|
| start+15 | `segmentsPerEdge` | 0–255 → **1…32**; applied only when **`segmentMode === 'uniform'`** (moving this channel while mode is **full** is ignored). |
| start+16 | `segmentEase` | 0–255 → **0…1** |
| start+17 | `segmentMode` | 0–127 → **`full`** (forces `segmentsPerEdge = 1`); 128–255 → **`uniform`** (re-reads current DMX on **start+15** for N). |

Operator fixture text: **`web/fixtures/global-border.txt`** (18 channels). Inspector **Art-Net mapping** table: `web/components/inspector-panel-views.js`.

---

## 6. Acceptance criteria

1. **Mode 1:** Pixel-identical (within tolerance) to current glow/shadow for default params on same resolution.
2. **Mode 2:** Visually **discontinuous** effect at agreed cut lines; **strength tapers** toward cuts per `segmentEase`; no runaway CPU on 1080p50.
3. **Uniform N:** With `segmentsPerEdge = N`, each side shows **N** equal-length visible segments; taper at **each** internal separation; **`N` clamped** per §5.1 (hard max 32, optional `L_min_px / 40` soft clamp).
4. **Inside / outside** (`side`) and **corner radius** remain supported or explicitly documented if unsupported in v1.
5. **CG UPDATE** path: changing `segmentMode` or `segmentEase` updates without full template reload when same template family.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Ambiguity of “3 cuts” / corner diagonals | Lock **geometry mock** + sign-off before implementation. |
| Single `box-shadow` limitation | Do not promise per-pixel taper on one shadow; use multi-layer or SVG. |
| CEF / Flash performance | Cap segment count; test on target Caspar build. |
| Legacy `segmentation` in glow | Migration table + changelog for operators with saved looks. |

---

## 8. Phases

| Phase | Tasks |
|-------|--------|
| **A — Design** | Finalize cut geometry for N=2 (cross vs corner diagonals); generalize to **uniform N**; confirm **32** as v1 hard cap unless SVG-only path buys headroom. |
| **B — Shadow** | Implement in `pip_shadow.html` + registry defaults + CG JSON merge keys. |
| **C — Glow** | Implement in `pip_glow.html`; remove or migrate old `segmentation` conic hack. |
| **D — QA** | PIP + global border, inside/outside, radius 0 and >0, HD/UHD, Art-Net if wired. |

---

## 9. Out of scope (unless pulled in)

- **Border** / **edge_strip** templates (different geometry — separate WO if needed).
- **Scene take** crossfade of segmented vs non-segmented (should work as today via opacity on layer).

---

## 10. Open questions (for stakeholder / operator review)

1. Mode 2: **Diagonal** cuts at 45° through corners, or **only** horizontal + vertical mid-lines?
2. Should cuts be **hard gaps** (fully off) or **only** soft taper (never zero thickness)?
3. Mode 3: separations on **global border** — are cuts **parallel to screen edges** only (assumed yes)?
4. Is **32** per-edge cap acceptable for flagship 8K walls, or must DMX/UI expose **48** after SVG benchmark?

---

**End WO-44**
