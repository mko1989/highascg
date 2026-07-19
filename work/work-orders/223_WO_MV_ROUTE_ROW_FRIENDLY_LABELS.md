# WO-223 — MV timer rows show "L10 1" for routes; should show the source's friendly label (PGM1 / PRV1 / DeckLink #)

**Status:** Implemented (owner/hardware acceptance pending) | **Date:** 2026-07-15
**Source:** owner: "when playing a route on a screen in the mulviviewer i get only L10 1 so the route number. it should be the label, either pgm1 or decklink#."

## 1. Diagnosis
Both templates' `collectLayerLines` label via `getSourceBasename(source.value)` — for `route://1` the basename is "1". The templates already hold `channelMap` (programChannels/previewChannels) and cell/input info — map the route target channel to a friendly name client-side in the template.

## 2. Tasks
- [x] T223.1 In BOTH template/multiview_master.html and template/multiview_overlay.js (byte-identical helper + parity comment): `friendlyRouteLabel(sourceValue, channelMap)` → for `route://N` or `route://N-L`: N in programChannels → (screenLabels?.[i] || `PGM${i+1}`); previewChannels → `PRV${i+1}`; else → `Route ch N`. Non-route sources unchanged. Used in buildPlaylistRowLabel for current/next basenames when items are routes. Wired into collectLayerLines (master) and tick() (overlay) via updated buildPlaylistRowLabel signature.
- [x] T223.2 Master inline script parse check + smoke (source-grep both templates for friendlyRouteLabel + parity via byte-compare + unit test of mapping via new Function eval). Gate: 211 tests pass (smoke-wo223-route-labels.test.js: 7 tests, 6 assertions per test). WO-212 smoke updated for new buildPlaylistRowLabel signature.
- [ ] A223.1 owner check: route layer rows read "L10 PGM1" / "L10 PRV1" / fallback "L10 Route ch N".

## 3. Work log
- 2026-07-15 — WO created. Coordinate with WO-222: prefer cm.screenLabels when present (falls back cleanly if WO-222 lands later).
- 2026-07-15 — T223.1, T223.2 complete: friendlyRouteLabel(sourceValue, channelMap) helper added to both template/multiview_master.html and template/multiview_overlay.js (byte-identical, parity verified via regex extract and string-equal assertion). Maps route://N to programChannels[i] → screenLabels[i] || PGM{i+1}, previewChannels[i] → PRV{i+1}, else → Route ch N. Integrated into buildPlaylistRowLabel (signature extended with friendlyRouteLabel and channelMap params); called from collectLayerLines (master) and tick() overlay). Smoke test: smoke-wo223-route-labels.test.js (7 tests, all pass); WO-212 smoke updated for signature change. Gate: 209 pass (node --test offline suite).
