# WO-781 — Look presets as on a Barco E2: highlight destinations, save, recall exactly; show / hide look cards

**Area:** engine, godot-client
**Status: DONE (26.10 — Godot 21877 tests, WO-781 smokes, off-screen client probe of highlight → save → recall → clear → hide looks against the live server; owner QA = real E2 workflow)**

Owner, 26.10:
> look presets are meant to work like in a professional presentation switcher like a barco e2. each destination can be
> highlighted for look preset save, and then it is loaded exactly the same.
> we also need a way to show or dont show the looks cards in the card section.

Parents: [WO-601](./601_WO_godot_port_inspector.md) §Look presets (Godot page + server recall),
[WO_look-and-layer-presets](./851_WO_look_and_layer_presets.md) (original design: "screen-management style", Barco named).

## Investigation

- **Godot today** (`features/live/look_preset_page.gd`, `look_preset_model.gd`): the page opens from one deck
  column's "Presets" button and saves that screen only, or every screen through an "All screens" checkbox (2+
  screens). It cannot save a chosen subset (e.g. screens 1 + 3 of 4).
- **Empty destinations are dropped.** `capture_items` skips a screen with nothing on the bus, and the server's
  `recallItems` (`src/api/routes-scene-look-preset.js`) drops items without a look. A preset saved while screen 2's PRV
  was empty therefore leaves whatever is on screen 2 untouched at recall. That is not "loaded exactly the same".
- **Same look on PRV and PGM reads as an empty PRV.** `DeckModel.resolve_bus_look_ids` blanks `prv` when it equals
  `pgm` (`deck_model.gd:47`, so the deck does not mark one card twice). "From PRV" on such a screen captured nothing.
- **Recall is per-look reference**: items `{mainIdx, sceneId}` go through `handleTakeLook` together (one batch,
  WO-150 B150.6). A preset follows later edits of its looks. Kept on purpose:
  - the look is the content unit;
  - the deck's TAKE takes the look on PRV by id;
  - a frozen copy would make PRV → TAKE pick up the edited look rather than the recalled one.
- **The card section** (`deck_view.gd`) shows one column of look cards per screen, with no way to hide them. Presets
  are reachable only through the Inspector page, not as cards.

## Plan

1. **Destinations** (`destinations.gd`, client-side like the E2's destination buttons): a click on a deck column's
   title highlights or unhighlights that screen. Save captures exactly the highlighted screens. Empty ones are kept
   as `{mainIdx, empty: true}`. Recall re-highlights the preset's screens.
2. **Exact recall**: the server keeps empty items. PRV recall clears that screen's PRV; PGM recall fades it to black
   (deck FTB timing; a cut = 0 frames). The web client ignores `empty` items, so the data stays compatible.
3. **Card section**: a preset strip above the screen columns. Each card shows its destinations: a click loads it to
   PRV, ▶ takes it, ⚙ opens the Inspector page, and a "+" tile saves the highlighted destinations from PRV. Deck
   toolbar toggles **Looks** / **Presets** show or hide each kind of card. They are stored in ui.cfg, as this
   client's view.

## What was done

- **`godot/client/features/live/destinations.gd`** (new): this client's highlighted screens (static, not project
  data: two operators may highlight different screens, as on two E2 consoles). `toggle` / `set_only` / `prune` announce
  through `Store.changed("ui.destinations")`.
- **`deck_head.gd`** (new, split out of `deck_view.gd`, 477 lines): the column header. The title is now a toggle
  button ("Dioda · 5 looks"), with an accent border when highlighted. TAKE / FTB / timers / Border are unchanged. The
  per-column "Presets" button is gone: one preset list serves all destinations.
- **`look_preset_model.gd`**:
  - `capture_items(..., keep_empty)` saves an empty destination as `{mainIdx, sceneId: "", empty: true}`.
  - `capture_buses` un-blanks a PRV that shows the PGM look.
  - `dest_line` builds the card line ("1 Look 2 · 2 —").
  - `loaded_on_bus` treats an empty item as matching an empty bus.
  - The legacy single-look fields come from the first item that holds a look (web compatibility).
- **`look_preset_page.gd`** (Inspector page):
  - Saves capture `Destinations.selected()` from `true_buses()` (the raw PRV, so "From PRV" works when PRV = PGM).
  - Card marks use those same buses. The first probe showed an all-empty preset lit green while both PRVs held the
    PGM looks, because the deck's blanked view read them as empty.
  - A recall re-highlights the preset's screens.
  - The screen / "All screens" picker is gone, and `said` relays results to the deck status line.
- **`look_preset_strip.gd`** (new): preset cards above the screen columns.
  - A click loads to PRV and ▶ takes to PGM. Red = on PGM, green = on PRV.
  - "+" saves the highlighted PRVs; it is disabled until a destination is highlighted. ⚙ opens the Inspector page.
- **`live_tab.gd`**: toolbar toggles **Looks** / **Presets**. Looks sets `deck.show_looks` (the column grids);
  Presets sets the strip's visibility. Both are stored as `[live] show_looks / show_presets` in `user://ui.cfg`.
  Editor / Shader Live still hide the strip and respect the toggle when they close.
- **`src/api/routes-scene-look-preset.js`**: `recallItems` keeps `empty` items. Their recall calls `clearDestination`:
  - PRV: `handlePreviewLiveClear` (the deck's blank-click clear).
  - PGM: `/api/ftb`, with 0.5 s at the channel rate, or 0 frames for Cut (the deck FTB path).
  - Looks still recall together (WO-150 batch).
- *Superseded by [WO-782](./782_WO_look_preset_recall_one_play_batch.md):* the PGM empty-destination path no longer
  calls `/api/ftb`. That path faded the screen's PRV too and turned a Cut into 25 frames. The fade now rides the
  recall's single PLAY batch.
- Presets stay **references** to looks, not frozen copies (see Investigation): look edits reach the preset, and the
  deck's TAKE takes what was recalled.
- `app/main.gd`: the probe hooks are now one table (500-line cap), plus the new `--probe-e2-presets=<png prefix>`
  (`app/preset_e2_probe.gd`).
- The web client is unchanged. It skips `empty` items (no `sceneId`), so presets saved from Godot still recall their
  looks there.

## Verified

- Godot `tests/run_tests.gd`: **21877 passed, 0 failed** (new `test_e2_destinations`: keep_empty, legacy fields,
  dest_line, capture_buses, loaded_on_bus empty match, toggle / set_only / prune). `run-client.sh --check`: boot OK.
- `tools/smoke/smoke-wo781-look-preset-destinations.test.js` + WO-601 smokes: 49/49. Full offline suite: 3376 tests,
  0 fail. Lint 215 warnings (budget 216), prettier OK, no file over 500 lines, no new unwired exports.
- **Live probe** (Xvfb client against the box server, `--probe-e2-presets`). Start state: PGM 1 = Look 2,
  PGM 2 = KV LOOP 2, both PRVs empty.
  - Both screens highlighted.
  - "probe PGM" saved `[{0, Look 2}, {1, KV LOOP 2}]`; "probe empty" saved two `empty: true` items.
  - PRV recall of "probe PGM" put both looks on PRV 1 / PRV 2 (screenshot: both PRV monitors show the looks; the card
    is red because it is on PGM, and "probe empty" is unmarked).
  - PRV recall of "probe empty" cleared both PRVs (monitors black; the card is green).
  - Highlight [0, 1] was kept throughout.
  - Looks toggle off hid both column grids, leaving the headers and strip.
  - Cleanup removed both presets (0 left) and the highlight; the box is back to its start state.
- Not probed live: PGM recall of an empty destination (fade to black on air). It is covered by the smoke (fade =
  0.5 s at the channel rate, Cut = 0 frames).
- Owner QA:
  - Highlight screens, save, recall on the real panel.
  - Show / hide Looks and Presets.
  - ▶ on a preset with an empty screen (that screen fades to black).
