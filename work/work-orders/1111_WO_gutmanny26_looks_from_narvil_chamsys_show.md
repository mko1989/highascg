# WO-1111 — gutmanny 26: five looks copied from the Narvil IDE ChamSys show (BAND cue stack)

**Area:** lighting, godot-client
**Status: DONE (17.11.26 — five looks stored and recalled in the owner's previs; three seen on glass)**

Owner 17.11: "open the chamsys show from ide narvil and copy over some of the scenes from the show into this previs."

Related: [WO-1107](./1107_WO_gutmanny26_capture_scene_into_project.md) (the rig and the first four looks),
[WO-796](./796_WO_magicq_show_from_highascg_mvr.md) (MagicQ on the box).

## Investigation

- The show is `~/Documents/MagicQ/show/tamoos-narvil.shw` (14.11, MagicQ 1.9.8.3; it is what "Continue last show"
  opens). The `.shw` is MagicQ's own hex record format — not read directly. MagicQ PC was run hidden (Xvfb :99) and its
  Art-Net (unicast 127.0.0.2:6454, universes 1–5 and 10–18) captured (`artcap.py`).
- The show's patch is the `narvil` project's patch (`projects/narvil.json`: 26 MAC Quantum Profile, 10 Robin 600
  LEDWash+, 12 Pixel Strobe, 30 Pixel Line IP, 12 X-Dot Max — same universes), so the captured frames decode with
  `src/fixtures/gdtf-visual.js` against that patch (`mqdecode.js`).
- It is a busking show: page KONCERT has group masters on PB1–5, positions on PB6 (26 cues), and the one stack of
  whole scenes, **PB10 "BAND"**, 5 cues: RED/RUN, MAG/PROMISES, BLUE GRUBSON, GREEN/MOVE HONE, 5.00. Those cues hold
  colour, pan / tilt, zoom and gobo; **every Dimmer is 0** in them (intensity is played live on other stacks), and the
  Pixel Lines are not in them.
- `POST /api/project/autosave` cannot add a look once the live deck holds looks (the server overwrites `scenes` from
  its deck — routes-data-project-handlers.js `enrichProjectScenesFromLiveDeck`): the five `fixtures.looks` entries
  were stored but their look rows dropped. Added over WS `scene_deck_sync` instead (`add_looks.js`, as
  tools/e2e/two-box/set-look-source.js does).

## What was done

- Each BAND cue played in MagicQ, captured after its fade, decoded per Narvil fixture (colour, pan, tilt, zoom, gobo).
- `copy_mq_looks.py`: onto the gutmanny 26 rig by type, left → right across the rig (36 Quantums take the 26, 54
  washes the 10, …); types Narvil does not have take a relative's colour and pan / tilt (Focus Profile and Vizi Beam ←
  Quantum, X-Dot ← X-Dot Max). A level per type stands in for the busked intensity (Quantum 0.8, wash 0.6, Vizi 0.7,
  Focus 0.5, X-Dot 0.5, strobe 0.25).
- Looks "Narvil — Red / Run", "— Magenta / Promises", "— Blue Grubson", "— Green / Move", "— 5.00" (218 fixtures each,
  178 in Magenta: that cue leaves the X-Dots' main colour at 0). Scripts in `work/notes/gutmanny26-build/`.

## What was verified

- `GET /api/project`: 9 looks, 9 `fixtures.looks`; recall of Red, Blue and Green in the owner's GUI (screenshots):
  colour per type, Quantum gobos in Blue / Green. The owner's programmer (216 values) was saved before and put back.
- MagicQ, the capture and Xvfb :99 stopped afterwards; the show file was not saved or changed.

## Not verified / limits

- Pan / tilt are the Narvil rig's angles on another rig in another room: the picture has the cue's character, not its
  aim. The washes point straight down as in the cue (pan / tilt at centre there).
- Chases and effects of the show (most of its ~560 cue stacks) are not looks and were not copied; "Magenta" and "5.00"
  were not looked at on glass.
