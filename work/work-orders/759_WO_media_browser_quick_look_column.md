# WO-759 — Media browser quick-look info: codec · resolution · fps · duration

**Status: IN PROGRESS (25.10) — built + Xvfb render-verified; owner GUI relaunch pending**

Owner 25.10: "in media browser we need quick look info about files ... codec hap, prores, jpg, png. resolution
(3840x1792), framerate, duration (hh:mm:ss)."

## Investigation

- The data is already on every `GET /api/media` row. The server probe (`src/media/local-media-ffmpeg.js:36-50` ffprobe,
  `src/media/cinf-parse.js` CINF) fills `codec` (ffprobe `codec_name`, lowercase), `resolution` ("W×H"), `fps` (2 dp)
  and `durationMs`. Live sample: 415 rows, e.g. `h264 · 1728×1084 · 25 · 611240`, and PNG stills have
  `codec png, resolution 4800×2700, fps 25, durationMs null`. Stills carry the channel fps, so it must not be shown for
  them. No server change is needed.
- The Sources media tree (`godot/client/features/live/media_panel.gd` `_build`) showed only the name, with id · type
  in the tooltip.

## What was done

- `features/live/media_ops.gd`: `quick_info(row)` and `hms(ms)`, pure. Codec labels: hap→HAP, prores→ProRes,
  mjpeg/jpeg→JPG, png→PNG, h264→H.264, hevc→H.265, notchlc→NotchLC, dvvideo→DV, and so on; anything else is
  upper-cased. Movies get `codec · W×H · N fps · hh:mm:ss`, fractional fps shows as `29.97 fps`, stills get codec + size,
  audio gets duration only, and missing fields are skipped.
- `features/live/media_panel.gd`: a second, non-expanding tree column in muted 11 px. It is as wide as its widest text
  but never more than 45% of the tree (`_fit_info`, refit on resize), so names keep the rest. Both columns clip. The
  name tooltip shows `id · info`; folders and effects leave the column empty. Selection, drag and metadata stay on
  column 0.
- `app/perf_probe.gd`: `--probe-shot=<png>` (with `--probe-perf`) saves the window after 10 s. This allows a render check
  on Xvfb, with no window on the owner's :0.

## What was VERIFIED

- `tests/test_media_ops.gd` `test_quick_info`: 8 cases (HAP movie, ProRes 29.97 + hours, JPG/PNG stills, unprobed,
  audio, unknown codec, empty). Godot suite 21681 / 0; `run-client.sh --check` boot OK.
- Xvfb render (`xvfb-run … --rendering-driver opengl3 -- --probe-perf --probe-shot`) against the live server, folders
  expanded for the shot: rows show `HAP · 3840×1344 · 50 f…`, `ProRes · 3840×1344 · …`, `H.264 · 1728×1084 · …`,
  `PNG · 4800×2700`.
- At the default 280 px Sources width the info is clipped after the fps. Widening the Sources split shows all of it.
- Owner QA after a client relaunch.
