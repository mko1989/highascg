# WO-340 — shader modal: auto-detected tweakable parameters (color pickers, sliders)

**Source:** owner request 2026-07-26 — "in the shader modal id like some sort of script that would catch variables (colors, speed, others) and allow users to change those easily (color pickers, sliders, etc)."

**Status: not started.** Written 2026-07-26 from a fresh survey of the shader-FX stack (WO-266/335/339 family).

## Verified current state (2026-07-26)

- `client/components/shader-fx-modal.js` (203 lines): name input :76, audio/alpha checkboxes :77-78, common textarea :82, five collapsible pass sections (image + bufferA–D) each with a GLSL textarea + 4 iChannel dropdowns, Save/Delete :86-87, status span :88, preview iframe :91 (refreshed on save :182 via `/templates/shaders/<id>.html?_=<now>`).
- Save: `POST /api/shaders` with `{id?, name, common, passes, audio, opts}`; `normalizeShaderConfig` (`src/shaderfx/shader-store.js:52-91`) returns ONLY the known keys — an added `params` field would be silently stripped until the normalizer learns it.
- Exported template: config baked as `window.__SHADERFX_CONFIG__` (`src/shaderfx/shader-template-export.js:27-46`, `</`-escaped).
- `template/shaders/player.js` `window.update()` accepts `{paused}` only (:49-59).
- ShaderToyLite exposes NO uniform/program access (public API: setCommon/setImage/setBufferX/addTexture/setOnDraw/play/pause/reset/time/isPlaying) — custom live uniforms would need another vendored patch.

## Design

### v1 — literal rewrite (no runtime changes at all)

The GLSL text stays the single source of truth; controls read and WRITE the literals in the source. No config schema change, no player/ShaderToyLite change, exported templates just work.

1. **Parser** (`client/lib/shader-param-scan.js`, pure functions): scan pass + common sources for tweakables:
   - Explicit annotations (documented in the modal's hint text, win over heuristics):
     `#define SPEED 1.5 // @slider(0, 5, 0.1)` · `#define TINT vec3(1.0, 0.2, 0.2) // @color` · `const float N = 8.0; // @slider(1, 32, 1)`
   - Heuristic fallback (no annotation needed): top-level `#define NAME <float>` and `const float|vec2|vec3|vec4 NAME = ...` with numeric-literal initializers. Classify `vec3`/`vec4` with all components in 0–1 as **color**, floats as **slider** (range inferred: 0–4× current value, step from decimals), `vec2` as two sliders. Skip obvious non-tweakables (`PI`, `TAU`, `EPS`, all-caps math constants with `acos`/expressions as initializers — literal-only initializers qualify).
   - Each hit carries `{ passKey, name, kind, value(s), sourceSpan }` where `sourceSpan` is the exact character range of the literal(s) — the writer only ever replaces inside spans, never regex-replaces globally.
2. **Params panel** (`client/components/shader-fx-params.js`, mounted after the status span `shader-fx-modal.js:88`): one row per detected param — color input (vec3 → hex; vec4 keeps alpha as a slider next to it), range slider + number input for floats, grouped by pass. Rescan debounced ~300 ms after textarea edits; panel rebuilds only when the detected set changes (values sync in place otherwise).
3. **Write-back:** on control change, rewrite the literal in the corresponding textarea (span-based splice, preserving formatting) and mark dirty. **Apply = the existing save** (`collectForm` untouched — the values live in the source). Auto-save on slider release / picker close (change event, NOT input) so the preview iframe reloads at most once per interaction; a "live" toggle can later opt into per-input saves.
4. Keep `shader-fx-modal.js` under the 500-line limit by putting scan + panel in the two new modules; the modal only mounts/wires.

### v2 (separate follow-up, only if v1's save-reload feels too slow) — true live uniforms

Bake `params` into the config (extend `normalizeShaderConfig` + export), patch ShaderToyLite to accept `setUniform(name, values)` (declare `uniform float/vec3 u_<name>;` injected above the user source, upload in `draw()`), have the parser REPLACE the literal with the uniform reference at export time, and extend `player.js` `window.update()` to accept `{params}` so live playout (CG UPDATE) can tweak without recompiling. This is the path to on-air parameter rides; not needed for the modal UX.

## Subagent plan (owner rule: Haiku for smaller jobs)

- The parser + span-writer are pure-function work with a crisp spec — implement via a Haiku subagent, then VERIFY with an offline smoke (`tools/smoke/smoke-wo340-shader-param-scan.test.js`: annotation forms, heuristic hits, PI/expression skips, span-splice round-trip idempotence).
- The panel UI + modal wiring stay with the main agent (touches layout, dist-web build, kiosk reload).

## Acceptance

- Pasting a typical Shadertoy shader containing `#define` floats and `const vec3` colors shows a params panel with sensible controls, no annotations required; annotated params get exact ranges/kinds.
- Dragging a slider / picking a color updates the GLSL text, saves, and the preview reflects it within one iframe reload; the exported Caspar template carries the new values with zero extra machinery.
- Round-trip safe: scan → edit → rescan finds the same params; unrelated source text is byte-identical.
- No param detected → panel hidden; malformed annotation → falls back to heuristic, never blocks save.
- Offline smoke for the parser in the curated list; `npm run build:client` + kiosk reload to deploy.

## Constraints

- Never mutate source outside recorded spans; a failed rewrite must abort the control action, not corrupt the shader.
- `normalizeShaderConfig` stays untouched in v1 (it already passes source text through).
- 500-line limit per file; smoke tests that grep moved source text must be repointed if the modal is split.
