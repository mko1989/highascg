# WO-673 — Live 3D: the light-beams toggle is a light bulb (lit = on, dark = off)

**Status: DONE (22.10, box screenshot; owner QA = checklist 22.10 §G)**

Owner, `next.md` 22.10: *"for the light beams toggle in 3d do a light bulb, illuminated for on, off for off."*

## Investigation

- The toggle was a text button "Lights" (`godot/client/features/live/live_tab.gd` `_view_switch`, WO-649). The
  neighbouring toggles are icons (WO-659 cube / clock).
- Godot's default theme tints a pressed button's icon. A coloured icon needs the pressed tint set to white
  (the warning-icon note in `assets/ui/icons/README.txt`).

## What was done

- `assets/ui/icons/bulb_on.svg`: a yellow (#ffd54a) bulb with a highlight and five rays.
  `assets/ui/icons/bulb_off.svg`: the same bulb as a white outline, with no rays.
  The README lists both.
- `live_tab.gd`:
  - the Lights button has no text; it shows `bulb_on` / `bulb_off` at 22 px, following the toggle and the state
    restored from `ui.cfg`;
  - the pressed icon tint is overridden to white, so the bulb stays yellow;
  - the tooltip is unchanged.

## What was VERIFIED

- Godot `--test` 20863/0.
- Both icons rasterised headless at 22 / 44 px: they read as an outline bulb and a lit bulb.
- Box: a second client with `--live-view=3d`. The toolbar shows [cube] [Fit] [yellow lit bulb] (lights on, pressed
  outline).
- Owner QA: click it. The bulb goes dark (white outline) and the beams stop; the heads stay.
