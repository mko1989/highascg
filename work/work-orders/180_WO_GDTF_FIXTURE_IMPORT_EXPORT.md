# WO-180 — GDTF fixture import/export for pixel mapping

**Status:** Planned (research-first; implement after WO-179)
**Priority:** Low-Medium (workflow enhancement)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "can we add a gdtf import/export to work with actual fixtures?"
**Related:** WO-179 (lighting I/O — fixture model gains mirror/sampleMode there).

---

## 1. Context

Fixtures today are a HighAsCG-local model (grid cols/rows, universe, startChannel, protocol, colorOrder, brightness, rotation — `client/components/fixture-inspector.js`, `src/sampling/`). GDTF (General Device Type Format, DIN SPEC 15800) is a ZIP (`.gdtf`) containing `description.xml` (fixture type, DMX modes/channels, geometry) — the industry exchange format (MVR for whole rigs).

## 2. Tasks

- [ ] T180.1 **Research pass (report into this WO):** map the HighAsCG fixture model ↔ GDTF concepts: our grid fixture ≈ GDTF "Pixel"/matrix geometry with a DMX mode of N×RGB(W) channels; colorOrder ↔ channel functions order; what GDTF has no place for (our sampling region/rotation/mirror — those are rig placement, i.e. MVR territory, keep them HighAsCG-side). Pick a JS lib or plain zip+xml (check npm for gdtf parsers; plain `description.xml` parsing may be enough — we already depend on a zip lib? check package.json).
- [ ] T180.2 **Import:** accept a `.gdtf` upload (settings/fixtures UI), parse `description.xml`, offer the DMX modes; create a fixture with cols/rows/colorOrder derived from the matrix geometry + selected mode; user then places/sizes the sampling region as usual.
- [ ] T180.3 **Export:** generate a minimal valid `.gdtf` for a HighAsCG grid fixture (fixture type + one DMX mode with the pixel channels in colorOrder) so external consoles can patch it. Validate against GDTF schema version chosen in T180.1.
- [ ] T180.4 Smokes: round-trip (export → import) preserves cols/rows/colorOrder/channel count; import of a known real-world sample .gdtf (store a small fixture file under tools/smoke/fixtures/).

## 3. Acceptance criteria

- [ ] A180.1 A real .gdtf from a fixture vendor imports into a usable pixel-map fixture (owner tests with an actual fixture file).
- [ ] A180.2 Exported .gdtf opens in a GDTF viewer/console without errors.
- [ ] A180.3 Gates green.

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Sequenced after WO-179 (fixture model changes land first).
