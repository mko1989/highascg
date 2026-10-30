# WO-769 — Multiview PRV cells listed the PGM look's layers (no running times); playlist drop hint never went away

**Area:** mapping, engine
**Status: IN PROGRESS (25.10) — offline-verified (smoke 4/0 + WO-212/223/250 multiview smokes, test:ci 3347/0, Godot 21760/0, boot check); multiview re-apply + owner QA pending**

Owner 25.10:
> no timers on preview screen for prv channels, the layers are displayed but not running time.
> there is a tooltip drag media here, that doesnt disappear from the playlist list.

## Investigation

1. **The server has PRV timing.**
   - `/api/osc/state` ch2 L10 (`LOOP czysty`) counted 39.58 → 0.60 → 1.62 s at 1 s intervals, `duration 40`, `_lastOscAt` current.
   - The `osc` WS broadcast (captured on `/ws`) carries the same ch2 data in full snapshots. There is no per-client
     filter (`osc-lifecycle.js:66-71`).
2. **The Godot Live tab's PRV window computes it correctly.** `compose_times_model.gd` and `deck_model.gd` were
   replayed headless on the live `/api/state`, `/api/project` and `/api/osc/state`. The result: PRV look
   `115b8888…` ("Look 3 (copy)") → `L10 LOOP CZYSTY running 21.8 / 40` and `L11 … running false`. L11 is `color`
   after a ↘ fade (WO-766), so it correctly has no time.
3. **The Caspar multiview chrome is where PRV cells go wrong.**
   - `template/multiview_master.js:114` and `template/multiview_overlay.js:131`: `getActiveScenes()` collects only
     the looks on **program** channels. Both the canvas master (`multiview_master-labels.js:3 collectLayerLines`) and
     the DOM overlay (`:268`) use it for every cell, so a PRV cell listed the *PGM* look's layers and read them from
     the PRV channel's OSC.
   - When PRV holds a different look, its rows are the wrong layers, and any layer number the PRV look doesn't play
     has no time.
   - WO-195 T195.4 fixed the PRV *layer numbering* (no bank offset) but never which look the cell reads. It went
     unnoticed while PRV mostly held the PGM look.
   - Also, `lookScreenIdx` is derived from program channels only, so a PRV look would have been filtered to screen 0.
4. On this box the multiview is not applied at the moment: ch3 is the `opgui` shm feed (route 1 + route 2, no
   chrome; `/api/multiview/debug` → null after the restart).
5. **Drop hint.** `playlist_section.gd` showed the "Drag & Drop Media Here" panel above the tree whatever the item
   count. The tree itself already accepts media drops (`_tree_can_drop` → `M.droppable`).

## What was done

- `template/multiview_master.js`, `template/multiview_overlay.js`: `getActiveScenes(isPgm, chNum)`. A PRV cell gets the
  look in `scene.live[<its preview channel>]` (nothing staged → no rows), and PGM cells are unchanged.
- `template/multiview_master-labels.js` and `multiview_overlay.js` call it with the cell kind. The screen-index filter
  applies to PGM cells only, because a PRV cell's channel is already `previewChannels[screenIdx]`
  (`multiview-apply-overlay.js:50`).
- `godot/client/features/live/playlist_section.gd`: `_drop.visible = rows.is_empty()`. The hint shows on an empty list
  only, and media dropped on the list still appends.

## What was VERIFIED

- `tools/smoke/smoke-wo769-mv-prv-cell-look.test.js` 4/4 (added to the curated list). It runs both templates'
  `getActiveScenes` on a PGM look-4 / PRV look-3 map: PGM → look-4, PRV → look-3, empty PRV → none. It also checks
  that the callers pass the cell kind, the PGM-only screen filter, and the drop hint rule.
- WO-212 / WO-223 / WO-250 multiview smokes still pass (29/29 with the new file).
- `npm run test:ci` 3347 pass / 0 fail, Godot 21760/0, boot check OK, 500-line check 0 over.
- Caspar's `template-path` is `template/` in the repo (`config/casparcg.config:6`), so the files are live. The chrome
  only reloads on the next **Multiview → Apply**.
- **Pending (owner):** Apply the multiview with a different look on PRV and check the PRV cell's rows and times. If the
  screen meant was the Live tab's PRV window instead, say so: its model computes PRV times correctly on live data
  (item 2), so that would be a drawing issue, not data.
