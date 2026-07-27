# WO-356 — Shader Live v3: rect groups, wheel steps, child saves, audition from templates browser

**Status: DONE (2026-07-27)** · Source: todos27.07.26 batch 6 (owner).

## Editor UX

- **Compact + category RECTS**: every category (and the Caspar-mixer block, and named params)
  renders as a bordered group box — title + 2-column grid inside (`.shader-live__group*`);
  rows tightened (2px gaps, 0.75rem names).
- **Mouse wheel on sliders**: one `step` per notch, clamped, fires the same `input` path as a
  drag — precise small changes without pixel-hunting (delegated, `passive:false`).
- **"col"-named scalars**: `vec3(1.8)` broadcasts one value — now named "<ident> level" (not a
  fake ".x" channel) and color-NAMED params group under the Colors rect even as sliders (a
  scalar can't be a picker, but it is color work).

## Child saves (never overwrite the source shader)

"Save to library" now writes `<rootId>-cN` (first free N) with `parentId` = the ROOT shader
(one-level tree: children of children attach to the same root). shader-store whitelists
`parentId` (validated, non-self). The child exports to template/shaders/<id>.html like any
shader, so it appears in the templates browser (and Caspar TLS) next to its parent.

## Audition from the templates browser — ONLY in shaders mode

Clicking a shader row (parent or child) in the Sources → Templates browser dispatches
`shader-audition-request`; the Shader Live editor handles it ONLY while open (owner: "this only
should happen when in the shaders mode") — outside shaders mode the click does nothing new.
The handler stages an ephemeral one-layer look on the active main's preview bus through the
normal `/api/scene/take target:'preview'` pipeline, so scene.live updates and the instance
dropdown picks the auditioned shader up (pre-selected). The Edit button still opens Shader FX.

## Structure

`liveShaderInstances` split out to `client/lib/shader-live-instances.js` (500-line gate).

## Follow-ups (same day) — v3b/c/d

- **Per-param ↺ looked dead** — it landed on air but never re-rendered the row; fixed.
- **Colors category narrowed** to values whose LABEL is the color target (statement-wide match
  had flooded the Colors rect with every col-math slider).
- **Dense grids**: auto-fill minmax(215px) columns — 4-up on the operator display.
- **Clustering**: same-base labels ("freq", "freq #2") sort adjacent within each category.
- **Idiom DECODE (shader-param-describe.js)**: each auto param carries a sentence about what it
  will do — `length(p)-◆` → "size/radius of the shape", `mix(..,◆)` → "blend amount",
  `exp(-◆d)` → "falloff — tighter glow", `sin(iTime*◆)` → "wave speed", loop bound →
  "iteration count — more = finer detail, slower render"… falls back to the raw calculation
  line; the code always stays in the tooltip.
- **≋ WIGGLE preview (shader-cg-update.js)**: per-param button briefly oscillates the value on
  the PREVIEW instances only (~1.2s, clamped ±12% of range, scratch source — shaderCfg and PGM
  untouched), then restores: the operator SEES what a value does before committing.
- **▶ take in the editor bar**: PRV→PGM from inside shaders mode — fires the deck's global-take
  button (hidden but mounted), so transition semantics stay identical.
- pushLive refactored onto shared `pushCgUpdateTo`; row builders split to
  shader-live-rows.js (500-line gate).

## Verification

wo340 smoke 23/23, test:ci 1555/0, lint 0, gate 0; client built + kiosk reloaded. Owner checks:
wheel-stepping, rect groups, save → "-c2" child appears in templates browser, clicking it in
shaders mode lands it on PRV and in the dropdown; outside shaders mode clicks do nothing.
