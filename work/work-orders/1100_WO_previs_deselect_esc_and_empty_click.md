# WO-1100 — Previs: deselect with Esc or a click on empty space (one selection in the 3D view)

**Area:** godot-client, tracking-vr
**Status: DONE (16.11.26 — Godot tests 29151/0 incl. 57 new; on glass in the Hilton show through real window input: stage object, fixture, venue part, Layers row each cleared by Esc and by an empty click, with screenshots)**

Owner 16.11 (verbatim): "there is no way in the previs to deselect a clicked object."

## Investigation

The previs 3D view (`previs_tab.gd` `_on_3d_input`, 3D mode) knows three selectable kinds; the tracking Camera view
(mode "camera", `tracking/tracking_view.gd`) has its own working context, not a 3D selection.

| Kind | How it is selected | Way to clear it before | What stayed "stuck" |
|---|---|---|---|
| Stage object (LED wall / TV / projection of the Stage panel) | 3D click → `stage_builder.pick` → `stage_panel.select` (`stage_panel.gd:232`); a row of the Stage list (`ItemList.item_selected`) | **none** (only Delete removes it) | the yellow box (`stage_builder.set_selected`), the list row, the inspector fields, the Position card, Delete / Ctrl+D / nudge keys |
| Fixtures ("heads", the Programmer's selection, `fixtures/fixture_selection.gd`) | 3D click → `fixtures_3d.gd:247 click` → `sel.pick` (ctrl/shift toggles, WO-681); the Programmer's list | the Programmer's **"None"** button (`programmer_section.gd:57`) — far from the 3D view | the amber head marks, the Programmer controls, the Position card, Delete (asks) and nudge keys |
| MVR objects / walls (incl. every venue .glb part — WO-1003 makes each a pickable MVR object of its layer) | 3D click → `mvr_section.click` → `mvr_screens.click` (`mvr_screens.gd:66`); a Layers row (`color_rows.row_clicked` → `select_layer`, WO-1001: also selects the layer's patched heads) | a plain click that hit **nothing at all** cleared the walls only (`mvr_screens.gd:68-71`) — rare, because in a modelled venue nearly every pixel is a venue part | the wall frames, the Map row, the Layers highlight, the Position card, nudge keys |

- The kinds were independent: a click on a fixture left the stage object's yellow box up, while the Position card,
  Delete and the nudge keys followed only the **last kind picked** (`move/move_targets.gd` `_pick`, WO-682) — the
  leftover box showed a selection the keys no longer acted on.
- Nudge keys (`move/move_drag.gd key()`: arrows, Page Up/Down, Q/E) act whenever `move_targets.active() != ""`: a stuck
  selection could be moved by an arrow key meant for something else.
- Esc: no handler in the previs; `app/view_focus.gd:162` uses an unhandled Esc to leave the full-view mode.
- Click-vs-drag: `previs_tab.gd` already treats a left release within 4 px of the press as a click (orbit / pan / dolly
  drags never pick); `move_drag.gd` hands a click on the selection back to the caller (SLOP 4 px).
- Modes that own a click in the 3D view: calibration "Place mark" (`sel.mark_pick`, `calibrate_fold.gd:62` — the next
  floor click places a stage mark) and the Programmer's "Point at" (`sel.point_at` with heads — a floor click aims
  them); both are handled first in `fixtures_3d.gd click()`. Right-drag aims heads (`aim_drag.gd`, WO-679); left-drag
  on the selection moves it (`move_drag.gd`).
- Camera view (mode "camera"): every left click belongs to the active workflow — calibration (`tracking_view.gd _click`:
  put the active point / ctrl = pick a point), Markers ("click the floor: the selected marker goes there"), Zones
  (drawing corners), Detect masks, rough aim (WO-1091 drag/click). The "selected" tracking camera (`tracking_page.gd
  _select_cam`) and the selected marker (`markers_section.gd`, the arrows drive it) are the working context of those
  pages — there is always one; they are not 3D selections. WO-843 already keeps the stage keys out of Camera mode.
- The console's selection (WO-857, `console_selection.gd`) is a separate set on purpose; nothing here writes it.

## What was done

One rule for the 3D view, `godot/client/features/previs/move/select_rule.gd` (new, pure of autoloads; `move_targets.gd`
already holds every part, so the tab passes `mover`):

- **A click** (release within the existing 4 px of the press — orbit / pan / dolly / move drags never reach it) on a
  head, else a stage object, else an MVR object selects it. **A plain click is one selection:** the other kinds clear
  (selecting a fixture takes the yellow box off the stage object, etc.). Decided on the evidence of the Inspector: the
  Position card, Delete and the nudge keys already act on one "last picked" kind (`move_targets.gd`, WO-682), so a
  second highlighted kind was only a misleading leftover. **Ctrl / shift** still add / remove within the clicked kind and
  leave the others alone (multi-select as before).
- **Clicking the selected thing again keeps it** (no toggle — double-click and drag-start stay reliable); ctrl/shift
  on a selected head / wall removes it, as it did (WO-681 / WO-634).
- **A click on empty space** (nothing pickable under the pointer) clears everything: heads (the Programmer's
  selection, like its "None" button), the stage object (yellow box, list row, inspector fields — `stage_panel.gd`
  new `deselect()`), MVR walls / layer selection (frames, Map row, Layers highlight).
- **Esc** clears everything (`previs_tab.gd _unhandled_key_input`, 3D mode only like the other stage keys of WO-843,
  not during a move drag or a right-drag aim). It is an *unhandled* key: a focused text / number field, an open
  menu or dialog take Esc first (RULES.md input fields unchanged). With nothing selected Esc is not consumed, so it
  still leaves the full-view mode (`view_focus.gd`) — first Esc deselects, the next leaves.
- **The Stage list:** a click below its rows (`ItemList.empty_clicked`) deselects too; a row click selects as before.
- **Clearing disarms the keys:** `move_targets.active()` becomes "" → the Position card's fold hides, the nudge keys,
  Delete and Ctrl+D do nothing (`move_drag.key` returns false).
- **Modes that own a click keep it:** while calibration "Place mark" or the Programmer's "Point at" (with heads) is
  armed, the click goes to the tool exactly as before; neither an empty click nor Esc clears anything (the tool's
  button turns it off). The Camera view (mode "camera") is untouched: calibration point clicks, Markers' "click the
  floor: the selected marker goes there", zone and mask drawing, rough aim — its "current camera" and "selected
  marker" are page context, not 3D selections, and stay. Right-drag aim (WO-679) and left-drag move (WO-682) unchanged.
- **Not cleared on purpose:** the console's selection (WO-857) — a separate set by design that nothing here writes.
- **Hint:** the Position card's line (shown while something is selected, next to the nudge hint) ends
  "· Esc / click empty space: deselect".

`app/select_probe.gd` (`--probe-select=<png prefix>`, dev): selects each kind through real window input
(`Viewport.push_input`: a click at the object's screen point, a Layers row click) and clears it with Esc and with a
click on empty space, saving the window per step and printing the selection state. The pointer is not touched.

## What was VERIFIED

- **Godot tests:** `tests/test_select_rule_wo1100.gd` — per kind (heads, stage object, MVR wall): select → empty click →
  none, select → Esc → none, a second Esc goes on; a plain click replaces the other kinds; ctrl/shift adds/removes
  within its kind and keeps the others; clicking the selection again keeps it; Point at / Place mark keep their clicks
  (empty click and Esc clear nothing, the tool got both clicks); nudge keys (arrows, Page Up/Down, Q/E) do nothing
  with no selection; clearing walls refreshes the Position card; source pins (the 4 px click rule ahead of the rule,
  Esc gate, Stage list `empty_clicked`, the hint). Full client suite **29151 passed, 0 failed**; `run-client.sh --check`
  boot OK.
- **On glass, Hilton Wawer project** (`--probe-select`, real window input via `Viewport.push_input`, 16.11 14:08–14:09;
  window shots in `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/sel/`, montages `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/g_sel1.png`, `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/g_sel2.png`):
  - stage object `led_wall_1` (the framed LED wall, Position card "Dioda P3 15 × 3 m" with the new hint) → Esc → frame
    and card gone, nudge target "" ; select again → click on empty space → gone.
  - a fixture (`mvr-253f8eff…`, amber box) → Esc → none; again → empty click → none.
  - a venue part (the carpet, layer Floor, 62 × 30 m frame) → Esc → none; again → empty click → none.
  - a Layers row ("Scena": the stage deck + its row highlighted) → Esc → none; again → empty click → none.
  - The 4 px rule held throughout (no orbit started by the probe's clicks).
- **Finding — empty space is rare in a modelled venue:** from the Front preset no pixel of the Hilton view is free of
  pickable objects (every venue .glb part is a pickable MVR object since WO-1003, carpet / walls / ceiling included), so
  the probe's empty click had to be made from far outside the room (`*_far.png`). Inside such a room a click on the
  carpet *selects the carpet* (which now at least clears the stage object's yellow box — one selection), and **Esc is the
  reliable deselect**. Follow-up for the owner to decide: a per-layer lock (not clickable) with the room-shell layers
  (floor, walls, ceiling, carpet) locked by default after a venue import.
- First run of the probe found the Position card staying up after an MVR clear (walls emit no pick when they clear —
  pre-existing for the old empty click); fixed (`move_targets.changed` after a wall clear) and covered by a test; that
  last fix was verified by the test and `--check`, not by a third glass run.

**Not verified:** a physical mouse/keyboard on the box (no pointer automation while the owner may be working — the probe
drives the same input path without moving the pointer); the Stage list `empty_clicked` path on glass; VR (its own
selection, untouched); Esc while a menu / dialog is open (Godot's GUI consumes it before `_unhandled_key_input` —
by construction, not exercised).
