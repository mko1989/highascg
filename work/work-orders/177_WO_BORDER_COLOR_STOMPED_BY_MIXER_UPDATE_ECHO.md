# WO-177 — Border color changes don't stick: mixer_update WS echo stomps pipOverlays (and friends)

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium-High (edits visibly revert — operator distrust)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "color changes of borders (only observed) doesn't 'stick', get defaulted asap."
**Related:** WO-25 (PIP overlays), WO-09/43 (global border), WO-158 (crop→overlay push).

---

## 1. Root cause (investigated 2026-07-13)

- Edit flow: color input (`inspector-pip-overlay.js:170-172`) → `inspector-scene-layer.js:241-242` patches `layer.pipOverlays` → `scene-state-layer-logic.js:130` `Object.assign(L, rest)`. Correct so far.
- **The stomp:** the `mixer_update` WS handler (`client/lib/app-ws-handlers.js:138-162`) applies every key of the server echo onto the layer: `:153-157` `for (const [k,v] of Object.entries(updatedValues)) { if (!fillProps.includes(k)) L[k] = v }` — only fill props are excluded. A server echo carrying the **pre-edit** `pipOverlays` lands right after the local patch and reverts it; the inspector re-render then shows `schema.default` (`inspector-pip-overlay.js:166`).
- Color is simply the field where the race is most visible (frequent live pushes while editing); the same handler can stomp `effects`, `globalBorder`, `source`, `transition` on any layer the server echoes.
- Precedent for edit-protection exists: `scene-state-global-border.js:260-261` uses a recent-edit timestamp guard.

## 2. Tasks (haiku-sized)

- [x] T177.1 **Whitelist, not blacklist:** read what the server actually sends in `mixer_update` (find the emitter: grep src/ for `mixer_update`) and change the handler (`app-ws-handlers.js:153-157`) to apply ONLY the mixer-owned keys the server legitimately updates (opacity/volume/rotation/keyer/etc. per the emitter) — never structural layer fields (`pipOverlays`, `effects`, `source`, `globalBorder`, `transition`, `audioRoute`…). Document the whitelist inline with a pointer to the emitter.
- [x] T177.2 **Recent-edit guard (belt and braces):** skip applying an echoed key when the layer was locally patched within the last ~1.5 s (reuse the `scene-state-global-border.js:260` timestamp pattern; a per-layer `_localEditAt` set in `patchLayer`).
- [x] T177.3 Smoke: simulate the handler with a fixture layer — local pipOverlays color edit + incoming mixer_update echo with old pipOverlays → color survives; a legit opacity echo still applies.
- [ ] T177.4 Manual QA note: change border color while the layer is on air → color persists through the next WS echo; global border color likewise.

## 3. Acceptance criteria

- [ ] A177.1 Border (PIP + global) color edits persist (operator check after restart+reload).
- [ ] A177.2 Mixer echoes (opacity/volume from other clients/server) still sync as before (smoke).
- [ ] A177.3 Gates green.

## 4. Work log

- 2026-07-13 — WO created. Root cause: mixer_update WS handler blanket-applies echo keys onto the layer, reverting just-edited structural fields; fix = whitelist mixer-owned keys + recent-local-edit guard.
- 2026-07-13 — T177.1/T177.2/T177.3 implemented:
  - **Emitter key list:** mixer_update from src/api/routes-mixer-inspector.js:213 sends only: `opacity`, `x`, `y`, `scaleX`, `scaleY` (no structural fields). Whitelist applied.
  - **Storage decision:** Used WeakMap in scene-state-layer-logic.js (zero serialization risk, cleanest approach).
  - **T177.1:** app-ws-handlers.js:138-168 now applies ONLY whitelisted keys; non-mixer fields (pipOverlays, effects, globalBorder, transition, source, audioRoute) never touched.
  - **T177.2:** patchLayer() records Date.now() in WeakMap; handler checks isLayerRecentlyEdited(layer, 1500ms) before applying any key (fill props included).
  - **T177.3:** smoke-wo177-mixer-update-whitelist.test.js: 6 tests pass — local color edit survives echo, opacity echo applies when safe, echo skipped in guard window, fill props protected, non-whitelisted keys never applied.
  - **Verification:** node --check + eslint --quiet pass; smoke-preview-snapshot-restart.test.js still green.
