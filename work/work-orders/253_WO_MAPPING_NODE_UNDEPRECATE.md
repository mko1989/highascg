# WO-253 — Un-deprecate mapping nodes (WO-242 gated the wrong feature) + rename to "Mapping node"

**Status:** OPEN (apply AFTER WO-243 lands — same device-view surface, avoid concurrent edits)
**Priority:** HIGH (a wanted feature is currently blocked in the UI)
**Owner check:** A253.1

## Owner correction (verbatim)
"you did this [deprecation notice] yet this pixel mapping is a different thing. lets call it mapping node for simplicity. it splits a large canvas into multiple outputs to use as screen consumer spanning multiple monitors or decklink outputs split with subregions."

## What WO-242 got wrong (exact surface, from `git show 74990aa`)
The agent assumed the device-graph "Pixel Mappings" band (`role === 'pixel_mapping'` nodes) was the JS Art-Net pixel-mapping pipeline and gated it behind `settings.ui.legacyJsPixelmap`:
1. `client/components/pixel-map-editor.js` (~line 116-125): the `highascg-pixel-mapping-open` handler now refuses to open the editor and toasts a deprecation warning unless the flag is on.
2. `client/components/device-view-mappings-render.js`: the "+ Add mapping node" button is hidden and a deprecation note paragraph is rendered when the flag is off and no nodes exist (`legacyJsPixelmapEnabled()` helper + template change).
3. `client/components/device-view-inspector-mapping.js`: +1 line (check the diff; likely a related note/gate).
These nodes are the CANVAS-SPLITTING feature (one large canvas → multiple screen-consumer / decklink outputs with subregions) — NOT the Art-Net JS pipeline. The native `pixelmap` screen destination (WO-242's actual deliverable) does not replace them.

## Tasks

**T253.1 — revert the gating in all three files**
Remove the `legacyJsPixelmap` checks, the toast-and-return in pixel-map-editor.js, the conditional "+" button and the deprecation paragraph in device-view-mappings-render.js, and whatever the +1 line in device-view-inspector-mapping.js added. The editor and "+ Add" work unconditionally again. (Do NOT git-revert — WO-243 has since touched neighboring code; make targeted edits.)

**T253.2 — rename for clarity ("mapping node")**
In the device-view band and editor UI text: heading "Pixel Mappings" → "Mapping nodes"; button title already says "Add mapping node" (keep); any editor modal title saying "Pixel mapping" → "Mapping node". Grep those three files + CSS class names — do NOT rename CSS classes/`role: 'pixel_mapping'` model values or events (`highascg-pixel-mapping-open`) — display text only (model/event renames would break persisted graphs).

**T253.3 — re-scope the flag docs**
- `docs/ARTNET_PIXEL_MAPPING.md` + the two walkthroughs: wherever WO-242's edits claim the mapping-node editor is the deprecated JS pixelmap, correct them: mapping nodes are the canvas-splitting output feature (active, not deprecated); the [DEPRECATED] badge applies only to the JS Art-Net *fixture output* pipeline if such a distinct surface is documented. Read the docs sections before editing; report what actually needed changing.
- If `settings.ui.legacyJsPixelmap` no longer gates anything after T253.1, leave the settings key harmless (do not remove the setting — cheap) but note in the docs that it is currently unused.

**T253.4 — smoke** (extend `tools/smoke/smoke-wo242-pixelmap-screens.test.js` or new file in gate)
Grep-level: pixel-map-editor.js contains NO legacyJsPixelmap gate; mappings-render renders the add button unconditionally; band heading says "Mapping nodes".

## Constraints (standard)
No git ops beyond reading history, no service ops, no AMCP, no HTTP, no vite build, curated gate ONLY. node --check + eslint --quiet; exact counts; honest checkboxes.

- [ ] T253.1 gating reverted (3 files)
- [ ] T253.2 display rename
- [ ] T253.3 docs re-scoped
- [ ] T253.4 smoke
- [ ] A253.1 (owner) mapping node editor opens again; native Pixel Map destination unaffected
