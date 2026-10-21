# Texturing a person from 2–3 cameras onto a dummy in the Godot previs

Owner question, 21.10.2026: *"It's a game engine. How viable would be texturing a person from 2-3 camera angles and
overlay it on a dummy?"*

## Verdict

**Viable, in three steps.** Most of the hard groundwork already exists on this box. Each step is useful on its own.

| Step | What you see | Effort | Quality |
|---|---|---|---|
| 1. Cut-out card | The person's live picture, background removed, standing at their tracked spot and turned toward the viewer | 2–3 days | Good from near a camera angle; flat when seen from the side |
| 2. Projected onto a dummy | A mannequin at the tracked spot, "painted" by the 2–3 cameras with live video | 1–1.5 weeks | Convincing on the body; arms and legs smear, because the dummy doesn't move like the person |
| 3. Posed dummy | The same as step 2, with the dummy's skeleton following the person's pose (3D pose from 2+ cameras) | +2–3 weeks | Good from the front half; the back is still guessed when no camera sees it |
| (Not this box) Volumetric capture | Full 3D person you can orbit 360° | — | Needs 8+ synced cameras and offline-grade compute; not a live previs feature |

**Recommendation:** build step 1, then step 2. Decide on step 3 after seeing step 2 on the real rig. The dummy
silhouette is what makes step 2 look wrong or right, and that is easy to judge once it runs.

## Why it is viable here (what already exists)

From [WO-616](../../work/work-orders/616_WO_previs_tracking_openfollow_cameras.md) and [WO-607](../../work/work-orders/607_WO_godot_previs_native_3d.md):

1. **Live camera video in Godot.** DeckLink input → Caspar channel → shm surface `inN` → Godot texture. The camera
   view already draws it, with no extra encode.
2. **Calibrated cameras.** Each camera has a solved pose, field of view and lens distortion (k1, k2). The box
   measured 0.71 px RMS. That is the projector matrix projective texturing needs, so this is the hardest part, and it is done.
3. **Where the person is.** YOLO detection, ByteTrack and two-camera fusion give a world position per person
   (WS `world` block, the P-tags in the 3D view).
4. **A real 3D engine.** Godot does projective texturing in an ordinary spatial shader; the RTX PRO 4000 (24 GB) has
   plenty of headroom for 2–3 camera textures at 1080p.

## How each step works

### Step 1 — cut-out card (billboard)

- Per tracked person, take the camera that sees them best (closest and most frontal) and crop their detection box.
- Remove the background with a segmentation mask (YOLO-seg, the same ONNX path as the detector), then upload it as the
  card's alpha.
- Place a quad at the fused world position, scaled to the person's measured height, turned to face the viewer.
- New pieces: the mask in the detection sidecar, and a small `PersonCard` node in the previs.

### Step 2 — projective texturing onto a dummy

- Put a neutral mannequin mesh at the tracked position, scaled to the person's height.
- In its shader, each vertex/pixel is projected into every camera with that camera's solved matrix (+ k1/k2), and the
  colour is read from that camera's live texture.
- **Blend weight** per camera = how directly the camera faces that surface (normal · view direction), times
  **visibility**. Visibility comes from a depth map per camera (the classic shadow-map test), so the front camera does
  not paint the person's face onto the back of the head.
- Only pixels inside the segmentation mask count, so the stage behind the person is never painted onto the dummy.
- Surfaces no camera sees get a flat body colour, sampled from what is visible.

### Step 3 — posed dummy

- Run a pose model (YOLO-pose, 17 body keypoints) on each camera, then triangulate the keypoints into 3D with the
  calibrated cameras. The fusion engine already does the same for floor positions.
- Drive a rigged mannequin's `Skeleton3D` from the 3D keypoints, smoothed with the same kind of Kalman filter as the
  tracker.
- With the limbs in the right place, step 2's projection lands on the right body parts, and the smearing goes away.

## What limits quality (honest list)

1. **Resolution.** A person 10 m away in a wide 1080p shot is roughly 200–300 px tall, so the face is a handful of
   pixels. Tighter lenses, or a third camera closer to the action, help more than anything in software.
2. **The unseen side.** With 2–3 cameras all in front, the back is never seen. It gets a guessed colour. Putting one
   camera at a side angle covers most of a performer facing the audience.
3. **Camera sync.** Unsynced cameras disagree by up to a frame on a moving arm, which shows as a ghosted edge where
   their textures blend. Genlocked inputs fix it; without it, give the best camera most of the weight.
4. **Colour match.** Two cameras rarely agree on white balance or exposure, so seams show. A per-camera gain/tint,
   set once from a grey card, is enough.
5. **Latency.** Detection, then pose, then render adds frames. Fine for previs; not frame-accurate for an IMAG
   overlay mixed against the real camera.
6. **Several people.** Step 2 scales per person. Step 3's pose cost grows per person and per camera; a GPU
   execution provider for the sidecar (it runs on CPU today, ~17 ms per frame for detection) becomes worth it.

## Suggested work order split (if you want it)

- **WO-A** step 1: segmentation mask in the sidecar, `PersonCard` in the previs, a toggle in the 3D toolbar.
- **WO-B** step 2: mannequin asset, the projective shader with per-camera depth maps, colour-match controls on each
  camera object.
- **WO-C** step 3: pose model, 3D triangulation, rigged mannequin.

Each one ends with a box check on the two real DeckLink cameras (the WO-616 rig).
