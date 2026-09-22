**Status: IMPLEMENTED (2026-09-22, offline suite 2502/2504 / 0 fail / 2 pre-existing skips, max-file-lines clean, client rebuilt, `highascg` restarted, kiosk reloaded) — owner on-hardware confirmation owed**

## Investigation

Shader Live's param panel (`shader-live-editor.js`) built its rows from a flat scan of the
shader source: `scanShaderParams` (named `#define`/`const` literals) plus `scanShaderDeepParams`
(every other numeric/vec literal in the body, bucketed into categories like "Colors"/"Speed &
time"). For any real ShaderToy-derived shader this produces dozens of rows — hash constants,
`iResolution` plumbing, texture UV offsets, and multiple independent `iTime * k` speed literals
all show up as separate sliders with code-derived names (`arg 2`, `col (1,2)`, `if arg`), which
is the opposite of the "remember minimalism" principle the owner has repeated for this exact
panel (`work/work-orders/todos27.07.26:65`) and the standing UI rule in `CLAUDE.md`
("Minimalism is the standing UI principle").

Evidence of the flood, quantified in the new smoke test
(`tools/smoke/smoke-wo577-shader-controls.test.js`, "library: main panel stays small…"): run over
every shader in `data/shaders/*.json`, the raw per-shader scan (`scanShaderCfg`) regularly
produces 4×+ more literal rows than are meaningful to an operator, and a meaningful fraction carry
junk labels straight from the source (`arg 2`, `if arg …`, `col (r,g)`).

The old `scanCfg()`/`renderParams()` pair in `shader-live-editor.js` did have SOME curation (a
`DEEP_CATEGORY_ORDER` grouping + same-base clustering, from WO-340/348), but it still surfaced
every literal it found — there was no notion of "this one doesn't belong on the main panel at
all" or "these three literals are really one control."

## What was done

New synthesis layer, `client/lib/shader-controls.js`:
- `scanShaderCfg(shaderCfg)` — replaces the editor's old inline `scanCfg()`; unifies named +
  deep-literal scanning into one keyed param list (moved out of the editor so the offline suite
  can exercise it directly against the whole shader library).
- `buildControls(params, opts)` — synthesizes a bounded (`≤16`, enforced by the smoke test) set of
  labeled, sectioned (`Motion`/`Look`/`Color`/…) controls from the raw params:
  - filters out structural literals (texture-coordinate constants, hash-function magic numbers,
    resolution plumbing) that are never meaningful to tweak;
  - collapses N independent `iTime * k` / `iTime / k` multipliers that clearly share one role into
    a single macro control (`macro:speed`), correctly flagging divisor members as `inverse` so a
    single "Speed ×" drag scales them the opposite way from multiplied members;
  - accepts an operator-curated manifest (`opts.manifest = { pinned, hidden, presets }`) — pin a
    param under a custom label/section, hide one entirely, or save a named preset of current
    values.
- `macroFactor(params, control, pristineByKey)` — reads back the current multiplier a macro
  control represents, so re-opening the editor shows where the "Speed ×" slider currently sits
  instead of resetting to 1×.
- Everything `buildControls` does not select for the main panel still exists — it's rendered in a
  collapsed `<details>` "Advanced — all N detected values" block (lazy-filled only when opened),
  so nothing found by the scanner is actually lost, just deprioritized.

`src/shaderfx/shader-store.js` — `normalizeShaderConfig` now validates and bounds the persisted
`shaderCfg.controls` manifest (dedupes pinned/hidden keys, drops empty/malformed entries, caps
label length, drops presets referencing unknown sections), and omits the `controls` key entirely
when the manifest is empty (no `{}` clutter written into every shader's JSON).

`shader-live-editor.js` (net simpler — the old category-clustering/base-label-sort code is
deleted, not replaced):
- Wires the new `shader-controls-panel.js` component (extracted UI) into the params host.
- `persistCfg()` — saves label/controls/preset curation via `/api/shaders` WITHOUT baking in
  whatever the operator is mid-editing: it always POSTs `pristine.common`/`pristine.passes[k]`
  (the last-saved source, not the live-edited buffer), so opening the controls-curation UI can
  never accidentally commit an unsaved live edit as the library version.
- `applyBatch(items)` — lets the panel drive several params at once (macro drag, preset load,
  randomize) as one source rewrite + one `CG UPDATE` per affected pass, instead of one round-trip
  per literal; rewrites right-to-left by span start so editing an earlier literal never shifts the
  string offsets of a later one still queued in the same batch.
- Shader-audition (drag a shader from the templates browser onto preview) extracted verbatim into
  `client/components/shader-live-audition.js` (`installShaderAudition`) — pure code motion, no
  behaviour change, done to keep `shader-live-editor.js` under the 500-line CI limit now that the
  controls-panel wiring is added.

## VERIFIED

- New smoke `tools/smoke/smoke-wo577-shader-controls.test.js` (already registered in
  `tools/ci/run-offline-tests.js`): 8/8 pass — library-wide bound on main-panel size, junk-label
  rejection, an unannotated synthetic ShaderToy-style shader gets named/sectioned controls,
  structural literals are excluded, the speed macro collapses/expands correctly including divisor
  inversion, `#define FLAG 1`-style integer literals stay integer through a rewrite, keys stay
  stable when a neighbouring literal is edited, the manifest normalizer drops junk, and a
  source-text assertion pins that the editor persists the pristine (not live-edited) source.
- Full offline suite: 2502/2504 pass, 2 skipped (pre-existing `CI=1`-gated network tests,
  unrelated to this change).
- `node tools/ci/check-max-file-lines.js`: 0 files over 500 lines.
- Lint: confirmed the tree's 219-warning count is identical with and without this change (checked
  against an isolated snapshot of `HEAD`) — this work introduces no new lint warnings; the
  219-vs-218 gate is a pre-existing, unrelated regression (see the lint ratchet note under
  WO-538) and is out of scope here.

**Not yet done:**
- No live/on-hardware check yet: owner should open Shader Live on a real shader, confirm the main
  panel is short, the Advanced list has everything else, a Speed macro (if the shader has one)
  drags smoothly in both directions, and Save still round-trips labels/controls without touching
  the shader's actual GLSL source.
