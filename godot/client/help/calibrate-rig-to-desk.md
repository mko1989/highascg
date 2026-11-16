# Calibrate the rig and hand it to the desk

The pre-show file (MVR from Capture, Vectorworks, the desk…) says where every head should hang. The real rig never
hangs exactly there. HighAsCG measures where each head really is, from beams aimed at taped marks, and writes an MVR
(or a position table) your lighting desk can load. Positions and XYZ palettes on the desk then land where they should.

**The 3D view never moves a head.** What you see in the previs stays the patch; the measured pose is kept beside it
and shown in the Inspector as a "Desk pose" line. Only the export uses it.

## 1. Marks

Tape 4 or more crosses on the real floor, spread over the whole stage, and enter them with their **measured** X / Y / Z
(see [Calibrate heads](calibrate-heads.md), step 1). **Preset marks** adds the floor grid's corners, edges and centre.

## 2. Measure the heads

Either way, the real head is aimed with the Programmer (or the desk) and nothing is sent to it by HighAsCG.

- **One head:** select it, **Calibrate position…**, put its beam on each mark in turn (see [Calibrate heads](calibrate-heads.md)).
  From 4 marks on, HighAsCG solves where the head hangs: X / Y / Z and its turn, and its pitch / roll when the marks
  show them.
- **The whole rig:** **Calibrate the rig…** picks a few anchor heads (one or two per truss), asks for 4 marks each,
  one prompt at a time, and infers every other head from them.

## 3. Read the verdict

Each measured head gets a line under **Calibrate heads**:

`Desk pose (measured · 4 marks): 0.39 m from the patch, turned 2.5° — good: fit 0.08°, worst 3 cm (USL)`

- **good** — the marks agree; use it.
- **weak** — 3 marks, or marks nearly in a line: the position may be off. Add a mark on the far side.
- **bad** — one mark misses by a lot (named), or pan looks mirrored. Check that mark's tape and numbers, or the
  head's pan invert, and measure again.
- "pitch / roll as patched" — the marks did not show a tilt, so the patch's pitch / roll is kept. "pitch / roll
  solved" — the marks showed one (a raked pipe, a turned clamp) and it is used.
- **inferred** heads were not measured. They follow their truss's anchors: good when the truss is rigid, not when
  each clamp is off on its own. Measure any head that must be exact.

**Clear** drops a head's measured pose with its pins.

## 4. Export

**Export calibrated rig…** (in **Calibrate heads**, or **Previs → MVR**). Pick the file type:

| File | What is in it |
|---|---|
| `.mvr` | The pre-show MVR itself, with only the measured / inferred heads' positions changed. Same fixture IDs, UUIDs, addresses, modes and GDTFs. A comment at the top lists every head: calibrated / inferred / unchanged, how far it moved, its fit. Heads HighAsCG added go on a "HighAsCG fixtures" layer, the marks on "HighAsCG marks" as focus points. |
| `.magicq.csv` | MagicQ's own Import Heads table (head no, DMX, X / Y / Z, RotX / RotY / RotZ). |
| `.csv` | A position table in the MVR / grandMA3 frame, with status, move and fit per head — for paperwork or by-hand entry. |

## 5. MagicQ

Tested with MagicQ PC 1.9.8.3 (demo mode) on this box.

- **A new or empty show:** Setup → File Manager → pick the `.mvr` → **MVR GDTF Data**. The heads arrive patched at
  the calibrated positions.
- **A show that already has the rig:** do **not** import the MVR again — MagicQ adds the heads a second time (the
  old ones end up unpatched). Use the CSV instead: Patch → View Chans → **Import Heads** → the `.magicq.csv` →
  **Vis data only**. It changes only position and rotation, matched by DMX address.
- Check it in Patch → View Vis → **Vis Heads**: X / Y / Z and X / Y / Z rot equal the file.

MagicQ's frame (ChamSys manual, trackers.html): Y is up and "Z positive towards the audience"; X is the MVR's X.

## 6. grandMA3 — not tested on a console

From the grandMA3 2.5 manual (help.malighting.com, sc_psr.html, patch_position_fixtures.html):

1. Menu → Show Creator → **Partial Show Read**, tap **MVR**, pick the file.
2. Matched rows are the fixtures both sides have. Tap **Use MVR Position/Rotation Columns** to take position and
   rotation. "Patch, Position, and Rotation properties can be imported individually."
3. Leave **Merge MVR** off unless you want heads the show does not have.

MA matches fixtures by "Fixture ID, Channel ID, GUID, Name"; the export keeps all four. PSR clears the programmer.

## Conventions

| | X | Y | Z | Rotations |
|---|---|---|---|---|
| HighAsCG marks, MVR, grandMA3 | stage left + | upstage + | up | MA: X tips the top downstage, Y towards stage left, Z counter-clockwise from above |
| MagicQ | stage left + | up | towards the audience + | RotY = −turn, RotX = pitch, RotZ = roll (+180 on the floor) |

Metres and degrees everywhere (the MVR itself stores millimetres). A head hung straight down reads 0 / 0 / 0.

## Limits

- Nothing here has been tried on a real rig or on a real grandMA3 yet.
- Inferred heads carry their truss's average error; a clamp that is off on its own needs measuring.
- grandMA3 does not document the order its three rotations combine in; the `.csv` writes Z·Y·X, within 0.1° for the
  few-degree tilts of a rig. The `.mvr` carries the exact matrix — prefer it.

See also [Calibrate heads](calibrate-heads.md) · [PSN output to a lighting desk](psn-output.md) ·
[Fronts under a desk fader: MagicQ](desk-feed-magicq.md) · [grandMA3](desk-feed-grandma3.md)
