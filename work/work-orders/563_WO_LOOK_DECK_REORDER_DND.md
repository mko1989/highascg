**Status: IN PROGRESS (drag-to-reorder implemented and built; owner QA on the live box still needed)**

## Investigation

Owner ask (`work/work-orders/todos07.09.26`): reorder looks inside a main's look-deck column by
grabbing one and dragging it to a new spot, with a vertical line showing where it will drop.

Each main's looks render as `.scenes-card` elements inside a `.scenes-deck` CSS grid
(`client/components/scene-list-column.js:181` builds `grid`, the per-look loop starts at
`:200`). `sceneState.scenes` (`client/lib/scene-state.js:38`) is one flat array shared by every
main; `getScenesForMain`/`listScenesForColumn` just filter it, preserving order — so moving a
look relative to another look in the *same* main's filtered view only requires splicing it to
sit at that target look's index in the full array; every other main's filtered order is
untouched.

**Two failed attempts before the working one, both native HTML5 `draggable`:**

1. `card.draggable = true`, with a `dragstart` guard on `card` that checked
   `e.target.closest('.scenes-card__header'/'__footer')` to keep dragging off the name field and
   footer buttons, intending the thumbnail (the card's visual middle) to be the de facto handle.
   Per the DnD spec, `dragstart`'s `target` is always the "source node" (the nearest
   `draggable` ancestor-or-self) — i.e. always `card` — so `e.target.closest(...)` could never
   match anything inside header/footer; the guard was dead code. Owner reported dragging only
   worked by grabbing the edit (⚙) icon or the CUT button — never the thumbnail.
2. Moved `draggable = true` directly onto `thumbBtn` (the thumbnail `<button>`) to make the
   handle unambiguous. Owner reported this couldn't be dragged *at all*, from anywhere.

Root cause of both: the operator kiosk is **Firefox ESR** (`firefox-esr --kiosk ...
127.0.0.1:4200/?operatorGui=1`, confirmed via `ps aux`), not Chromium — this UI is not the CEF
canvas CasparCG itself renders, it's the separate control-panel kiosk. Firefox has long-standing
bugs where `draggable` does not reliably fire `dragstart` for (or from inside) a `<button>`
element; behavior differs from Chromium in exactly the way both attempts exposed.

## What was done

Dropped native HTML5 drag-and-drop entirely. `client/components/scene-list-column-reorder.js`
(new, 130 lines) now drives the reorder gesture with plain Pointer Events, which have no such
per-browser quirks:

- `handleEl.addEventListener('pointerdown', ...)` records the start point and calls
  `setPointerCapture` so the gesture keeps tracking even if the cursor leaves the button.
- `pointermove` only "arms" dragging once the pointer has moved `DRAG_THRESHOLD_PX` (5px) —
  below that, it's a normal click (send-to-preview) and never touches drag state.
- Once armed: dims the source card (`.scenes-card--dragging`), and on every move calls
  `computeDrop(e)` — `document.elementFromPoint` finds the card under the cursor *within this
  column's grid only* (cross-column drag is out of scope, matches the ask), then left/right-half
  of that card's rect decides "insert before" vs "insert after", falling back to "append at the
  end of this column" when the cursor isn't over any card (including drags into another column,
  since `elementFromPoint` won't resolve to a card this grid recognizes).
- The vertical drop-line (`.scenes-deck__drop-indicator`, absolutely positioned inside the
  `position: relative` grid) is placed at that card's left or right edge.
- `pointerup`/`pointercancel` finalize: `sceneState.reorderScene(id, insertBeforeId)`
  (`client/lib/scene-state.js:326`, new method) splices the look to sit right before the target
  in the shared array (or to the very end when `insertBeforeId` is null).
- A completed drag still fires a native `click` on the handle afterward (pointerup with no
  actual browser drag session involved) — a `suppressNextClick` flag eats exactly that one click
  so it doesn't also fire "send to preview".

`scene-list-column.js` wires `attachLookDeckReorder(grid, sceneState)` once per column and calls
`reorder.makeCardDraggable(card, thumbBtn, String(sc.id))` right after `thumbBtn` is built — the
thumbnail (the card's visual middle) is the only drag handle, matching the ask. Header (name
field) and footer (take/cut/edit/duplicate/delete) are untouched and keep their normal click
behavior; they were never wired into the reorder controller so there's no exclusion logic to get
wrong this time.

`06a2-scenes-deck-cards.css`: `.scenes-deck { position: relative }` (drop-indicator's containing
block), `.scenes-deck__drop-indicator` (3px accent bar), `.scenes-card--dragging` (opacity 0.4).

The two earlier attempts also touched `scenes-shared.js`'s `dataTransferOffersDeckMedia` (to
exclude a custom drag MIME type from the existing OS-media-drop detection) — reverted, since the
pointer-based approach never touches `DataTransfer` at all.

## What was VERIFIED

- `npm run build:client` — clean, no errors, both after the pointer-events rewrite.
- `node tools/ci/check-max-file-lines.js` — clean (only the pre-existing, unrelated
  `src/engine/scene-take-lbg.js` over 500 lines).
- `node tools/ci/run-offline-tests.js` — full suite run twice (before and after this feature);
  the only failures are 7 pre-existing, box-config-dependent operator-monitor-port /
  pointer-confine tests (`smoke-wo283-...`, `smoke-wo308-...`), unrelated to scenes/looks —
  confirmed by grep, none of those files reference `scene-list-column`, `scene-state.js`, or
  `scenes-shared`.
- Server rebuilt + kiosk reloaded (`DISPLAY=:0 xdotool key F5`) after each iteration.

Owner confirmed the Pointer Events rewrite works — dragging and dropping from the thumbnail
reorders looks correctly. One follow-up bug reported and fixed in the same session: the drop-line
kept jumping to the very end of the list whenever the cursor was in the gap between two cards
(including the gap directly between the look the owner meant to target and its neighbor).
`computeDrop` (`scene-list-column-reorder.js`) picked its target via
`document.elementFromPoint(...).closest('.scenes-card')`, which resolves to the grid element
itself — not a card — inside the `12px` grid gaps (`.scenes-deck { gap: 12px }`,
`06a2-scenes-deck-cards.css:6`); "no card under the cursor" was treated as "append at the end",
so crossing any gap flipped the proposed drop to last place. Replaced the hit-test with
nearest-card-by-distance (Euclidean distance from cursor to each card's center, scoped to this
column's cards same as before) — the gaps no longer have a distinct "no target" state, they just
resolve to whichever neighboring card is closest, so the line stays put until the cursor is
genuinely closer to a different card.

## What was VERIFIED (this round)

- `npm run build:client` — clean.
- `node tools/ci/check-max-file-lines.js` — clean (same pre-existing unrelated file over budget).
- Owner confirmed on the live kiosk: thumbnail-drag reorders looks correctly; still pending
  owner re-check that the gap-jumping fix actually reads as stable in practice (fixed via code
  reasoning + the same root cause identified from the owner's own description, not click-tested
  by the assistant).
