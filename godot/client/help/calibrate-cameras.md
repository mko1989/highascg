# Calibrate tracking cameras

Teach HighAsCG where a tracking camera stands and how its lens bends the picture, by clicking known stage points in
its picture. With a good calibration, a person's feet in the picture become a real position on the stage, which
is what follow, zones and PSN output use.

Where: **Previs → Camera**, then on the Inspector: pick the camera, mode **Calibrate**.

## Before you start

1. **Add** a camera, give it a name and pick its **Source** (the input or channel the camera arrives on).
2. Check **Raster W / H px** matches the real picture size (it follows the source until you click a point).
3. Set the **Floor grid** (width, depth, spacing in metres) to match the tape you put on the real floor. Its corners
   and crossings are the points you click.

Coordinates are metres from the stage origin: X = stage left, Y = upstage, Z = up.

## 1. Click the points

1. In the camera view, the green grid and the dots are where the camera *thinks* each point is.
2. The active point is highlighted in **Calibration points**. Click where that point really is in the picture. The
   list moves on to the next unclicked point by itself.
3. To jump to a specific point, ctrl+click near it, or pick it in the list.
4. Click at least **4** points, spread over the whole picture: corners first, then the far side and the middle.

In the view: the mouse wheel zooms, right-drag pans and **F** fits the picture. Zoom in for precise clicks.

## 2. Solve

1. Press **Solve**. The status line shows the **RMS** error in pixels, the worst point and the method.
2. A red line from a click to its dot is that point's error. A long one usually means a mis-click: select the point,
   **Clear click**, and click it again.
3. For a wide or cheap lens, tick **Fit lens** and Solve again. This solves the lens bend too: click many grid
   crossings, 8 or more, across the whole picture, including the edges.

As a guide: under about 2 px RMS is good. On this box a 1080p camera reached 0.7 px with Fit lens.

**Clear all** starts the calibration again.

## Calibrating on a person

If the floor is hard to see (dark stage, no tape), use people instead:

1. Make stage marks first in **Lighting → Calibrate heads**, measured on the real floor.
2. Turn on person detection (mode **Detect**).
3. One person stands on a mark, alone in this camera's picture, with their feet in frame.
4. Under Solve, pick the mark and press **Person is on ‹mark›**. Their feet become a point and it solves.

Repeat on other marks. The same mark again replaces its point. It refuses with a reason when detection is off,
nobody or several people are seen, or the feet are cut off at the bottom of the picture.

See also [Calibrate heads](calibrate-heads.md) · [Calibrate a PTZ camera](calibrate-ptz.md)
