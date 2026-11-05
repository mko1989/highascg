# WO-953 — Live tab: hide a screen's deck column (its destination header and all its look cards)

**Area:** godot-client
**Status: DONE (05.11.26 — Godot suite 25895/0, boot check OK; hide / show-all used in a test client (sandbox and live node, one screen each); three screens covered by the unit test) — owner QA with 2+ screens**

Owner 05.11: *"there should also be an option to hide a screen destination with all its looks in the live tab. meaning
the bottom looks cards not the preview."*

Related: [WO-781](./781_WO_look_presets_e2_destinations_and_deck_toggles.md) (the destination headers and the deck
toolbar's "Looks" toggle), [WO-905](./905_WO_live_deck_per_screen_scroll.md) (per-column scrolling).

## 1. Investigation

- The deck (`features/live/deck_view.gd` `rebuild`) builds one column per screen (`DeckModel.screen_count(cm)`), with a
  separator line between screens. Each column has:
  - the header (`deck_head.gd`): the screen title, which is also the look-preset destination toggle, then TAKE, FTB,
    timers and Border;
  - the PGM timer;
  - the look cards plus the "+" tile.
- The only view switch is the toolbar's "Looks" toggle (`live_tab.gd` `_transition_toolbar`).
  - It hides the cards of every column at once; headers stay.
  - It is stored per client in `user://ui.cfg [live] show_looks`.
  - There is no way to drop a single screen from view. With several screens (LED wall, side screens, a confidence
    feed), the columns share the width and the ones the operator does not drive take space.
- The preview on top (`live_preview.gd`) is a separate widget. The owner excludes it: only the bottom deck changes.
- Destinations (`destinations.gd`) are this client's highlight state, keyed by screen index. A hidden screen that
  stays highlighted would silently join every look-preset save.
- `deck_view.gd` is at the 500-line cap.

## 2. What was done

- **`features/live/deck_hidden.gd`** (new) holds this client's hidden screens, keyed by screen index like the
  destinations.
  - Stored in `user://ui.cfg [live] hidden_screens`, next to `show_looks`; a view setting, never project data.
  - Hiding a screen also removes it from the highlighted look-preset destinations, so a later preset save cannot
    silently cover a screen nobody sees.
  - `visible_mains(count)`, `set_hidden`, `show_all`; changes are announced as `Store.changed("ui.deck_hidden")`.
  - `note(count)`: the label the deck shows when every column is hidden.
- **`deck_view.gd` `rebuild`** builds columns only for `visible_mains`, with a separator between the shown ones. When
  all are hidden it says so and points to the toolbar. Lines were freed by merging three doc comments; the file
  stays at 500.
- **`deck_head.gd`**: an eye-off button at the end of each column header hides that column.
- **`live_tab.gd`**: a "Screens" menu in the deck toolbar, after "Looks".
  - It has a check item per screen (its label) and "Show all".
  - Its label reads "Screens · N hidden" in amber while any are hidden.
- The preview above, the shows, takes, Companion and every other client are unchanged.

## 3. Verified

- Godot suite: 25895 passed, 0 failed. New: `test_deck_hidden`.
  - Three screens; hide screen 2, then its destination highlight drops.
  - The setting is read back from the config.
  - With all hidden, the note appears; Show all brings every screen back, and that is saved too.
  - The test writes its own config file, never the client's `ui.cfg`.
- `run-client.sh --check`: boot OK.
- Test client (sandbox):
  - The header's eye-off hid the column. The deck showed "All 1 screens are hidden in this deck — show them again
    with “Screens” in the toolbar above", and the toolbar read "Screens · 1 hidden" in amber.
  - Screens → Main 1 brought the column back, with the label back to "Screens".
- The live node has one screen as well, so several columns with only some hidden has not been seen on screen; the
  unit test covers that case.

Owner QA: on a project with 2+ screens.
