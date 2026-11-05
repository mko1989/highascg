# WO-959 — Test card / Border as one tick button; "Screens" lists every screen with its eye and keeps hidden ones selectable as destinations

**Area:** godot-client, mapping
**Status: DONE (05.11.26 — Godot suite 25937/0, boot check OK, GUI e2e 18 9/9 in the sandbox, live server border reply checked; owner QA)**

Owner 05.11:
- *"i should still be able to select a hidden screen destination so it can be saved with a look preset. so in live tab
  where there is a drop down in screens, it should be screens: pgm1, random, etc. with eyes next to them."*
- *"the border should have a tick box in the screens' top bar, so it can be enabled/disabled from there."*
- *"test card enable, and options should be a one button. cliking the button brings up options, clicking tick enables
  it. the same for border."*

Related: [WO-953](./953_WO_hide_screen_columns_live_deck.md) (hide a screen's column),
[WO-781](./781_WO_look_presets_e2_destinations_and_deck_toggles.md) (destinations),
[WO-629](./629_WO_led_test_card_server_side.md) (test card switch + dialog),
[WO-601](./601_WO_godot_port_inspector.md) (global border Inspector page).

## 1. Investigation

- **Hidden screens could not be destinations.** WO-953 `deck_hidden.gd` `set_hidden` called `Destinations.toggle(main)`
  when hiding, on purpose: then the only destination toggle was the column title (`deck_head.gd` `dest`), which a hidden
  column no longer shows. A preset could therefore never cover a hidden screen.
- **The "Screens" menu** (`live_tab.gd` `_screens_menu`, a `MenuButton` with one check item per screen) could only
  show or hide columns. A `PopupMenu` row has one action, so a name plus a separate eye could not fit in it.
- **Test card** (`app/header_tools.gd`) was two controls: a `CheckBox` "Test card" (POST `/api/led-test-card/master`)
  and a `Button` "Test card…" that opened `LedTestDialog`.
- **Border** (`deck_head.gd`) was a single `Button` that only opened the WO-601 Inspector page. Switching it needed
  the page's "Enabled" check, which POSTs `/api/scene/global-border {screen, enabled}`.
- `deck_view.gd` is at the 500-line cap; the header is built in `deck_head.gd` and gets `deck` (its signals).

## 2. What was done

- **`app/tick_button.gd`** (new): one framed control, `[tick][Label ▾]`.
  - The tick emits `toggled(on)` and the label emits `opened`.
  - The frame and label turn accent while it is on.
  - `set_on` follows the server without a signal; `set_busy` greys the tick while a request is in flight.
- **Test card** (`header_tools.gd`): one `TickButton("Test card")`.
  - The tick is the master switch (same request as before; it follows `ledTestPatternActive`).
  - The label opens the options dialog.
  - The separate "Test card…" button is gone.
- **Border** (`deck_head.gd`): one `TickButton("Border")` per column header.
  - The tick switches the screen's global border without opening anything.
  - The label opens the Inspector page, as the old button did.
  - A refusal shows on the deck's action line, e.g. "Border on failed: …".
- **`features/live/border_switch.gd`** (new): the tick's request, the same as the Inspector's "Enabled".
  - It adopts the reply's slot into `project.scenes.globalBorders` and announces `Store.changed("scenes.globalBorders",
    screen)`, so the deck rebuilds the header from the server's answer.
  - `global_border_panel.gd` now uses its `adopt` and listens for that announcement, so an open page re-renders after
    a tick.
  - When the page itself flips Enabled, it announces too, so the header tick follows. It only announces on an
    enabled change, so dragging a slider does not rebuild the deck.
- **`features/live/screens_menu.gd`** (new) replaces `_screens_menu`. The toolbar button opens a panel with one row
  per screen:
  - The screen's name is a destination toggle, styled like the column title (accent frame when highlighted).
  - The eye next to it shows or hides the column; it is amber `eye_off` while hidden.
  - Then "Show all".
  - The caption reads "Screens", "Screens · 1 hidden", or "Screens · 1 hidden, 1 selected" when a hidden screen would
    be covered by a preset save.
- **`deck_hidden.gd`**: hiding no longer drops the destination. Hiding is a view setting only; the highlight is managed
  in the Screens panel, and a preset recall still re-highlights its screens, hidden or not.

## 3. Verified

- **Godot suite:** 25937 passed, 0 failed (was 25920).
  - New: `test_wo959_tick_screens` covers the tick vs label signals, `set_on` without a signal, the border slot
    helpers, and the caption with a hidden destination.
  - `test_deck_hidden` now expects a hidden screen to stay highlighted.
- **Other gates:** `run-client.sh --check` boot OK. Curated offline CI 5323/0. File-line check 0 files over 500.
- **GUI e2e** `18_wo959_tick_buttons_screens` (sandbox server, hidden Xvfb): 9/9 steps passed.
  - Test card: the label opens the options dialog and does not switch the card.
  - Border: the tick sends the switch and does not open the Inspector; the label opens the Inspector page.
  - Screens: the eye hides the column, the hidden screen is made a destination from the panel, the caption reads
    "Screens · 1 hidden, 1 selected", and Show all brings the column back with the destination kept.
  - The offline sandbox's route map has 0 screens, so its server refuses the border switch ("screen out of range
    (0..0)"). The step accepts on or that visible refusal; the refusal also proves the new notice works. `--air`
    behaves the same.
- **Live server (.10), same request as the tick:** screen 1's edge-strip border went off (reply `enabled: false`,
  3 AMCP lines), then on (`enabled: true`, 8 lines). The stored slot was byte-identical to before.

Owner QA: on the glass — tick both buttons, open both option views, hide a screen and select it for a look preset.
