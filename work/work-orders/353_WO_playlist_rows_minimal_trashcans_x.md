# WO-353 — Playlist item rows: minimalism + every trashcan becomes ✕

**Status: DONE (2026-07-27)** · Source: todos27.07.26 (owner): "the playlist workflow the items
in the list have teribble spacing. the move dots are huge, then there is some rectangle,
4characters of the item name, big box for seconds. and big trashcan. minimalizm is the key. the
most importnat part is the name. change trashcans to xs. check if they appear anywhere else like
layer list."

## Row redesign (inspector-layer-playlist.js)

- Drag dots: 0.6rem, 4px margin (were default-size with 8px margins).
- The bordered placeholder rectangle for non-media items is GONE — a thumb renders only when a
  real thumbnail exists (24×14, was 32×20), and a broken thumb removes itself.
- The name owns the row (`flex: 1; min-width: 0`) — it was being squeezed to ~4 characters.
- Seconds box: 34px, no trailing "s" label (tooltip explains).
- Delete: ✕, tight padding. Row padding 4px 8px → 2px 4px.

## Trashcan sweep (repo-wide 🗑 → ✕)

- inspector-layer-playlist.js (playlist item delete)
- scene-layer-row.js — layer list remove button (the one the owner named) + preset delete
- sources-panel-media.js — folder delete
Zero 🗑 glyphs remain in client/.
