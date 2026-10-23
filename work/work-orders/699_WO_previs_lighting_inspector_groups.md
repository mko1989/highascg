# WO-699 — previs Inspector: the lighting controls grouped by job

**Status: DONE (2026-10-23, Godot 21153/0, `run-client.sh --check` OK; checked in a second client instance on the box —
screenshots below; owner QA: the layout)**

Owner, 23.10: *"the whole lighting part of the inspector in previs needs better organization. group the buttons
functions in a way that makes sense."* (The same day's "can't type an Art-Net universe" report was withdrawn by the
owner — "my mistake"; typing and Tab → next field with its text selected were checked to work in the Add, Patch and
DMX viewer universe fields.)

## Investigation

`fixtures_section.gd` was one flat column under the "Fixtures" fold (`previs_tab.gd` `_build_panel`): type picker,
Import / Remove / Replace, Body colour, mode, Art-Net / U / × / Add, then DMX output / Send / console input on one
row, DMX viewer + Out via (WO-698), the universe usage and the type status as loose text, the WO-695 Patch block with
its own header label, and the Programmer behind a one-line "Programmer (WO-615 T6) — …" label. Adding heads, the
selected heads' patch, network output and live programming were interleaved; the add-status line sat under the output
rows, far from Add.

## What was done

- `fixtures_section.gd` builds four `fold_section.gd` folds (open state remembered per title, WO-640), in working order:
  - **Add fixtures** — type, Import GDTF… / Remove / Replace…, Body colour, mode, Art-Net / U / × / Add, and its status
    line right under Add;
  - **Selected heads — patch** — the WO-695 patch editor; the fold shows only while heads are selected (follows the
    editor's own visibility); the editor's duplicate "Patch (selected heads)" label dropped;
  - **DMX output** — DMX output + Send ▾; Out via (full width); Art-Net / sACN input + DMX viewer…; the universe usage;
  - **Programmer** — "Click fixtures in the 3D view; ctrl / shift-click adds", then the programmer.
  Tooltips added to the type, mode and Add.
- `previs_tab.gd`: the outer fold is **Lighting** (was "Fixtures"), its contents inset 12 px so the sub-folds read as
  under it. The MVR scene's Re-patch / Unpatch stay with the scene (they act on that scene's fixtures).
- Calibration of a head (today under Camera → Follow → Calibrate, WO-624 E3) moves next — WO-700.

## Verified

- Godot 21153/0; `run-client.sh --check` boot OK.
- Second client on the box (Previs → 3D): Lighting ▸ Add fixtures / DMX output / Programmer render in order with the
  inset; Programmer → All (client-local selection) shows "Selected heads — patch" between Add fixtures and DMX output
  ("2 heads — they run on…", mode, Art-Net U 100 @ 1, Apply); with nothing selected it is hidden.
