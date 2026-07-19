# WO-271 — Stale route:// channels after channel-map shifts (MV editor black holes)

**Status:** Implemented (owner acceptance A271.1 pending — needs node restart + client rebuild)
**Priority:** HIGH (owner report 2026-07-18: "in the multiview editor i cant see the caspar windows underneath the operator gui")

## Root cause (live-proven 2026-07-18)
- Caspar log 17:27: the mv-editor holes played `PLAY 5-10 route://5` — the operator-GUI channel routed INTO ITSELF (black), and the multiview output played `PLAY 4-14 route://5-4`.
- The live channel map says DeckLink input 4 = **channel 6** (`inputChannels: {kind:'decklink', slot:4, channel:6, layer:4, route:'route://6-4'}`), but `config/general.json extraLiveSources[0].value` = `route://5-4` and the persisted `multiviewLayout` DeckLink cell carries the same string — both COPIED when the input lived on ch5, before the WO-243 operator_gui channel was inserted at index 5 and shifted every host channel up.
- Three consumers replayed the stale copy: (1) `routeForCell` (`src/engine/multiview-layout-helper.js:30`) returns `cell.source` verbatim — its own DeckLink remap branch (lines 43-63, clearly written for exactly this) was **unreachable dead code** behind that early return; (2) the mv-editor (`client/components/multiview-editor.js:159`) parses the same string into `srcCh` for the operator-GUI holes; (3) anything else consuming `extraLiveSources[].value`. The client-side `reconcileExtraLiveSourceChannel` (planned-channel-map.js) already heals rows in the sources panels — the multiview path never used it.

## Fix — heal the data at the source, belts at both consumers
- **T271.1 `src/config/live-source-route-heal.js`** (new): identity-based re-resolution against `getChannelMap().inputChannels` (single source of truth). `healExtraLiveSourceChannels(config)` rewrites `value`/`inputsChannel`/`inputsLayer`/`thumbnail*` by `decklinkSlot`/`liveAudioSlot`/`v4l2Slot`/`sourceId`/label; `healPersistedMultiviewLayouts(ctx)` walks persistence keys `multiviewLayout[_n]` + in-memory mirrors and heals stale cell sources (`healMultiviewCellSource`: only touches routes whose channel is NOT in the current known set; resolves decklink by id/label/layer-slot, others by label).
- **T271.2 boot/reconnect wiring** (`routing-setup.js` `setupAllRouting`, beside the WO-268 clear): heal config (+ persist via configManager when changed) and persisted layouts BEFORE `reapplyAllMultiviewLayouts`/`setupHostLiveSources` replay them. Every heal is logged (`[route-heal] …`).
- **T271.3 server belt**: `routeForCell` calls `healMultiviewCellSource` FIRST — the formerly-dead remap intent now runs even for un-healed bodies (e.g. an apply straight from a stale client).
- **T271.4 client belt**: `resolveMvCellSourceChannel(cell, parsed, cm)` in `client/lib/input-channels.js` (mirrors the server heal); `reportMvRect` uses it — a stale-but-resolvable route heals, an unresolvable one gets NO hole (canvas box stays) instead of routing a wrong channel into the operator GUI.
- **T271.5 smokes** (`tools/smoke/smoke-wo271-route-heal.test.js`, curated gate): heal matrix against a fixture config (stale decklink → healed; valid routes untouched; ndi label-match; unresolvable → null), `routeForCell` heals before verbatim, routing-setup wiring + client usage source asserts. Verified against the LIVE box config in-session: `route://5-4 → route://6-4`, NDI/webpage/PGM untouched.

## Constraints (standard)
Curated gate ONLY, node --check + repo eslint, <500 lines/file, honest checkboxes. Client changes need `npm run build:client`. The config heal mutates + persists `extraLiveSources` at boot — logged, identity-based, no-ops when nothing is stale.

- [x] T271.1 heal module (config sources + persisted layouts)
- [x] T271.2 boot/reconnect wiring with logging + persist
- [x] T271.3 routeForCell heals first (dead remap replaced)
- [x] T271.4 client resolveMvCellSourceChannel in reportMvRect
- [x] T271.5 smokes in curated gate (+ live dry-run evidence)
- [ ] A271.1 (owner) after node restart + rebuild: highascg log shows `[route-heal] extraLiveSources re-pointed: "DeckLink 4": route://5-4 → route://6-4` once; multiview OUTPUT DeckLink cell shows video again; mv-editor holes show PGM/PRV/DeckLink video under the GUI; dragging cells keeps video following

## Work log

**2026-07-18 — implemented.** Live dry-run on the box's real config confirms the exact heal (`5-4 → 6-4`, everything else untouched) and `routeForCell` end-to-end returns `route://6-4` for the stale persisted cell. NOTE: the same stale-copy class likely exists anywhere else route strings are persisted (scene look layers dragged from sources keep `source.value` copies — NOT healed here; if a look's DeckLink layer is black after a future channel-map change, extend the heal to project scenes — candidate follow-up WO).
