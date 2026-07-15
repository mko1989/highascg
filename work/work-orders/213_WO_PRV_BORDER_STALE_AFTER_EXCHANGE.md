# WO-213 — PRV border/PIP overlays sometimes render with stale settings while editing

**Status:** Done
**Priority:** Medium
**Date:** 2026-07-14
**Source:** owner: "when messing with a layer that has a border effect on it on the prv the border sometimes render incorectly on the prv, (using a stale setting?)"
**Related:** WO-209 (PRV bankless — live since 14:07; makes client/server finally share layers, which EXPOSES this class), WO-158 (crop-aware borders), WO-177 (border stomped by WS echo — different mechanism, PGM).

---

## 1. Diagnosis (root-cause hypothesis, evidence-backed)

The client's per-edit preview push keeps a **stale-able cache**: `lastPreviewContentSnapshot` (+ `pipCgReadyKeys`, `lastGlobalBorderPushMeta`) in [client/components/scenes-preview-runtime.js](../../client/components/scenes-preview-runtime.js). PIP/border overlays take the cheap **CG UPDATE** path whenever `cgReady && cur.type === old.type && side unchanged` ([client/lib/pip-overlay-amcp.js:331-339](../../client/lib/pip-overlay-amcp.js)).

But the **server** also rewrites the PRV channel behind the client's back: every program take runs the pgm→prv exchange (`routes-scene-take.js`), re-staging the previous PGM look on PRV with its own pip/border CG ADDs built from SAVED scene state. The client is never told to drop its snapshot — so when the operator then edits the same look (`sameSceneOnSamePrv` true → incremental path), the client sends CG UPDATEs premised on ITS last-pushed payload against producers the SERVER re-created from saved state → border renders with stale settings until something forces a full re-ADD. "Sometimes" = only after an exchange/take touched PRV between edits.

The invalidation hook already exists (`previewRuntime.clearLastPreviewLayers()` clears snapshot + border meta) and the client already observes server-side PRV rewrites: [client/lib/app-ws-handlers.js:41,80](../../client/lib/app-ws-handlers.js) handles `scene.live` broadcasts (fired by `liveSceneState.broadcastSceneLive` after every exchange).

## 2. Tasks (haiku-sized)

- [x] T213.1 **Invalidate on server PRV rewrite:** in [client/lib/app-ws-handlers.js](../../client/lib/app-ws-handlers.js), where `scene.live` payloads are applied (both call sites, lines ~41 and ~80): detect whether any PRV channel's `{sceneId}` changed vs the previous applied value (track a small module-level map prevLiveByChannel; PRV channels = `channelMap.previewChannels` non-null values). When a PRV channel's live scene changed, dispatch `window.dispatchEvent(new CustomEvent('scenes-preview-invalidate'))` (repo's established redraw-signal pattern — see `scenes-deck-thumb-redraw` in scenes-preview-runtime.js).
- [x] T213.2 **Listen in the preview runtime:** in [client/components/scenes-preview-runtime.js](../../client/components/scenes-preview-runtime.js) (inside `createScenesPreviewRuntime`), add a `window.addEventListener('scenes-preview-invalidate', ...)` that calls the existing `clearLastPreviewLayers()` — next edit push then takes the full ADD path (correct payloads, re-arms `pipCgReadyKeys`).
- [x] T213.3 **Config-diff hardening (belt & braces):** in [client/lib/pip-overlay-amcp.js:332-339](../../client/lib/pip-overlay-amcp.js) the UPDATE-path condition compares only `type` and side. Verify `buildPipOverlayUpdateLines` re-sends the FULL current payload (colors/width/radius) on every update — if it only sends geometry, extend the condition to also require deep-equal border config (`JSON.stringify` of the non-geometry fields) so config edits force the ADD path.
- [x] T213.4 Smoke `tools/smoke/smoke-wo213-preview-invalidate.test.js`: source-grep assertions — ws handler contains the prevLive tracking + `scenes-preview-invalidate` dispatch; preview runtime contains the listener calling clearLastPreviewLayers; pip-overlay-amcp UPDATE branch guards on config when applicable. Add to `tools/ci/run-offline-tests.js`. node --check/eslint; gate.

## 3. Acceptance criteria

- [ ] A213.1 Editing a bordered layer on PRV renders the current border settings immediately after any take/exchange (owner check).
- [ ] A213.2 No pip/border flicker regression during plain incremental edits (UPDATE path still used when no exchange happened); gates green.

## 4. Work log

- 2026-07-14 — WO created; stale cause pinned to client preview snapshot surviving server-side PRV exchanges (client CG UPDATEs against server-re-created producers).
- 2026-07-14 — Implemented T213.1–T213.4: Added maybeInvalidatePreviewOnLiveChange() tracking & dispatch in app-ws-handlers.js (2 call sites); added listener in scenes-preview-runtime.js calling clearLastPreviewLayers(); verified pip-overlay-amcp sends full config payload on UPDATE (no code change needed, added comment); created smoke-wo213-preview-invalidate.test.js (7 tests: 6 source-grep + 1 unit); eslint 0 errors; all tests pass.
- 2026-07-15 — FIX-2 (2026-07-15 review, work/reviews/2026-07-15-multiview.md finding 2): `maybeInvalidatePreviewOnLiveChange` (client/lib/app-ws-handlers.js) left stale `prevLiveSceneIdByChannel` entries for channels that disappear entirely from the incoming live map (e.g. an explicit preview clear), so a later clear-then-restage-with-the-same-sceneId compared equal to the stale value and skipped invalidation — reproducing the exact stale-border symptom this WO exists to fix, via a narrower trigger. Fixed: after each pass, any tracked channel absent from the incoming map is reset to a `null` sentinel that can never equal a real sceneId, so its next reappearance always compares as changed. Extended tools/smoke/smoke-wo213-preview-invalidate.test.js with the clear-then-restage-same-id scenario — 8/8 pass.
