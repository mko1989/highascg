# Work Order 60: CG-only looks — deck card treatment & alpha checkerboard thumbnails

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** In progress  
**Priority:** Medium (operator UX — distinguish graphics-only looks at a glance)  
**Related:** [08_WO_CASPARCG_CLIENT_FEATURES.md](./08_WO_CASPARCG_CLIENT_FEATURES.md) (Looks deck), [WO_LOWER_THIRD_TEMPLATES_API.md](../WO_LOWER_THIRD_TEMPLATES_API.md), `src/engine/scene-template-cg.js`, `client/components/scene-list.js`, `client/styles/06a2-scenes-deck-cards.css`

---

## 1. Goal

Looks that contain **only Caspar CG / HTML template layers** (no media, live, timeline, browser, or placeholder video fills) should be **visually distinct** in the **Looks deck** so operators can spot “pure graphics” looks instantly.

### 1.1 Deck card background colours (CG-only looks)

Replace the neutral card/thumb background with **state-driven fills** on the thumb region (and optionally the whole card body):

| State | Background | When |
|-------|------------|------|
| **Idle** | **Dark blue** (`#0b1f3a` or design-token equivalent) | CG-only look, not on PRV or PGM for this main |
| **On program (live)** | **Purple** (`#5b21b6` / `#6d28d9` range) | `scenes-card--live` — look is the active PGM look on that main |
| **On preview** | **Green–yellow** (`#84cc16` → `#eab308` gradient or solid lime–amber) | `scenes-card--preview` — look is staged on PRV for that main |
| **PRV + PGM (same look)** | **Purple dominant** with subtle green–yellow edge/accent | Both `--live` and `--preview`; purple wins for “on air” readability |

**Non-CG looks** keep today’s styling (neutral `--bg-dark` thumb, red/green PGM/PRV **rings** only).

**CG-only looks:** keep PGM/PRV **rings** if they help accessibility, but the **background colour** is the primary signal; rings may be toned down so they do not fight the fill (implementation choice — document in Work Log).

### 1.2 CG-only look thumbnails

Deck thumbnails for CG-only looks must **not** use the generic `drawSceneComposeStack` media-thumb path (wrong aspect, no alpha, placeholder gradients).

Instead:

1. Render each template layer’s **final composed graphic** — the same visual state operators see **after** `CG PLAY` / lower-third `play()` with that layer’s **`cgData` / `lowerThirdConfig` / `templateData`** (not empty defaults unless the look truly has no editor content).
2. Composite layers bottom-to-top in normalized **fill** rects (same as compose stack).
3. Use a **checkerboard alpha background** behind the graphic (reuse existing checker patterns — see §3.2), so transparent/template edges read clearly in the small deck cell.
4. **No fake PGM letterboxing** in deck thumb mode — CG-only thumbs are “graphic on alpha”, not “graphic on 16:9 black”.

---

## 2. Definition — “CG-only look”

A scene/look is **CG-only** when **every layer that counts as content** is a CG template layer.

### 2.1 Layer counts as “content” if

- `layer.source` is present **and** not an empty placeholder with no template id, **or**
- `layer.template` / `layer.templateData` / `layer.cgData` is set without a non-CG source.

### 2.2 Layer is a “CG template layer” if **any** of

| Signal | Notes |
|--------|--------|
| `source.type` is `template`, `cg`, or `html` | Align with `isSceneTemplateLayer()` in [`src/engine/scene-template-cg.js`](../../src/engine/scene-template-cg.js) |
| `isLowerThirdSource(source)` | [`client/lib/lower-third-cg-data.js`](../../client/lib/lower-third-cg-data.js) — `lower-thirds/lt-*` |
| Clip id resolves as template via `isTemplateClip()` | Timeline-style template refs inside a look layer (rare but supported server-side) |
| PIP overlay HTML templates **only** | If a layer has **only** `pipOverlays` with HTML template types and no underlying video/media source — treat as CG (edge case; document if deferred) |

### 2.3 Layer **disqualifies** CG-only if

- `source.type` is `media`, `live`, `live_audio`, `timeline`, `browser`, `route`, `ndi`, etc.
- Placeholder **video** templates (`color_grid`, `smpte_bars`, …) used as full-screen fills
- Layer `sourceMode === 'list'` with a playlist containing any non-template entry

### 2.4 Empty looks

- **Zero layers** → **not** CG-only (keep current empty state).
- **Layers but all sources null** → not CG-only.

### 2.5 Shared helper (required)

Add **`isCgOnlyLook(scene)`** (pure function, client + server):

- **Client:** [`client/lib/scene-look-kind.js`](../../client/lib/scene-look-kind.js) (new, ≤120 lines)
- **Server:** mirror or re-export from shared module if bundle allows; minimum: same logic in smoke test import path
- **Also export** `isCgTemplateLayer(layer)` wrapping the rules above

Unit tests: [`tools/smoke/smoke-cg-only-look.test.js`](../../tools/smoke/smoke-cg-only-look.test.js)

---

## 3. Current state (baseline)

| Area | Today | Gap |
|------|--------|-----|
| **Deck cards** | [`scene-list.js`](../../client/components/scene-list.js) adds `scenes-card--live` / `--preview` / `--global` | No CG-only detection; thumb bg has `--bg-dark` |
| **Card CSS** | [`06a2-scenes-deck-cards.css`](../../client/styles/06a2-scenes-deck-cards.css) — PGM red ring, PRV green ring | No CG-only background tokens |
| **Deck thumb paint** | [`scenes-editor.js`](../../client/components/scenes-editor.js) → `drawSceneComposeStack(..., { deckThumbnailMode: true })` | Media thumbs / grey placeholders; templates get `drawPlaceholderFill` or label text |
| **Template CG engine** | [`scene-template-cg.js`](../../src/engine/scene-template-cg.js) — `resolveCgTemplateName`, default cgData | No thumbnail/render API |
| **LT thumb generator** | [`tools/runtime/generate-lt-thumbnails.js`](../../tools/runtime/generate-lt-thumbnails.js) — Puppeteer, `play()` then screenshot | Offline batch only; not wired to live looks / per-look cgData |
| **Checkerboard** | [`preview-canvas-draw-base.js`](../../client/components/preview-canvas-draw-base.js) `drawDualComposeCellPreview`; CG Studio [`CANVAS_CHECKERBOARD_CSS`](../../client/assets/modules/cg-studio/cg-studio-editor-theme.js) | Not used in deck thumbs today |

---

## 4. Architecture — thumbnails for CG-only looks

```text
paintDeckThumb(canvas)
  → scene = getScene(id)
  → if !isCgOnlyLook(scene) → existing drawSceneComposeStack(deckThumbnailMode)
  → else drawCgOnlyLookDeckThumb(ctx, scene, { w, h })
        → fill checkerboard full cell
        → for each CG layer (sorted by layerNumber):
              img = getCgLayerFinalThumb(layer)  // cache keyed by hash(cgData+templateId+fill)
              drawImage in fill rect with opacity
```

### 4.1 `getCgLayerFinalThumb(layer)` — options (pick in Phase 0)

| Option | Pros | Cons |
|--------|------|------|
| **A. Server render API** (`POST /api/cg-thumb/render`) | Accurate Caspar HTML/CEF; can reuse Puppeteer/headless path | Server load; latency on first paint; needs cache |
| **B. Client hidden iframe + html2canvas** | No server round-trip for edits | CEF/Caspar JS quirks; cross-origin template paths; heavier in browser |
| **C. Caspar offscreen channel PRINT** | Pixel-perfect vs on-air | Needs spare channel/layer; AMCP cost; dirty when cgData changes |
| **D. Pre-baked catalog PNGs + cgData overlay (LT only)** | Fast for stock lower-thirds | Wrong for custom CG Studio exports / arbitrary TLS templates |

**Recommendation:** Start with **A** for correctness (extend pattern from `generate-lt-thumbnails.js`), with **disk cache** under `data/cg-look-thumbs/` keyed by `sha256(templateId + stableJson(cgData) + renderProfileVersion)`. Fall back to styled placeholder + template label if render fails (debug tooltip).

**“Final look” semantics:**

- Lower-thirds / lt-engine templates: call `update(cgData)` then `play()`; wait **animation settle** (fixed ms cap, e.g. 200–400 ms, or template `speed`-aware).
- Static HTML templates: `update` if available, else load with data query; no play step.
- Multi-layer looks: render **each layer independently**, composite client-side (same as today’s stack order).

### 4.2 Checkerboard spec

Reuse visual language from CG Studio / compose preview:

- Cell size ~12–24 px in thumb space (scale with canvas width).
- Colors: `#334155` / `#475569` (existing compose preview) **or** CG Studio `#1a1a1a` / `#222222` — pick one pair and document in CSS variables:

```css
:root {
  --cg-thumb-checker-a: #334155;
  --cg-thumb-checker-b: #475569;
}
```

Apply to `.scenes-card--cg-only .scenes-card__thumb` background **and** inside canvas before blitting layer images.

### 4.3 Cache invalidation

Regenerate thumb when any of change:

- `layer.cgData`, `lowerThirdConfig`, `templateData`, `source.value` (template id)
- `fill`, `opacity`, `rotation`, layer order
- CG Studio saved HTML for that template id (optional v2 — bump `renderProfileVersion`)

Debounce: coalesce rapid inspector edits (300–500 ms) before POST render.

---

## 5. Architecture — deck card CSS

New modifier class on the card root when `isCgOnlyLook(sc)`:

```html
<div class="scenes-card scenes-card--cg-only [scenes-card--live] [scenes-card--preview]">
```

Suggested CSS ( [`06a2-scenes-deck-cards.css`](../../client/styles/06a2-scenes-deck-cards.css) ):

```css
.scenes-card--cg-only .scenes-card__thumb {
  background: var(--cg-look-idle-bg, #0b1f3a);
}
.scenes-card--cg-only.scenes-card--live .scenes-card__thumb {
  background: var(--cg-look-pgm-bg, #6d28d9);
}
.scenes-card--cg-only.scenes-card--preview:not(.scenes-card--live) .scenes-card__thumb {
  background: linear-gradient(135deg, #84cc16 0%, #eab308 100%);
}
.scenes-card--cg-only.scenes-card--live.scenes-card--preview .scenes-card__thumb {
  background: linear-gradient(180deg, #6d28d9 0%, #6d28d9 72%, #a3e635 100%);
}
```

Optional: small **“CG”** pill in header (like global indigo stripe) — only if user testing shows colour alone is insufficient.

---

## 6. Code map (planned)

| Concern | File / area |
|---------|-------------|
| CG-only detection | `client/lib/scene-look-kind.js` (+ server mirror if needed) |
| Deck card class | [`scene-list.js`](../../client/components/scene-list.js) |
| Deck thumb branch | [`scenes-editor.js`](../../client/components/scenes-editor.js) `paintDeckThumb` |
| CG thumb draw + checkerboard | `client/components/cg-only-look-deck-thumb.js` (new) |
| Server render + cache | `src/media/cg-look-thumb-cache.js`, `src/api/routes-cg-thumb.js` |
| Render worker | extend `tools/runtime/generate-lt-thumbnails.js` logic → `src/media/cg-template-render.js` |
| CSS tokens | [`06a2-scenes-deck-cards.css`](../../client/styles/06a2-scenes-deck-cards.css) |
| Tests | `tools/smoke/smoke-cg-only-look.test.js`, optional render smoke with fixture HTML |
| Companion sync | [`companion-module-highpass-highascg`](../../companion-module-dev/companion-module-highpass-highascg) — optional `lookKind: 'cg-only'` in preset metadata (v2) |

**Do not change** compose editor canvas (`drawSceneComposeStack` without `deckThumbnailMode`) for mixed media looks — scope is deck cards only unless a follow-up WO requests compose parity.

---

## 7. Tasks

### Phase 0 — Spike & detection

- [x] **T60.0.1** Implement `isCgTemplateLayer` + `isCgOnlyLook` with table-driven tests (mixed looks, LT-only, empty, placeholder video).
- [x] **T60.0.2** Spike render path: one lower-third + one generic TLS template with custom `cgData` → PNG with alpha on checkerboard; record latency and deps (Puppeteer vs Caspar PRINT).
- [x] **T60.0.3** Choose Option A/B/C/D (§4.1) and document in Work Log.

### Phase 1 — Deck card styling

- [x] **T60.1.1** Add `scenes-card--cg-only` in `scene-list.js` when `isCgOnlyLook(sc)`.
- [x] **T60.1.2** CSS: idle dark blue, PGM purple, PRV green–yellow, combined state (§5).
- [ ] **T60.1.3** Manual QA: single-main + multi-main columns; global looks; PGM-only mains (no PRV).

### Phase 2 — CG-only thumbnails

- [x] **T60.2.1** Implement checkerboard helper (shared with compose preview or CG Studio tokens).
- [x] **T60.2.2** Server: `POST /api/cg-thumb/render` + cache; `GET /api/cg-thumb/:hash.png`.
- [x] **T60.2.3** Client: `drawCgOnlyLookDeckThumb` — stack cached layer PNGs; fallback placeholder on error.
- [x] **T60.2.4** Wire `paintDeckThumb` branch; invalidate cache on scene layer/cgData patch hooks.
- [x] **T60.2.5** Hide broken media-thumb fetches for CG-only looks (no `/api/thumbnail/...` for template sources).

### Phase 3 — Polish

- [ ] **T60.3.1** Debounced regen on inspector CG edits (lower-third + html template groups).
- [ ] **T60.3.2** Settings toggle (optional): `looks.cgOnlyVisualTreatment: true` default on.
- [x] **T60.3.3** Smoke + manual checklist (see §8).

---

## 8. Acceptance criteria

1. A look with **only** template/CG layers shows **dark blue** thumb background when idle; **purple** when on PGM; **green–yellow** when on PRV for that main.
2. A look with **any** media/live/timeline layer keeps **existing** deck appearance (no `--cg-only` class).
3. CG-only deck thumbnails show **checkerboard** behind graphics and reflect **layer cgData** (changing title text in LT inspector updates thumb after debounce).
4. Multi-layer CG-only looks composite in correct z-order; opacity respected.
5. No regression: mixed looks still use `drawSceneComposeStack` deck mode; PGM/PRV take/preview unchanged.

### Manual QA checklist

- [ ] LT classic box, custom title/subtitle, idle / PRV / PGM / both
- [ ] Two LT layers stacked (different fills)
- [ ] Generic TLS template (`source.type === 'template'`) without LT path
- [ ] Mixed look (video + LT) — must **not** get CG-only styling
- [ ] Duplicate look — CG-only class preserved
- [ ] Multi-main: CG-only look on main 2 PRV only — correct column gets green–yellow

---

## 9. Do **not** implement (explicit rejections)

- Re-skin **timeline** clips or **Sources** template rows — deck looks only.
- Force CG-only styling on looks that include **audio-only** or **timeline** layers.
- Run Puppeteer render on **every** deck paint — cache is mandatory.
- Replace PGM/PRV **compose preview** panel with this thumb renderer (separate WO).

---

## 10. Work log

| Date | Agent / role | Summary |
|------|----------------|--------|
| 2026-06-27 | Agent | WO created from operator request: CG-only looks — dark blue / purple / green–yellow deck backgrounds; checkerboard alpha thumbnails showing final CG render. |
| 2026-06-27 | Agent | Phase 0–2 implemented: `scene-look-kind.js`, deck `--cg-only` CSS, Puppeteer render API (`POST/GET /api/cg-thumb/*`), `drawCgOnlyLookDeckThumb`, smoke tests pass. Chose **Option A** (server Puppeteer + disk cache); ~1.3s first LT render on dev host. |

### Instructions for next agent

- Run **T60.1.3** manual QA on hardware (multi-main, PRV/PGM states).
- **T60.3.1:** add 300–500 ms debounce before `POST /api/cg-thumb/render` during rapid LT inspector edits (cache key already includes `cgData`).
- Generic non-`lt-*` TLS templates use `template/` path resolution; verify `casparcg-guide-html-template-master/html/lower-third.1` and pip templates manually.
- Optional **T60.3.2** feature flag if operators want legacy deck thumbs for CG-only looks.

---

*End of WO-60*
