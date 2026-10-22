# WO-680 — Programmer: automatic fixture groups by position and address

**Status: DONE (22.10, Godot 20975/0; box: Groups ▾ → By position / By address on Pabianice, "Sharpy Plus · floor"
selected the 5 stage-front Sharpys)**

Owner, 22.10: *"in fixture groups id like premade automatic default groups based on address and position in mvr while
loading."*

## Investigation

- Groups (WO-615 T6) are the operator's own, stored in `project.fixtures.groups` `[{name, ids}]`
  (`programmer_model.gd` `normalize_groups` / `save_group`). Only the Godot programmer reads them
  (`programmer_section.gd` Groups ▾). The server never does.
- MVR fixtures arrive through Patch / Re-patch (WO-615 T10). Each entry carries `typeId`, `protocol`, `universe`,
  `address` and `pose` (PSN x stage left, y upstage, z up, hang truss / floor).
- The owner's Pabianice patch (52 fixtures, 5 types, Art-Net 1/2/3/5/8/9):
  - Sharpy Plus: a truss row at 6.19 m plus a floor row at 0.7 m;
  - Pixel Strobe: rows at 6.43 m and 0.8 m;
  - Robin 600: a truss row plus 4 floor units on two depths;
  - Pixel Line: two vertical ladders, left and right;
  - Focus Profile: one FOH line in 4 pairs with 4.7 m gaps.
- The owner had already built "pixele l" / "pixele r" by hand: they want left / right halves.

## What was done

- New `features/previs/fixtures/auto_groups_model.gd` (pure):
  - `by_position`: per type, single-link rows: same mount, (upstage, height) within `ROW_GAP` = 1.2 m. So a truss
    line, a floor line, a ladder and a gapped FOH line are each one row.
  - Each row is ordered stage right → stage left; in one column, top first, then downstage first.
  - A row of 4 or more also gives its "SR" / "SL" halves. A type in several rows also gets "· all", row after row.
  - Type names come from the fixture names without their numbers ("Sharpy Plus 101" → "Sharpy Plus").
    Row labels are "floor" or the height ("6.2 m").
  - `by_address`: one group per universe ("Art-Net 5", "sACN 12"), in address order.
- `programmer_section.gd` Groups ▾: the owner's groups first, then "By position ▸" and "By address ▸" submenus.
- Why live rather than stored "while loading":
  - the groups are recomputed from the current patch every time the menu opens, so a re-patch, an unpatch or a
    hand-added fixture can never leave them stale;
  - the operator's saved groups are never overwritten;
  - nothing new goes into the project;
  - from the operator's side they are there as soon as the MVR is patched.
- To keep or tweak one: pick it, then "Save selection as group…".
- `tests/test_auto_groups_model.gd`: a cut of the Pabianice patch: names, row split, floor row, ladder, gapped FOH,
  order, halves, "· all", universes, sACN, empty patch.

## What was VERIFIED

- Godot tests 20975 / 0; 500-line limit clean.
- Live patch dump (52 fixtures): 27 position groups, e.g.:
  - Sharpy Plus · 6.2 m (7) and · floor (5);
  - Robin 600 LEDWash+ · 6.2 m SR / SL (4 / 4);
  - Pixel Line IP SR 1021–1024 and SL 1025–1028, which match the owner's "pixele" groups;
  - Focus Profile 401–408 as one row.
- Live patch dump, by address: 6 universe groups (Art-Net 1 = 13, 2 = 8, 3 = 15, 5 = 8, 8 = 4, 9 = 4).
- Box GUI relaunched:
  - Groups ▾ shows pixele r, pixele l and front, then By position ▸ / By address ▸;
  - By position lists all 27;
  - "Sharpy Plus · floor (5)" selected the five stage-front Sharpys (yellow boxes in 3D).
- Owner QA: whether SR / SL (stage right / left) reads right for you, or should be audience L / R.
