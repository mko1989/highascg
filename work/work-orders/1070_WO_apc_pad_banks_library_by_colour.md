# WO-1070 — APC40 pad banks; the whole visuals library on the pads by dominant colour

**Area:** godot-client
**Status: IN PROGRESS (13.11 — built, suite green, the fill run over the real library offline; the menu action and the hardware need the owner's GUI restarted)**

Owner, 13.11: *"id like to be able to have banks of the different visuals on different pads. map the whole library to
the pad buttons on the akai based on dominant color"*

## Investigation

1. Visual pads (WO-913, `godot/client/features/visuals/visuals_midi_clips.gd`) were one dictionary, pad note →
   {payload, colour}, in `ui.cfg [midi] clips`: 40 pads, 40 visuals, no paging. The box's ui.cfg has all 40 filled by
   hand.
2. The library is 202 rows on this box (`visuals_catalog.gd rows`: 5 scenes, 196 shaders from `GET /api/shaders`,
   1 ROM) — five and a bit grids.
3. ▲ / ▼ (notes 94 / 95) are free in the APC map and in the box's stored map (◀ / ▶ are Edit A / B, WO-913).
4. The pad colour was `apc40_palette.gd main_color`: the saturation × brightness² weighted MEAN of the thumbnail. A
   picture that is red and blue gave magenta — a colour that is not in it. Not what "dominant" means, and it would sort
   two-colour shaders into the wrong place.
5. Thumbnails (`visuals_thumbs.gd`) are only rendered for folders someone opened in Sources ▸ Visuals; all but 3 of the 201
   are cached on this box.
6. `visuals_midi.gd` is at 496 lines (limit 500): the new behaviour had to live elsewhere.

## What was done

- `features/visuals/visuals_midi_clips.gd`: the pads are **banks** (`banks: [{name, auto, clips}]`, `bank` = the one on
  the pads; `clips` is now a view of that bank, so drop / fire / lights are unchanged). `page(±1)`, `can_page`,
  `bank_label` ("Pads 2/6 · Blue – Purple"). One step past the last bank is a new empty one to drop visuals on; it
  goes away when left empty. `bind_pads()` binds every used pad to `clip:<note>`. `set_auto_banks()` replaces the
  earlier fill's banks and keeps the operator's own in front. Stored in `[midi] clip_banks` / `clip_bank`; the old
  `clips` key is read as bank 1 and never written again (an older client still finds its pads).
- `features/visuals/visuals_midi_library.gd` (new): `banks(rows, color_of)` — rows with a colour in hue order (the wheel
  cut where "Red" starts, so a pinkish red sorts with the reds), then grey ones (white pads), then rows without a
  thumbnail; 40 to a bank, top row first; each bank named after its colours. `fill(midi)` — the menu action: reads the
  library through the Sources ▸ Visuals panel (`library_rows()`), renders the thumbnails it lacks (progress on the
  MIDI line, 120 s at most), sets the banks, switches the pad lights on.
- `features/midi/apc40_palette.gd`: `main_color` is the dominant hue (24 hue bins, the strongest bin with its two
  neighbours, their mean at full brightness); `hue_name()`.
- `features/midi/midi_map.gd`: target `padbank:prev|next`, ▲ / ▼ in the APC map; a stored map gains them
  (`visuals_midi.gd _load`). `visuals_midi_apc.gd`: hidden buttons the targets press (as `devpage`), the drawing shows
  "▲ 2/6" / "▼ 2/6", the hover line names the bank. `midi_panel.gd`: ⋯ ▸ "Pads: the whole library, by colour".
- Why sorted and dense rather than one bank per colour: 202 visuals in 9 colour families would be 9–11 half-empty
  banks to page through with two buttons; sorted by hue they are 6, and each still reads as a colour range.
- `tests/probe_pad_banks.gd`: a headless dev probe — the fill over a shader list and this client's thumbnail cache,
  printed and drawn.

## Verified

- Godot suite 28441 passed; the 1–2 failures across runs are `test_pixelhue_programming_panel::test_live_geometry_coalesces`
  (timing, fails on the pre-change tree too). New `tests/test_visuals_pad_banks.gd`: dominant colour (red + blue → red),
  hue names, banks in hue order with grey / no-thumbnail last, 95 rows → 40 + 40 + 15, ▲ / ▼ paging (the same pad loads
  and lights each bank's visual), the empty end bank, a fill keeping own banks and replacing the earlier fill, old
  `clips` → bank 1. `run-client.sh --check`: boot OK.
- Smokes: `smoke-wo1070-apc-pad-banks` 4/4, WO-908 / WO-909 8/8.
- The real library, offline (`probe_pad_banks.gd`, `GET /api/shaders` of this box + the box's thumbnail cache): 202
  rows → 6 banks — Red – Orange, Orange – Green, Green – Blue, Blue – Purple, Purple – (white, no thumbnail), and 2
  pads in a sixth. The drawn banks read as a continuous rainbow, top-left to bottom-right.
- **Not verified:** the menu action in the running GUI (panel lookup, rendering the 3 missing thumbnails), ▲ / ▼ and the
  pad colours on the hardware. The owner's GUI has to be restarted to load this.

## Known limits

- A pale colour's nearest APC palette entry is often white: such a pad is stored with its colour but lights white.
- The fill binds all 40 pads to visuals: on a map that still had looks on the top rows, those pads are the bank's now
  (the box's map already had every pad as a visual pad).
- 16 banks at most.
