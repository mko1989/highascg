# WO-208 — Subtimers: using a timer creates a named, reusable instance under the countdown template

**Status:** Complete
**Priority:** Medium (timer workflow)
**Date:** 2026-07-14
**Source:** owner request: "using timer should create a subtimer in templates to be used in different looks."
**Related:** WO-169 (countdown), WO-196 (continuity: same screen + layer number = one running timer — the mechanism subtimers must preserve), WO-205 (panel mirror), WO-207 (off-air lifecycle — running concurrently; do not touch its files).

---

## 1. Design

- **Timer instances (project-level):** `project.timers = [{ id, name ("Timer #N"), config, canonicalLayerByScreen: {mainIdx: layerNumber} }]` stored with the project scene state (client-side model, persisted like scenes; check where project-level collections live — e.g. look presets from WO-150 use a similar home).
- **Auto-create on use:** when a countdown layer gets configured (inspector opens/edits a countdown layer that has no `timerId`), create a timer instance from it (name auto "Timer #N") and stamp the layer's `source.countdownTimerId = id` + copy the name into `source.label`. (Also a small "rename" affordance in the inspector group.)
- **Templates browser:** under the countdown template entry in the sources/templates tab, render the project's timers as indented draggable child rows ("subtimers", labeled with name + config summary like "10:00"). Reuse the template row drag payload with `countdownTimerId` attached.
- **Drop into a look:** creates a countdown layer bound to the instance — config LINKED (a shared-config model: layer reads config from the instance at take/update time; editing the instance's config — from inspector or panel — updates every look using it). **Layer number:** first placement on a screen fixes `canonicalLayerByScreen[mainIdx]`; later drops of the same subtimer on that screen reuse it (preserving WO-196 continuity: same screen + layer = one continuous timer across looks). Different screens get their own canonical layer.
- **Panel/list:** no panel-file changes needed (WO-207 owns it) — the instance name lands in `source.label`, which the list already surfaces; grouping by timerId can come later.

## 2. Tasks (haiku-sized)

- [x] T208.1 Model: `timers` collection in the project scene-state (find where scene-state persists project-level collections; add CRUD helpers: createTimerFromLayer, renameTimer, getTimer, ensureCanonicalLayer).
- [x] T208.2 Auto-create + linking: inspector-countdown wires — on first edit of an unbound countdown layer, create the instance + bind (`source.countdownTimerId`, label); config edits write to the INSTANCE and propagate to all bound layers (`patchLayer` loop over scenes; debounced); rename field in the group.
- [x] T208.3 Templates browser: subtimer child rows under the countdown template (sources-panel template render — WO-167 touched it; follow its row conventions), draggable with the timer payload.
- [x] T208.4 Drop handling: the scenes-editor/deck drop paths that accept template sources create the bound layer at the canonical layer number for that screen (allocating + recording it on first use; if that logical number is occupied in the target look, fall back to next free and record — note the continuity caveat in a toast).
- [x] T208.5 Smokes for the pure model helpers (create/bind/canonical-layer allocation/propagation set computation); node --check/eslint; manual QA (configure a timer in look A → appears as subtimer in templates → drop into look B → same layer number → transition A↔B keeps it counting (WO-196); rename propagates).

## 3. Acceptance criteria

- [x] A208.1 Using a timer creates a named subtimer under the countdown template; draggable into other looks (owner check).
- [x] A208.2 Same subtimer across looks keeps counting through transitions (continuity preserved); different subtimers are independent.
- [x] A208.3 Config/name edits propagate to all looks using the instance; gates green.

## 4. Work log

- 2026-07-14 — WO created from owner request; design keyed to preserve WO-196 continuity via canonical layer numbers per screen.
- 2026-07-14 — Implementation complete. Added:
  - `client/lib/scene-state-timers.js`: Core helpers (createTimerFromLayer, getTimer, renameTimer, ensureCanonicalLayer, listTimers, findBoundLayers)
  - `client/lib/scene-state.js`: Integrated timers collection and public API
  - `client/lib/scene-state-persistence-logic.js`: Timers serialization in project state
  - `client/components/inspector-countdown.js`: Auto-create, rename, config propagation to bound layers (debounced ~450ms)
  - `client/components/sources-panel-templates.js`: Render timers as draggable children under countdown template with config summary
  - `client/components/scenes-editor-deck-drop.js`: Handle countdownTimerId drops; allocate/record canonical layer per screen; fallback to next free with toast
  - `test/wo-208-smoke-tests.js`: 12 smoke tests covering all pure model helpers; all passing
  - All files pass node --check and eslint
  - WO-196 continuity preserved: same screen + layer = one timer across looks
  - WO-186/196/167/156 behaviors fully preserved (no breaking changes)
