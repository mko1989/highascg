# WO-777 — Godot looks deck: clicking empty deck space clears the screen's PRV

**Area:** godot-client
**Status: DONE (26.10) — Godot unit tests 21865 / 0, boot check OK, live probe through real viewport mouse events on
the box (card click → PRV staged, blank click → PRV '' and Caspar ch 2 has no layers).**

Owner, 26.10: "clicking on empty space of the looks deck should clear prv channel."

Parent: [WO-342](./342_WO_DECK_HEADER_CLICK_CLEARS_PRV.md) — the web deck has it (`client/components/scene-list-column.js`
header empty space + empty grid); the Godot deck (`godot/client/features/live/deck_view.gd`, WO-600) never got it.

## Investigation

- Server clear exists: `POST /api/scene/live/preview/clear { mainIndex }` (`src/api/routes-scene-preview.js`
  `handlePreviewLiveClear`) — joins the take chain, clears the PRV look-stack layers and the scene.live entry,
  broadcasts; the Godot deck re-highlights from that broadcast.
- Godot deck input: cards `MOUSE_FILTER_STOP` (`_card`), the "+" tile and header buttons are Buttons (STOP); the
  column and grid are `MOUSE_FILTER_PASS`. So an unhandled click on blank grid / column space bubbles to the column.
  The header row was a default HBoxContainer — set to PASS so its gaps count too.
- Web guard "not while editing this screen's look": the Godot live tab hides the deck while the look editor is open
  (`live_tab.gd` `for c in [_action, bar, deck]: c.visible = not editor.visible`), so the guard holds by construction.
- `deck_view.gd` was at 497 lines and `app/main.gd` at 500 (500-line CI cap).

## What was done

- New `godot/client/features/live/deck_blank_clear.gd`: `wire(col, main, cm, report)` — only on screens with a
  separate PRV (`DeckModel.preview_bus_available`); left press + release on the column = clear (a double-click's second
  press does not count); tooltip "Click empty space to clear this screen's PRV"; `clear()` posts the endpoint and
  reports through the deck's `action_result`.
- `deck_view.gd`: preload, header row PASS, `BlankClear.wire(...)` per column (500 lines).
- Dev probe `--probe-blank-clear=<main>` (`app/deck_blank_probe.gd`, hooked in `main.gd`; two neighbouring probes
  inlined a single-use local to stay at 500): pushes real InputEventMouseButtons into the probe window's viewport.

## Verified

- Second windowed instance (own XDG_DATA_HOME, owner's client untouched) on main 0 (PRV ch 2, PGM ch 1):
  `start: PRV = ''` → card click → `take-look preview … → 200`, `PRV = '586e21a2…'` (no clear fired) → blank click →
  `prv clear main 0 → 200`, `PRV = ''`. AMCP `INFO 2` afterwards: no layers.
- `run_tests.gd` 21865 passed / 0 failed; `run-client.sh --check` boot OK; `check-max-file-lines` 0 over.
- Owner QA: in the owner's client after a relaunch.
