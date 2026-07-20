# WO-285 — CG studio should reuse the existing inspector; box size options missing

**Source:** todos19.07.26 — "the cg studio should use the existing inspector for its preferences.
the options are missing size for the boxes. only weigth."

## Problem
Two complaints in one line:
1. **Divergent inspector.** CG studio rolls its own preferences/inspector UI instead of the
   inspector pattern the rest of HighAsCG uses, so it looks and behaves differently and the two
   drift apart as fields are added.
2. **Missing box size fields.** The lower-third parameter set exposes font *weight* but no *size*
   control for the boxes — the operator can change weight but not dimensions.

## Ground truth to read first
- `src/cg-studio/lt-param-registry.js` — the field definitions (DATA/COLOR/TYPOGRAPHY/LAYOUT/
  ANIMATION_FIELDS, TEMPLATE_EXTRAS, `getFieldsForTemplate`, `getDefaultPayload`). This is already
  a structured registry: `titleFontSize`/`subtitleFontSize` exist under typography, `marginX`/
  `marginY`/`opacity`/`position` under layout. Establish precisely which "size for the boxes"
  control is missing versus merely not surfaced.
- `src/cg-studio/public/app.js` — the studio's own inspector rendering (browser script, NOT a
  module; eslint treats `src/cg-studio/public/**` as browser globals with `sourceType: script`).
- `client/components/inspector-common.js` and the device-view inspector components — the existing
  inspector pattern that should be reused.
- **The engine contract:** `template/lower-thirds/lt-engine.js` + `lt-engine-styles.js` define
  `STYLE_KEYS`, and `tools/smoke/smoke-lt-engine-registry-sync.test.js` GATE-ENFORCES that the
  registry field union exactly equals the engine's style vocabulary. **Any new field must be added
  to the engine STYLE_KEYS *and* the registry together, or the gate fails.** That test is the
  contract — do not weaken it to make a new field pass.

## Scope and constraints
- Adding a box-size control means the engine must actually honour it: a style key the engine
  ignores is worse than no control. Implement the style application in the engine (both
  `lt-engine.js` and the `lt-engine-core`/`lt-engine-styles` split, which the sync test keeps
  equal) and expose it in the registry.
- The lower-third templates render ON AIR inside Caspar's CEF. Changes to `template/lower-thirds/`
  affect live graphics — be conservative, keep defaults identical to today's rendering so existing
  looks do not shift, and make the new control opt-in (empty/auto = current behaviour).
- If reusing the main inspector wholesale is not feasible because CG studio is served as a separate
  browser app without the client's module graph, say so explicitly with evidence and instead make
  the studio's inspector *consistent* — same field-group ordering, labels, and control types driven
  by the shared registry — rather than faking a shared component.
- `src/cg-studio/` is mirrored to `client/tools/electron-launcher/cg-studio/` by
  `client/tools/electron-launcher/sync-cg-studio.sh`. NEVER hand-edit the launcher copy; edit
  `src/cg-studio/` and run:
  `HIGHASCG_SERVER_ROOT=/home/casparcg/highascg bash client/tools/electron-launcher/sync-cg-studio.sh`

## Acceptance
- Box size is controllable from the studio inspector and visibly changes the rendered template.
- Registry/engine style-key sync test still passes unmodified in spirit (extended, not weakened).
- Studio inspector follows the established field-group structure driven by the shared registry.
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
