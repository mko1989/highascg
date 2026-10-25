# WO-763 — Clicking a media file flickers the PGM/PRV preview tiles with other sources

**Status: IN PROGRESS (25.10) — fixed + offline-verified (smoke fails on the old allocator); node restart + owner QA pending**

Owner 25.10: "when i click a media file in sources browser its inspector shows up, but the preview screen flickers
with different sources for a split second."

## Investigation

- A file click runs `media_inspector.show_media` → `media_preview.start` (`godot/client/features/live/media_preview.gd`):
  first `stop_preview()`, which re-posts `/api/operator-gui/layout` without the `media-preview` cell, then `load`,
  which re-posts with it. So there are two layout reports per click.
- The operator-GUI channel runs in atlas mode (WO-597 §D, shm client). `src/system/operator-gui-atlas.js atlasLayout`
  kept the slots only when the set of cell ids was unchanged (`st.ids === ids`). Any cell coming or going re-ran
  `packShelves` over every cell, tallest first. The media cell (50 % × 54 %) is the tallest, so it takes the top-left and
  pushes the PGM/PRV tiles along the shelf.
- Live, 25.10 (read-only `GET /api/operator-gui/layout`) with a file selected: `pgm_1 x=0.502, prv_1 x=0.733,
  media-preview x=0`. Without the media cell a pack puts the tiles at x=0 and 0.231. So both tiles move on every click,
  twice.
- The Live tab's PGM/PRV tiles are crops of the operator surface at the broadcast slots. The client switches its crops
  on the reply / broadcast, while Caspar's frames with the new MIXER FILLs arrive frames later. In that window each tile
  crops another cell's picture: the "different sources for a split second".

## What was done

- `operator-gui-atlas.js`: incremental allocation. Cells that stay (same canvas, within the existing 25 % hysteresis)
  keep their slot. Only new or resized cells are placed, by `placeIntoFree`: first fit, top-left first, into the space
  the kept slots leave (with the gutter), scaling a new cell down to 0.5 at most. A removed cell just frees its slot.
  A full `packShelves` runs only on a new canvas or when a new cell does not fit. The client was left alone: slots that
  don't move need no client-side crop timing.

## What was VERIFIED

- `smoke-wo597-operator-gui-atlas` 7 / 0. New case: PGM/PRV slots identical with the media cell added, removed and
  added again; the media slot doesn't overlap; the next file lands in the same slot; the same report sends zero AMCP;
  a > 25 % resize moves only that cell. Run against the HEAD allocator, the new case fails ("adding the media cell
  keeps PGM / PRV") and the other 6 pass.
- eslint clean; `test:ci` 3323 / 0.
- Pending: node restart, then owner QA (click through several files with the deck visible).
