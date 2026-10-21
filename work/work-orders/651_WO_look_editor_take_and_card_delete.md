**Status: DONE (2026-10-21; Godot 20694/0, box: editor TAKE → take-look 200 "TAKE ok"; card ✕ → "Delete look" confirm, Cancel keeps the look)**

# WO-651 — Look editor TAKE button; a ✕ on the look card above the ⚙

Owner, 21.10: *"there should be a take button on top of the looks editor."* · *"there should be an "x" to remove a
look. on top of the cog."*

## Investigation

- `features/live/live_tab.gd:100` (WO-621 N5): an open look editor hides the deck, its action line and the bar that
  holds the deck's **TAKE**. While editing, there was no way to take the look; the editor only stages it on PRV
  (`preview_pusher.gd`).
- The editor head (`look_editor.gd _ready`) held only the title and **Close**.
- Deleting a look existed only in the card's right-click menu ("Delete look…" → `deck_view.gd _confirm_delete` →
  `delete_look`, WO-623 B: removes the look, clears its fixture look, closes an editor showing it). The card footer
  is ▶ take · ⚙ edit (WO-621 N4).
- `assets/ui/icons/close.svg` (the ✕ of the playlist rows) already exists.

## What was done

- `look_editor.gd`:
  - **TAKE** in the head, before Close. It flushes the deck sync (an edit still inside the push debounce reaches the
    server first) and emits `take_requested(scene_id, main)`;
  - `show_status(text)`.
- `live_tab.gd`:
  - `take_requested` → `deck.request_take(id, main, "program")`, the same take-look call the deck's TAKE and a card
    double-click use;
  - the deck's `action_result` is also shown in the editor status while the editor is open, because the deck's own
    action line is hidden then.
- `deck_view.gd _card`: a ✕ (`close` icon, 12 px) in the thumbnail's top-right corner, straight above the ⚙. It opens
  the existing confirm, `Delete look "…"?` (the web's text), so a stray click on a live show cannot drop a look.

## What was VERIFIED

- Godot `--test` 20694 passed, 0 failed; `--check` boot OK. No unit test: the deck and editor use the Store / Api
  autoloads.
- Box (21.10, 21:08–21:09, DP-0, Look 1):
  - The card shows the ✕ in the thumbnail corner above the ⚙.
  - ⚙ opens the editor with **TAKE** | Close at the top right.
  - TAKE: client log `take-look program 27d60abc… → 200`, and the editor status reads "TAKE ok".
  - ✕ (after closing the editor) opens "Delete look "Look 1"?". Cancel → `/api/project` still lists Look 1.
- Not done: OK on the dialog (it would delete the owner's only look). The path behind it is the menu's
  `delete_look`, unchanged.
