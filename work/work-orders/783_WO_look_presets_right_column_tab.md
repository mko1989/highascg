# WO-783 — Look presets as a tab of the right-hand column (Inspector | Look presets)

**Status: DONE (26.10 — Godot 21884 tests, boot check, off-screen client screenshot of the tab against the live server; owner QA = the tab on the panel)**

Owner, 26.10 (after WO-781 / WO-782):
> looks presets should be another tab on the right hand side, inspector tab and looks presets

Parents: [WO-781](./781_WO_look_presets_e2_destinations_and_deck_toggles.md) (E2 destinations, preset strip, Looks /
Presets toggles), [WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md) R2 (one right-hand column, content follows the selection).

## Investigation

- WO-781 put look presets in **two** places:
  - a card strip above the deck columns (`features/live/look_preset_strip.gd`, added to the live tab's `bottom` in
    `live_tab.gd:93`), shown or hidden by the deck toolbar's "Presets" toggle (`live_tab.gd:315`, `[live]
    show_presets` in `ui.cfg`);
  - an Inspector *page* (`look_preset_page.gd`, presented through `InspectorPanel.current.present()` from the strip's
    ⚙). It holds the save buttons and a "Library" of the same presets with Preview / Auto / Cut / Overwrite / Remove.
- The right-hand column (`app/inspector_panel.gd`) is one titled pane ("Inspector"). Its pages follow the selection,
  plus a footer (Playlists, WO-603). There is no tab mechanism. A preset page presented there is hidden again by the
  next selection, so the presets never stay at hand.
- The owner's layout: the right column has two tabs, **Inspector** (selection pages, unchanged) and **Look presets**
  (always available, independent of the selection). Inside the tab, the deck strip and the Library merge into one list.
  The deck strip and its "Presets" toggle go away. The "Looks" toggle stays (it hides the look cards in the columns).

## What was done

- **`app/inspector_panel.gd`**: the "Inspector" title became a tab row.
  - `add_tab(title, pane)` adds a scrolled pane. It stays owned by the feature, like a page, and does not take the
    column over when added.
  - `show_tab(i)` / `tab_shown()`. The active title is white with an accent underline, the others muted (WO-668).
  - `present()` (a new selection) brings the Inspector tab back, so a click on a look / layer / timer still shows its
    page (R2: content follows the selection).
  - The Playlists footer stays under every tab.
- **`features/live/look_preset_page.gd`** is the tab: hint, "Destinations: 1, 2", From PRV / From PGM / From open look,
  the preset cards, and the status line.
  - The page's own title / ✕ / `open()` / `closed` and its "Library" list are gone; one list now does both jobs.
  - Remove moved to `confirm_remove()`.
- **`features/live/look_preset_strip.gd`** is now that list (an HFlowContainer, two 170 px cards per row in the 400 px
  column).
  - Click = PRV, ▶ = take, and a ⋯ menu holds the Library's Auto / Cut / Overwrite / Remove.
  - The header, ⚙ and "+" tile are gone; the save buttons sit above the cards.
  - The menu actions are an array of callables: a `match` inside a multi-line lambda is a GDScript parse error,
    caught by the boot check.
- **`features/live/live_tab.gd`**: no strip in the card section and no "Presets" toggle. "Looks" stays, still in
  `ui.cfg` as `show_looks`; a stale `show_presets` key is ignored. The page is registered with
  `InspectorPanel.current.add_tab("Look presets", presets)`. It is shared by every tab of the workspace, like the
  Inspector.
- `app/preset_e2_probe.gd` switches to the tab before its screenshots. The WO-781 smoke pin follows the move
  (`for k in ["looks"]`, plus `add_tab("Look presets", presets)`).

## Verified

- Godot tests 21884 passed, 0 failed, including the new `test_inspector_panel::test_tabs_and_selection`:
  - adding a tab keeps the Inspector shown;
  - `show_tab(1)` hides the Inspector pane;
  - `present()` returns to tab 0 with its page.
- `run-client.sh --check`: boot OK. It caught the `match`-in-lambda parse error on the first try; the suite cannot,
  because without autoloads every Store-using script fails to compile there.
- Offline suite 3380 tests, 0 fail. Prettier OK; no file over 500 lines.
- Off-screen client (`--probe-e2-presets`, 18:16) against the live server:
  - The screenshot shows the right column's "Inspector | Look presets" tabs, with the hint, "Destinations: 1, 2", the
    save buttons and four cards (the owner's "loop" / "intro" plus the two probe presets).
  - Card marks: red = on PGM, green = "probe PRV" on PRV. Each card has ▶ and ⋯.
  - The card section has no strip and only the "Looks" toggle.
  - The PGM and PRV recalls ran from the tab; the buses ended as found. The probe presets were removed, and "loop" /
    "intro" were kept.
- Owner QA: the tab on the panel, plus the ⋯ menu (Auto / Cut / Overwrite / Remove) with the mouse. The probe drives
  the page API, not the menu clicks.
