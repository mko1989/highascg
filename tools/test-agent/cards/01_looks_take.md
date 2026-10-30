# Card 01 — Looks: create a look with two media layers, stage it on PRV, take it to PGM

**Area:** Live (look deck)  **Takes PGM:** yes  **Needs:** media `e2e_bars.mp4` and `e2e_still.png` in Sources → Media (provisioned by the coordinator with `node tools/test-agent/provision-fixtures.js`; always present in the sandbox), one PGM/PRV screen  **Time:** ~4 min

This card puts `e2e_bars` + `e2e_still` on the program output of the box and clears PGM and PRV with the screen's FTB at the
end. The coordinator only runs it when nothing important is on air.

## Preconditions
1. `tools/test-agent/ui tab Live` → ok:true. Then `tools/test-agent/ui list rows` → shows `"e2e_bars.mp4"` and `"e2e_still.png"` (if the list is long, run `tools/test-agent/ui type "Filter…" "e2e" ` first, and remember to clear the filter at the end).
2. `tools/test-agent/caspar channels` → `program` and `preview` are both non-empty lists. Write down the first number of each: **PGM** and **PRV** (sandbox: 1 and 2).
   - SANDBOX ONLY (a fresh sandbox has no screen, so both lists are empty): `tools/test-agent/ui tab Devices`, `tools/test-agent/ui click "Add destination"`, `tools/test-agent/ui tab Live`, then run `caspar channels` again.
   - On the live box empty lists mean no screen: UNCLEAR.
3. `tools/test-agent/ui reveal "TAKE"` → ok:true and `result.match.label` is `"TAKE"`. Then `tools/test-agent/ui reveal "New look — or drop a media file here / on empty deck space"` → ok:true and `result.match.label` is `"+"` (the first screen's deck "+", scrolled into view when the deck has many looks). Write down `result.match.cx` and `result.match.cy` as **PX** and **PY**. Otherwise: UNCLEAR. (Every screen has its own "+", TAKE and FTB, and a busy deck scrolls them out of view: this card always
   finds deck controls with `ui reveal`, which answers the FIRST screen's, and acts on the `cx`,`cy` it answers — never on the label.)
4. `tools/test-agent/caspar info <PGM>` → `"playing":[]` (nothing on air). Anything else: UNCLEAR ("PGM not free"), list what plays.
5. `tools/test-agent/caspar api /api/project` → count the entries of `result.project.scenes.scenes` (or `result.scenes.scenes`); remember it as **LOOKS_BEFORE**.

## Steps

### 1. Drag the clip onto the deck's "+" to make a look
- Run: `tools/test-agent/ui find "e2e_bars.mp4"` → note `at` as (SX, SY). Run `tools/test-agent/ui drag_xy SX SY PX PY` (PX, PY from precondition 3), then `tools/test-agent/ui shot 01_editor`
- Expected: `ok:true`. In the shot the look editor is open below the screens: the heading reads `Edit look: e2e_bars  (main 1 → PRV)` and a white-outlined box inside a dark frame is labelled `L10 e2e_bars.mp4`. `ui list labels` contains `"Edit look: e2e_bars  (main 1 → PRV)"`.
- Evidence: shot `01_editor`.

### 2. Drop a second clip into the editor's frame (adds a layer)
- Run: `tools/test-agent/ui find "e2e_still.png"` → note `at` as (SX, SY). Read shot `01_editor` and choose a point **inside the dark frame but outside the white-outlined layer box**, near the frame's top-left corner (about 20 px right of the frame's left edge and 20 px below its top edge) → (DX, DY). Run `tools/test-agent/ui drag_xy SX SY DX DY`, then `tools/test-agent/ui shot 02_two_layers`.
- Expected: `ok:true`. Shot shows a second layer `L11 e2e_still.png`; the lower list in the editor has a row `L11  e2e_still.png`.
- Evidence: shot `02_two_layers`.

### 3. Close the editor
- Run: `tools/test-agent/ui click Close`, then `tools/test-agent/ui reveal "e2e_bars"`, then `tools/test-agent/caspar api /api/project`
- Expected: `ok:true` for all three; the reveal's `result.match.label` is `"e2e_bars"` (the look's card is on the deck); in the project, `scenes.scenes` has exactly one entry whose `name` is `"e2e_bars"`, and its `layers` list has 2 entries. (Do not look for the card's `2 layers · …` line on screen: on a busy deck it can sit below the window edge.)
- Evidence: none.

### 4. Click the look card: it is staged on PRV
- Run: `tools/test-agent/ui reveal "e2e_bars"` → ok:true (the new look's card name); `tools/test-agent/ui click_xy <result.match.cx> <result.match.cy>`, then `tools/test-agent/ui wait 2`, `tools/test-agent/caspar info <PRV>`, `tools/test-agent/ui shot 03_prv`
- Expected: `ok:true`; `caspar info <PRV>` `playing` has two entries, one containing `e2e_bars` and one containing `e2e_still` (case-insensitive), both `(playing)`.
- Evidence: shot `03_prv`, the `playing` list.

### 5. TAKE: the look goes to PGM
- Run: `tools/test-agent/ui reveal "TAKE"` → ok:true; `tools/test-agent/ui click_xy <result.match.cx> <result.match.cy>`, then `tools/test-agent/ui wait 3`, `tools/test-agent/caspar info <PGM>`, `tools/test-agent/ui shot 04_pgm`
- Expected: `ok:true`; `caspar info <PGM>` `playing` has two entries, containing `e2e_bars` and `e2e_still`, both `(playing)`.
- Evidence: shot `04_pgm`, the `playing` list.

### 6. A picture is really on PGM
- Run: `tools/test-agent/caspar print <PGM>` and Read the `png` it names.
- Expected: the numbers are for the full channel (`frame` is the whole screen canvas). `nonblack_fraction` ≥ 0.2, `alpha_nonzero_fraction` ≥ 0.2 and `mean_luma` ≥ 15; the PNG shows colour bars (the top look layer is a SMPTE-bars still or the test pattern; either is fine). A screen canvas bigger than the clip (the live box's 3840x1792 LED wall) is transparent around the picture, and the Read viewer shows that as white: that is expected, not a fault. (Measured on the live box, 30.10: 0.256 / 0.301 / 27.9; black after FTB is < 0.02 / – / < 5.)
- Evidence: the print JSON line and the png path.
- LIVE-ONLY: yes

### 7. FTB clears PGM and PRV
- Run: `tools/test-agent/ui reveal "Fade to black (PGM + PRV), then clear"` → ok:true; `tools/test-agent/ui click_xy <result.match.cx> <result.match.cy>`, then `tools/test-agent/ui wait 4`, `tools/test-agent/caspar info <PGM>`, `tools/test-agent/caspar info <PRV>`, `tools/test-agent/ui shot 05_cleared`
- Expected: `ok:true`; both `info` calls answer `"playing":[]`.
- Evidence: shot `05_cleared`.

### 8. PGM is black
- Run: `tools/test-agent/caspar print <PGM>`
- Expected: `mean_luma` < 5 and `nonblack_fraction` < 0.02.
- Evidence: the print JSON line.
- LIVE-ONLY: yes

## Cleanup
Always. Goal: the project has **LOOKS_BEFORE** looks again and nothing on air.
1. If a dialog or menu is open (`ui state` lists it): `tools/test-agent/ui key Escape`.
2. If a look card named `e2e_bars` is on the deck (`ui reveal "e2e_bars"` ok:true): `tools/test-agent/ui click_xy <cx> <cy> --right` (its `result.match`), `tools/test-agent/ui click "Delete look…" --kind menuitem`, `tools/test-agent/ui click OK`.
3. If you typed in the media filter: `tools/test-agent/ui type "Filter…" ""`.
4. `tools/test-agent/caspar api /api/project` → looks count equals **LOOKS_BEFORE**; `tools/test-agent/caspar info <PGM>` and `tools/test-agent/caspar info <PRV>` → both `"playing":[]` (editing a look shows it on PRV, so a stop before step 7 leaves it there). If either still plays: `tools/test-agent/ui reveal "Fade to black (PGM + PRV), then clear"` and `ui click_xy` its `cx`,`cy`. Record both answers in NOTES.

## PASS rule
Steps 1–5 and 7 PASS (6 and 8 PASS on the live box, SKIPPED in the sandbox), Cleanup finished with the looks count restored and PGM empty.

## FAIL / UNCLEAR rule
- **FAIL**: a command worked but its Expected is not met (e.g. step 5 `playing` is `[]`, the print is black, a clip name is missing) → record expected vs seen + the shot, skip the rest, do Cleanup.
- **UNCLEAR**: a label is missing/disabled/covered, `ok:false`, or the shot does not let you decide → README section 4, do Cleanup.
- Never improvise coordinates or labels.
