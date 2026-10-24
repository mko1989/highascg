# Calibrate heads

Point each real moving head at real marks on the stage, then tell HighAsCG which mark the beam is on. The 3D beam
then lands exactly where the real one does. **Nothing is sent to the fixture and the head never moves**: you aim it
with the Programmer (or your console) as usual.

Where: **Previs → 3D → Lighting → Calibrate heads** (just below the Programmer).

## Before you start

- The head is patched and roughly in the right place: **Selected heads — patch** has its position and hang.
- The real head gets its pan / tilt from somewhere this box can read: the Programmer above, or your console's
  Art-Net coming into this box (Follow → Art-Net backup with read-through).
- You have a tape measure. Marks are positions in metres from the stage origin: **X** = stage left, **Y** =
  upstage, **Z** = up (0 on the floor).

## 1. Put marks on the stage

1. Tape a cross on the real floor at each spot. Use 4 or more, spread out: both sides, downstage and upstage,
   and include the far side of the stage.
2. Press **Place mark**, then click that spot on the floor in the 3D view. A "Mark N" appears.
3. Type its name and the **measured** X / Y / Z. The measured values matter; the click is only a rough start.

**Preset marks** adds the tracking grid's corners, edge middles and centre in one go (**Previs → Camera → Floor grid** sets
the grid). Tape those spots on the real floor too.

## 2. Pin each mark

1. Click **one** head in the 3D view.
2. Press **Calibrate position…**.
3. Aim the real beam at a mark with the Programmer, so the centre of the beam sits on the tape.
4. Pick that mark in the list, then press **Beam is on ‹mark›**.
5. The 3D beam jumps onto the mark, and the pin is saved into the head's patch at once. Repeat for the next mark.
6. Press **Done** when every mark is pinned.

Each mark becomes a pin. On a pin the 3D beam is exact; between marks it follows the nearest pins. That is why
marks spread over the whole stage work better than many marks in one corner. Pinning the same mark again replaces
its pin, it does not add weight.

**Undo point** removes the last pin.

## Calibrating on a person

To calibrate where the head will actually follow people, not the floor:

1. Someone stands on the mark.
2. Tick **Person on the mark**.
3. Aim the beam at them (chest height, where you want followed people lit) and press **Beam is on the person at
   ‹mark›**.

The pin is taken at the head's aim height. While tracking detection runs, a line tells you how far the nearest
person is from the mark. Past 0.5 m it asks "is someone on the mark?".

## Beam offset (manual trim)

The **Beam offset Pan / Tilt** boxes turn only the 3D beam, for a small constant correction. The real head is not
sent anything. **Clear** ends the session and drops this head's trim and every pin.

## If it does not look right

- **Marks far from the pinned ones are off by metres.** The head is probably patched in the wrong spot. Measure
  its real position and fix it in **Selected heads — patch**, then **Clear** and pin again.
- **Calibrate position… is missing.** Select exactly one head.
- **"DMX output is off for this head's universe".** The head's universe is not on the wire, so the real head is
  not where the Programmer says. Turn on DMX output (or the console's feed).

See also [Calibrate tracking cameras](calibrate-cameras.md) · [Calibrate a PTZ camera](calibrate-ptz.md) ·
[PSN output to a lighting desk](psn-output.md)
