# WO-1069 — Screen timer cannot be placed freely; settings only show after Save

**Area:** engine, godot-client
**Status: IN PROGRESS (13.11 — template proven on PGM 1; the form changes need the owner's GUI restarted)**

Owner, 13.11: *"i cant position a screen timer freely, and it updates only after clicking save."*

## Investigation

1. `template/countdown/countdown.html` fixed the page at `1920px × 1080px` (`overflow: hidden`). On the 3072×1024
   screen the "center" preset sat at x ≈ 960 (a third of the way across, `PRINT 2`) and nothing could be placed right
   of 1920 px.
2. `countdown-engine.js applyPositionClass` used the pixel position only when BOTH X and Y were numbers. The owner's
   timer held `posX: 50, posY: ""` — a typed X that did nothing.
3. `screen_timer_panel.gd _apply` ended in `reload()`, which rebuilds every timer's form: X applied on leaving the
   field, and the rebuild then destroyed the Y field the operator had just clicked into (focus and text gone). That is
   why Y never arrived.
4. Size, font, colours and border only went out with Save; px only on Enter / leaving the field.

## What was done

- Template: the page is the channel's canvas (100 %). Position per axis: X alone moves it across and keeps the
  preset's height, Y alone the reverse; both = the block's top-left corner at (X, Y) as before.
- `screen_timer_settings.gd`: the LOOK applies as it changes — size, font, colours, border (150 ms after the last
  change), X / Y while typing a plain number (a sum in progress waits for Enter). What the timer COUNTS (duration,
  mode, target) stays on Save, so a running timer is not re-set by a half-typed time.
- `screen_timer_panel.gd`: no rebuild after its own apply (the 5 s poll refreshes once no field has focus).
  `timers_dock.gd`: a live patch updates the record it was built from, so the next patch does not undo it.
- `smoke-wo381-…`: the pinned position lines repointed to the per-axis code.

## Verified

- Box, PGM 1 (3072×1024), `PRINT 2` at four settings: preset center → the middle of the screen; X = 2400 only →
  starts at 2400, still vertically centred; X = 2400 / Y = 600 → there; Y = 40 only → top, still horizontally centred.
- Godot suite 28418 / 0, `--check` boot OK; offline suite green.
- NOT verified: the form in the owner's GUI (typing X then Y, live size / colour).
- Left on air: the owner's timer on the centre preset with its stray `posX: 50` cleared (with the new template that X
  would have moved it to the left edge).
- Test artefact worth knowing: `CG 2-980 CLEAR` followed by `/api/timers/assign` does NOT bring a timer back —
  `CG UPDATE` on an empty layer answers OK, so the 403 self-heal in routes-screen-timers.js never fires. Unassign +
  assign re-adds it. A running timer picks the new template up the same way (or at the next server start).
