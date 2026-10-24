# Calibrate a PTZ camera

Make a PTZ camera frame people exactly where it should, by turning it onto a person standing on stage marks.
Each mark becomes a pin; between marks the camera follows the nearest pins.

Where: **Previs → Camera → PTZ cameras**, pick the camera, then open **Calibrate on a person**.

## Before you start

- The camera's position is set in its PTZ settings.
- Stage marks exist, measured on the real floor (**Lighting → Calibrate heads**, see
  [Calibrate heads](calibrate-heads.md)).

## Steps

1. Open **Calibrate on a person**. The camera is now held on your angles: the Auto director leaves it alone.
2. Someone stands on a mark. Pick that mark in the list.
3. Turn the camera onto them with the **Pan / Tilt** buttons: ±5° coarse, ±0.5° fine. Set **Zoom** if you want a
   closer look (−1 leaves the zoom alone).
4. When they are framed as you want, press **Camera is on the person at ‹mark›**.
5. Repeat for more marks, spread over the stage.
6. Press **Done** to save the pins into the camera.

**Undo** removes the last pin, **Clear** removes them all. Closing the fold without **Done** releases the camera and
saves nothing. The camera is let go by itself 60 s after the last action if the client goes away.

See also [Calibrate tracking cameras](calibrate-cameras.md)
