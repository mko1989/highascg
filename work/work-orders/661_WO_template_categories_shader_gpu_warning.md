# WO-661 — Templates tab in groups (Templates / Lower thirds / Shaders) + ⚠ on shaders without Caspar GPU

**Status: DONE (2026-10-21, offline 2716/0 + Godot 20771/0; box: Godot groups + ⚠ verified; web = owner QA)**

Owner 21.10: "for both webui and Godot categorization of templates system, lower thirds, shaders (shaders should have a
warning sign when GPU acceleration isn't turned on in CasparCG."

## Investigation

- Both clients drew one flat list from `GET /api/templates` (Caspar TLS `{id, label}`, no kind) and told kinds apart
  only by path: web `client/components/sources-panel-templates.js`, Godot `features/live/source_lists_model.gd`
  `template_rows` → `source_list_panel.gd` (flat Tree).
- Lower-third rule missed CG Studio exports: `template/studio/lt-*.html` (box TLS `STUDIO/LT-GRADIENT-WAVE-MARCIN`)
  showed as a plain template. Box catalogue: 190 shaders, 10 + 1 lower thirds, 20 templates.
- GPU: setting `operatorTools.cefEnableGpu` (default off) → generator writes `<html><enable-gpu>`
  (`src/config/config-generator.js:97,118`); it applies only after a Caspar config apply + restart. What Caspar
  actually runs is in INFO CONFIG (`ctx.gatheredInfo.infoConfig`, served raw by `GET /api/config`). Without it CEF
  has no WebGL2 and shader templates render nothing on the CG path (WO-268). On the box both are **off** now.

## What was done

- Server: new `src/shaderfx/caspar-html-gpu.js` (`parseHtmlEnableGpu`, `htmlGpuState`); `GET /api/shaders` now
  returns `gpu: { running, setting }` (`running` from INFO CONFIG, null until gathered). Both clients already fetch
  this route for shader names, so no new request.
- Web: new `client/lib/template-category.js` (`TEMPLATE_GROUPS`, `templateCategory`, `shaderGpuWarning`).
  `sources-panel-templates.js` renders three collapsible group headers with counts (collapsed state in
  localStorage; a filter opens every group); the lower-third Edit button now also covers `studio/lt-*`; ⚠ with the
  reason as tooltip on the Shaders header and each shader row. CSS in `03c-sources-items-effects.css`.
- Godot: `source_lists_model.gd` rows carry `group` (same rule, studio included), `GROUPS`, `gpu_warning()`;
  `source_list_panel.gd` optionally groups rows under collapsible headers (remembered in ui.cfg `[sources]
  Templates_closed`), warning icon on the header and rows, reason in the tooltip (no ⚠ glyph in the UI font, so
  the icon is `assets/ui/icons/warning.svg`). `media_panel.gd` wires groups + warning.
- Warning text says what to do: turn on "Enable GPU in CEF templates" (Devices → Caspar server), apply, restart
  Caspar; a separate text when the setting is on but Caspar still runs without it.
- Not changed: `isLowerThirdSource` (web) / `lower_third_model.gd is_lower_third` still use the old rule (inspector
  LT fields) — studio exports there are a separate question.

## What was VERIFIED

- `node --test tools/smoke/smoke-wo661-template-categories.test.js` 6/6 (new, in the curated list);
  `npm run -s test:ci` 2718 tests, 2716 pass, 0 fail. Lint, format, line cap, unwired exports clean.
- Godot `--test` 20771 passed, 0 failed (`test_template_rows` + new `test_gpu_warning`); `--check` OK.
- Box: `GET /api/shaders` → 190 shaders, `gpu {running: false, setting: false}`. Godot relaunched: Templates tab
  shows "Templates 20", "Lower thirds 11" (incl. `STUDIO/LT-GRADIENT-WAVE-…`), "⚠ Shaders 190"; collapsing a
  group is remembered.
- Owner QA: web Templates tab (groups, ⚠ tooltip); after turning GPU on + Caspar restart the ⚠ disappears.
