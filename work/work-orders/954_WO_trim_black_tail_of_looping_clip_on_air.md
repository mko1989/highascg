# WO-954 — A looping clip with black frames at its end, on air: what a media-browser trim does, and how to fix it live

**Area:** engine, media, godot-client
**Status: DONE (05.11.26 — investigation measured frame by frame on the second dev box's PGM / PRV, no code change; follow-ups listed) — owner informed**

Owner 05.11: *"i got a video loop to play as a background for an artist. during the show it occured to me that the loop
has a black frame (or a couple of black frames) at the end of the video file. would trimming that file from the media
browser affect the playout on pgm? run tests to see if it can be done and tell me how."*

Related: [WO-592](./592_WO_media_library_links_versions_inspector.md) (per-file trim defaults),
[WO-570](./570_WO_look_layer_media_transport_trim.md) / [WO-813](./813_WO_look_layer_custom_clip_start_trim.md) (look-layer
trim, LENGTH on take), [WO-949](./949_WO_timeline_look_transition_tests.md) (the frame probe).

## 1. Investigation

- **Code.** The media browser's In / Out are per-file defaults:
  - saved with `POST /api/media/library/defaults` (`godot/client/features/live/media_inspector.gd` `_save`), stored in
    the media library registry;
  - read in one place only: `src/api/routes-scene-new-layer.js:120-127`, when a clip is dropped onto a look and becomes
    a new layer;
  - the take uses the layer's own `trimInMs` / `trimOutMs` (`scene-take-lbg-jobs.js` → `LENGTH`, WO-813).
  So the media-browser trim cannot reach a layer that already exists, on air or not.
- **Test clip.** `zz_blacktail.mp4`: 1280×720, 50 fps, 200 frames. Frames 0–196 are a red ramp on blue (red = the
  frame), frames 197–199 are black (luma 16, checked with ffmpeg signalstats). It played as a looping look layer on
  PGM ch 2.
- **Measurement.** A temporary `ADD 2-749 SHM NAME zzprobe` (and `3-749` for PRV), read with
  `tools/test-live/pgm_probe.py` over the clip's area. Black runs and ramp steps are counted per frame.
  - Two full-canvas probes at once slowed Caspar to about 44 fps. One probe kept 49–50 fps; the conclusions below come
    from the one-probe runs.

| Step | PGM (ch 2) | PRV (ch 3) |
|---|---|---|
| Baseline, loop on air | 3 black frames at every wrap (2 wraps in 10 s) | — |
| Media browser Out = 3.94 s (defaults saved: `{"trimOutMs":3940}`) | **still 3 black frames at every wrap**; the look layer still had no trim | — |
| Look editor → layer → Trim → Out = 3.94 s | unchanged (PGM is never a target) | **still black**: the edit sent only `MIXER 3-10 FILL/ANCHOR/ROTATION/OPACITY`, no reload with LENGTH |
| One click on the look card (stage on PRV) | — | **0 black frames** over 9 s, wraps every 3.94 s |
| TAKE, clip start "Start from beginning" | a 25-frame MIX into the loop restarting at frame 0; then **0 black frames** at every wrap | — |
| TAKE, clip start "Relative to the clip playing on this layer" | a 25-frame MIX into about the same point (measured ~30 frames behind the outgoing frame); then **0 black frames** | — |

- One take run showed a 3-frame dip (to rgb 6,6,100). It happened while two probes were overloading Caspar, and the
  one-probe repeat of the same take was a clean mix. It is recorded as a load artefact, not a product behaviour.

## 2. What was done

No code change. The answer to the owner:
- The media-browser trim does not touch PGM, the look, or a retake of the look. It only sets the file's defaults for
  layers made from it afterwards.
- To fix it on air: Edit look → select the layer → Trim → Out (the end minus the black frames), then stage the look on
  PRV to check, then TAKE.
  - "Relative to the clip playing on this layer" keeps the background roughly where it was.
  - "Start from beginning" mixes into the loop's first frame.
- Afterwards, also set the media-browser Out, so the clip comes trimmed the next time it is dropped in a look.

## 3. Verified

Every row of the table was measured on the second dev box (PGM ch 2 / PRV ch 3), with AMCP from the server journal.
Cleanup:
- the test look was deleted through the deck;
- the test clip was deleted through the media inspector, and its defaults went with it;
- the probes were removed;
- `CLEAR 2-10`, `2-110` and `3-10` were sent; PGM layer 1 (there before the test) was untouched.

## Follow-ups (owner 05.11)

1. A layer trim edit restages PRV with the new LENGTH: **done in [WO-955](./955_WO_trim_edit_restages_prv.md)**. Step 3
   (the card click) is no longer needed.
2. "Apply trim live to PGM": **declined by the owner**. The fix on air stays layer trim, then TAKE.
