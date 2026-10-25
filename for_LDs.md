# HighAsCG for lighting designers: calibrate the rig on site, fix the show on the desk

You program the show before you get to the venue, against a 3D model. On site the real rig never matches the model
exactly: a truss hangs 20 cm lower, a head is a clamp further along, a yoke sits a few degrees round. HighAsCG lets you
measure that difference with the real heads on real floor marks, then send the corrected rig to your console. The show
you prepared then lands where it should on the real stage.

> **Status:** steps 1 to 3 below work today. The export to the desk (step 4) is **not built yet**. See
> [What exists today](#what-exists-today).

## The idea in one paragraph

Your desk aims at positions in its own 3D stage. If the desk believes a head hangs at X 2.00 m and it really hangs at
X 2.30 m, every position aimed through the 3D stage misses by the same error. Calibration measures where each head
really is, using beams pointed at marks you've measured on the real floor. HighAsCG then writes that corrected
position (and rotation) into an MVR file. The desk imports the file over its existing fixtures, its 3D stage now
matches the room, and positions defined in stage space re-aim themselves.

## What gets fixed, and what doesn't

This decides how you should program the pre-show.

| Programmed as… | After the desk takes the calibrated MVR |
|---|---|
| Positions in stage space: the desk's 3D or XYZ positions, focus on a marker or point, tracking (PSN) | **Fixed.** The desk recalculates pan / tilt from the corrected fixture position. |
| Raw pan / tilt values in a palette | **Not fixed.** The values stay what they were, so the beam goes where it went before. Re-focus those palettes by hand. |

So in pre-show, build every position that has to hit a real spot (marks, a lectern, a band riser, the audience) as a
stage-space position wherever your desk allows it. Use raw pan / tilt only for looks where a few centimetres don't
matter (sky effects, flyouts, ballyhoos).

Whether, and how, your desk recalculates stage-space positions after a fixture moves depends on the desk and its
software version. **Check it once in pre-show:** move one fixture 1 m in the desk's patch and see whether your
positions follow.

## The workflow

### 1. Pre-show: one MVR file for everything

1. Build the rig in Capture (or your own tool) and export it as **MVR**.
2. Import the **same** MVR file into your desk and into HighAsCG (**Previs → MVR → Import…**).
   HighAsCG keeps every fixture's MVR id (UUID). That is what lets the desk update the same fixtures later, rather than
   adding a second rig.
3. Program the show on the desk, with HighAsCG (or Capture) as the visualiser.

If the rig changes in pre-show, re-export from Capture and re-import into both. HighAsCG keeps its scene settings on a
re-import.

### 2. On site: patch and mark

1. Hang, address and patch as planned. In HighAsCG check that each head is roughly where it should be:
   **Previs → 3D → Lighting → Selected heads — patch**.
2. Put marks on the real floor: taped crosses, **4 or more**, spread out. Use both sides, downstage and upstage, and
   include the far side of the stage.
3. Enter each mark in HighAsCG (**Lighting → Calibrate heads → Place mark**, click the floor near it in the 3D view, then type the **measured** X / Y / Z).
   Coordinates are metres from the stage origin: X across the stage, Y upstage, Z up (0 on the floor). The origin
   must be the same point as in your MVR file. Measure from the point Capture used, usually downstage centre.

Measured values matter. A click in the 3D view is only a starting point.

### 3. On site: calibrate every head

For each head:

1. Click the head in the 3D view, then **Calibrate position…**.
2. Aim the **real** beam at a mark with the desk (or HighAsCG's Programmer), so the centre of the beam sits on the
   tape.
3. Pick that mark and press **Beam is on ‹mark›**. HighAsCG never moves the real head; it only reads where the head
   is pointing.
4. Repeat on at least 3 marks, preferably 4 or more, spread around the stage.

Full how-to inside the app: the **?** on Calibrate heads.

HighAsCG's own 3D view is corrected at once: on each mark you pinned, its beam lands exactly on the mark. If the marks
don't agree on one correction, the app says the head isn't where it's patched and suggests where the marks put it
(“the marks put it near X … Y …”). Follow that hint (fix the head's position in the patch, **Clear**, pin again) before you export. The desk
can only use a correct position, not the pins.

### 4. Send the calibration to the desk (not built yet)

1. **Previs → MVR → Export calibrated rig…** writes an MVR with every calibrated head at its solved position and
   rotation, under the same fixture ids as your pre-show file. The marks go in as MVR focus points.
2. On the desk, import the MVR **as an update of the existing fixtures** (merge by fixture id). Take position and
   rotation only. Keep the desk's patch, addresses and modes.
3. Check: call up a few stage-space positions and look at the real beams on the marks.

Your pre-show work now plays on the calibrated rig. Positions in stage space land on the real stage; raw pan / tilt
palettes are the ones left to touch up.

## Why the desk gets a position, not the pins

HighAsCG's own correction is a set of **pins**. On each mark, the 3D beam is moved onto the mark, and between marks it
blends the nearest pins. That makes the visualiser exact on every mark, even when a head is mounted oddly.

An MVR file can't carry pins. Per fixture it carries a position and rotation in the room, which is also all a desk's 3D
stage knows. So the export **solves** each head's real position and rotation from the same mark readings, and writes
that.

- With 3 or more good marks per head, the solved position is what makes the desk's stage-space positions accurate.
- A head that only fits its marks with large pins (a bent yoke, a wrong hang) will also be off on the desk. Fix the
  hang or the patch, not the numbers.

## Tips

- **Same origin everywhere.** Capture, the desk and HighAsCG must agree on where 0,0,0 is and which way Y points.
  Settle it in pre-show and mark the origin on the real floor first.
- **Spread the marks.** Four marks in one corner calibrate one corner. The far side of the stage is where errors show.
- **Re-check after a re-hang.** A truss that moves after calibration invalidates every head on it. Re-pin, re-export.
- **Floor marks vs people.** For follow or tracking shows, calibrate on a person standing on the mark (**Person on
  the mark**), so the pin is taken at the height you actually light.
- **Live tracking instead of positions.** For moving performers, HighAsCG can send tracked positions to the desk as
  **PSN** (**?** on PSN output). The desk does the aiming from its own patch, so it needs the calibrated positions too:
  same export, same import.

## What exists today

| Step | Status |
|---|---|
| MVR import (scene, fixtures, GDTF types), keeping each fixture's MVR id | ✅ built |
| Floor marks with measured X / Y / Z | ✅ built |
| Calibrate a head on marks (reads the real pan / tilt, never moves the head) | ✅ built |
| HighAsCG's 3D beam corrected per mark (pins) | ✅ built |
| "Head isn't where it's patched — marks put it near X / Y" hint | ✅ built |
| PSN output of tracked positions to the desk | ✅ built |
| Solve each head's full position + rotation from its marks, for export | ⬜ **to build.** A position + yaw solve exists in the tracking calibration and has to be brought to Calibrate heads, with hang tilt and roll added. |
| Export the calibrated rig as MVR (same fixture ids, marks as focus points) | ⬜ **to build.** The MVR export today writes LED walls / screens only. |
| Tested import into grandMA3 / MagicQ (update existing fixtures by id) | ⬜ **to test** on each desk. |
