# WO-663 — CG Studio exports are lower thirds (inspector fields, baked text on take)

**Area:** engine, godot-client
**Status: DONE (22.10.2026: offline 2736/0 + Godot 20779/0; take payload rendered in headless Chrome; box API returns the baked values). Owner QA: drop `STUDIO/LT-GRADIENT-WAVE-MARCIN` on a look and check both inspectors.**

Owner, 22.10, answering "should the inspector recognise studio LT exports?" (the follow-up WO-661 left open): *"yes"*.

## Investigation

**Detection missed studio exports**
- CG Studio exports go to `template/studio/lt-<name>.html`, Caspar path `studio/lt-<name>` (`src/cg-studio/export-template.js:136`). The box has one: `STUDIO/LT-GRADIENT-WAVE-MARCIN`.
- Every lower-third detector only matched `lower-thirds/lt-` / `lower_thirds/lt-`:
  - web + server: `client/lib/lower-third-cg-data.js` `isLowerThirdSource` (the server imports the same file: `routes-scene-lower-third.js`, `scene-take-payload.js`);
  - server look kind: `src/engine/scene-look-kind.js` `isLowerThirdSourceValue`;
  - Godot: `lower_third_model.gd` `is_lower_third`.
- So a studio layer got the generic template section in both inspectors, with no Title / Subtitle fields. WO-661 had already grouped it under "Lower thirds" in the Templates tab (`template-category.js`, `source_lists_model.gd`).

**What a studio layer showed on air**
- `scene-template-cg.js` `extractTemplateCgData`: a studio layer with no CG data was sent `DEFAULT_LT_CG_DATA` = `{ title: 'Name', subtitle: 'Title' }`.
- The export bakes its text into the HTML (`<h1>Marcin Wardecki</h1>`), but lt-engine never reads it back: `update()` / `play()` with no data run `ensurePlayableDefaults()`, which sets `Name / Title` (`template/lower-thirds/lt-engine-controls.js`).
- Headless Chrome on the real export: the old default and a bare play both render `["Name","Title"]`. The baked text never reached air.

**The trap in "just add the path"**
- Recognising the layer alone would make the resolvers fall back to `DEFAULT_LOWER_THIRD_CONFIG`, where the title is `''`. The inspector would open empty, and a take would send blank text plus the default font sizes over the export's look.

## What was done

**`src/cg-studio/studio-lt-defaults.js` (new)**
- `studioLtDefaultsFromHtml(html)` reads back what `bakeDefaults` wrote:
  - title and subtitle, using the same element choice as its `replaceSelectorText`, with scripts and styles stripped first and entities decoded;
  - `--primary` / `--text` from the `:root` CSS vars;
  - `position`, the font sizes and the hold time from the `window.__LT_INITIAL_STYLE__` seed (WO-321).
- `studioLtDefaults(id)` reads `template/studio/<lt-id>.html`. The id must match `lt-[a-z0-9-]+`, so a path can't escape the folder.

**Detection** (web lib, `scene-look-kind.js`, Godot `is_lower_third` + `is_studio`, the latter ported by a Haiku agent with its diff reviewed)
- `studio/lt-*` is now a lower third.
- New `isStudioLowerThirdSource`.

**With no operator config, a studio layer keeps its baked values**
- `resolveLayerLowerThirdConfig` and `resolveLayerLowerThirdCgData` return `null` for it, not blank defaults. Built-ins are unchanged.
- Both take builders (`scene-take-payload.js` on the server, `scenes-shared.js` on the web) skip their `{ data: {}, style: {} }` fallback for it. CG ADD then reaches `extractTemplateCgData`, which now sends `studioLtCgData(key)`: the baked text and style. `Name / Title` remains only for an export that has gone missing.
- `POST /api/scene/lower-third` (the Godot inspector) uses `{ ...DEFAULT_LOWER_THIRD_CONFIG, ...baked }` for both `resolve` and Play / Update.
- `GET /api/lower-thirds/templates`: each studio entry now carries `defaults`.
- The web inspector fills its fields from `found.defaults` once the template list arrives, but only if the layer still has no config (so it never overwrites typing). Nothing is written on open. The first edit stores the whole config, baked values included, and from then on the inspector values rule.

**Why not alternatives**
- Seeding the config when a template is dropped: there are many drop paths (web drag, Godot drag, presets), and layers that already exist would stay blank.
- Making lt-engine read its own baked DOM: that changes every built-in template too, plus every older export already on disk.

**Known limit**
- An export that has no style seed (colours only, like the box's MARCIN export) shows the default 46 / 27 px in the inspector's font-size fields. The take itself sends only what was baked, so the look on air is right. Once the operator edits, the inspector's sizes apply, exactly as with the built-in templates.

## What was VERIFIED

**Offline suite**
- `npm run test:ci`: 2736 pass, 0 fail, 2 skipped.
- `tools/smoke/smoke-wo663-studio-lower-thirds.test.js` (8 tests, in the curated list):
  - detection, including the backslash and case variants and that `mystudio/` doesn't match;
  - a round-trip through the real `bakeDefaults`, including HTML-escaped text;
  - an export with colours only;
  - an unknown or traversal id gives `null`;
  - the resolvers return `null`, and both take guards are in place;
  - a missing export still gets `Name`;
  - Godot `resolve` and Play send the baked text;
  - the web template list and inspector fill.
- Godot `--test`: 20779 pass, 0 fail (6 new asserts in `test_lower_third_model.gd`).

**Other gates**
- Lint: 214 warnings, under the cap.
- `format:check` passes; no file over 500 lines.
- Unwired exports: the baseline shrank from 634 to 633, because `isLowerThirdSourceValue` now has a test caller.
- `build:client` passes.

**Box**
- Node restarted. `GET /api/lower-thirds/templates` returns `lt-gradient-wave-marcin` with `defaults: { title: "Marcin Wardecki", subtitle: "High Creator", primaryColor: "#99c1f1", textColor: "#ffffff" }`.
- Headless Chrome, rendering the real `template/studio/lt-gradient-wave-marcin.html` → `update(x)` → `play()`:

| Payload | h1 / p on screen |
|---|---|
| Server CG data now (`extractTemplateCgData`) | `Marcin Wardecki` / `High Creator` |
| Old `DEFAULT_LT_CG_DATA` | `Name` / `Title` |
| No data | `Name` / `Title` |

- Not seen on screen: both inspectors with a studio layer selected. No project on the box has a studio layer yet (`projects/_autosave/*.json` scanned).

**Owner QA**
1. Drop `STUDIO/LT-GRADIENT-WAVE-MARCIN` on a look. The web and Godot inspectors should show a "Lower Third" group pre-filled with Marcin Wardecki / High Creator.
2. Take it without typing anything. It should show the baked text, not "Name / Title".
3. Change the title and take again. The new text should show.
