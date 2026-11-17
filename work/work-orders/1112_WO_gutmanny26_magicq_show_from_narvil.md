# WO-1112 — gutmanny 26: MagicQ show "gutmanny26" built on the Narvil show, patched to this rig; the previs follows the desk

**Area:** lighting, godot-client
**Status: IN PROGRESS (17.11.26 — patch, 3D positions and eight stage-point position palettes done and checked in the previs; remaining palettes, cue check and X-Dot / X-Dot Max aim open)**

Owner 17.11: "run magicq. build on top of the narvil show with effects etc but change the patch to the gutmanny. then
rebuild the show that was in narvil for this rig/room. do it on my screen then i can run the previz from magicq". On the
question "why dont you load the mvr and overwrite the existing patch?" the owner chose **continue cloning** (an MVR
import adds unprogrammed heads; the show's cues / palettes / groups / FX belong to the existing head numbers).

Related: [WO-1111](./1111_WO_gutmanny26_looks_from_narvil_chamsys_show.md), [WO-796](./796_WO_magicq_show_from_highascg_mvr.md),
[WO-1107](./1107_WO_gutmanny26_capture_scene_into_project.md).

## Investigation

- `tamoos-narvil.shw` holds more than the Narvil project's patch (Patch ▸ View Chans ▸ Export Heads): 34 MacQuantumProf
  Extended, 32 ViziBeamCMY 24ch, 22 X-DOT 51Ch, 16 Rob600LEDWash Mode 3 + 6 Mode 1, 12 ALEDA B-Eye K20 Shapes (the
  Narvil project plays them as X-Dot Max 35Ch), 12 PIXEL STROBE IP 15Ch, 30 PixellineIP 68ch, plus PixelBar8, pars,
  blinders, an 819-pixel LEDRGB map, fog.
- The rig needs 36 Quantum, 24 Focus Profile, 54 Robin, 36 Pixel Strobe, 28 Vizi Beam, 28 X-Dot, 12 X-Dot Max, 34 Pixel
  Line (252).
- MagicQ facts found on the box (1.9.8.3, demo mode):
  - Import Heads ▸ "Clone, Morph, Readdress" does not match the `Headtype` its own Export Heads writes: the clone was
    morphed to an unrelated personality. "Readdress" by head number works (two runs: a first run leaves a few behind),
    but a head number shared with a vdim child (strobes 701–704) moves the vdim instead — set those in the DMX field.
  - CLONE HEAD (View Heads, rows selected with shift-click) copies palettes + cues; clones get numbers from 10820 up,
    X + 0.5 m. MORPH HEAD morphs to the head picked in CHOOSE HEAD (Search ▸ whole name).
  - Typed text only goes to MagicQ when a dialog / field has focus; File ▸ Save asks a name (Return overwrites).
  - The window sits under the fullscreen Godot client until activated (`xdotool windowactivate`).

## What was done (MagicQ on :0, show saved as `~/Documents/MagicQ/show/gutmanny26.shw`; the Narvil file untouched)

- Clones: Quantum +28 (1 MAIN UP, 1 MAIN DOWN, 26 FRONT), Robin Mode 3 +32, Pixel Strobe +24, Pixelline +4, X-DOT +6;
  24 of the FRONT clones morphed to ADJ FocusProfile 36ch.
- Head ↔ fixture by role and left → right (`work/notes/gutmanny26-build/mqplan.py`, result `magicq-plan.json`): hall
  trusses from the stage outwards take MAIN UP / MAIN DOWN / FRONT / 1 TUSS / GOBO / FLOOR Quantums; front key =
  the Focus Profiles (FRONT programming); Robins FRONT TRUSS + clones on the hall trusses, the six Mode 1 heads over the
  stage; Vizi BACK / FRONT upstage, SLUP LEFT / RIGHT on the sides; K20 → the floor X-Dot Max.
- Addresses: 252 heads packed on MagicQ universes 2–7, 9, 11–19, 27 (the ones the desk already sends as Art-Net
  unicast to 127.0.0.2); the old heads of these types and the PixelBar8 parked on 43–46.
- HighAsCG project: every patch entry set to the desk's type / mode / universe (MagicQ − 1) / address, `console.head`
  noted, `fixtures.dmx.visualise` on (snapshot before: scratchpad `snap/gutmanny_before_magicq_patch.json`). Pixel
  Strobe type is now `b6c4b750cbc7` "Advanced 1 (15ch)".

## What was verified

- Export Heads after the last change: 252 of 252 heads at the planned address.
- `GET /api/fixtures/dmx`: Art-Net from the desk on every planned universe. With the masters up and all heads @ FULL the
  previs decoded 36/36 Quantum, 24/24 Focus, 28/28 Vizi, 12/12 X-Dot Max, 34/34 Pixel Line, 48/54 Robin lit; screenshot
  of the previs shows the BAND cue RED/RUN on the rig.

## Second pass 17.11 (owner: "continue porting the chamsys show. correct the magicq's 3d positions to the ones from the mvr")

- **3D positions.** `GET /api/stage/rig-export?format=csv&desk=magicq&types=highascg`, re-centred (X − 16.31, Z + 47.97:
  origin = stage front centre, +Z to the audience), imported with Patch ▸ View Chans ▸ Import Heads ▸ **Vis data only**
  (matches by DMX address). Export back: 252 of 252 positions within 2 cm.
- **Invert flags stay as the Narvil show has them.** A Focus Hold on stage centre showed the desk tilting Quantum /
  Focus Profile the other way than the GDTF files, Vizi Beam both axes, X-Dot Max pan. First attempt: P inv / T inv in
  the MagicQ patch (the CSV import applies neither column in Readdress nor in Morph and Readdress — tested). Dropped:
  the flags are part of the show (its palettes were recorded with them), so the show was reloaded from the pre-flag
  auto backup and the difference is carried by the HighAsCG patch instead ([WO-1113](./1113_WO_previs_decode_honours_patch_invert.md)).
- **Position palettes re-aimed** with Plot ▸ FOCUS HOLD (all heads selected, target clicked on the plan) and REC onto the
  existing palette = **merge**: CENTRE and SRODEK (0, −5.5 m), FRONT (0, −1), MOWNICA (4, −1.5 — a guess for the
  lectern), PROWADZACY (0, −2), BAND (8, −6: audience right, per the scenography render), WYBIEG (0, +5: the catwalk),
  GRUBSON (0, −3). Fan / shape palettes (OUT, CROSS…, UP…, HOME FAN, numbered) are head-relative and left as they are.
- Verified: status line "Merged into Palette entry …" for each; after CLR, all heads @ FULL + WYBIEG → previs
  screenshot shows the beams meeting on the catwalk; + CENTRE → on stage centre. Show saved (`gutmanny26.shw`).

## Not done / not verified

- Palettes not re-aimed: Q ENTRY, TANCERKI, CENTRE FAR, FRONT ENTRY, DRUM / VOC / GIT / BASS (greyed = no data for
  these heads), LEFT / RIGHT / far …; cue stacks not played through after the re-aim.
- X-Dot Max: the desk's tilt for a floor target decodes ~21° higher than HighAsCG's own aim (ratio ≈ 0.79 — the desk
  personality and the GDTF disagree on the tilt range; which one matches the real head is unknown). X-Dot bars: no
  match at all yet.
- Pixel Strobe (0/36) and X-Dot (0/28) decoded dark at "@ FULL" with no colour in the programmer, likewise the six
  Robin Mode 1 heads — not yet checked with a colour.
- Four vdim children show an address in the export (0701 29-215, 0702 44-261, 0703 44-276, 0704 10-186) — left.
- The project's stored looks (WO-1107 / WO-1111) were made for the earlier modes; in visualise mode the previs shows
  the desk, not them.
