# WO-865 — Demo display engine: moving PGM / PRV pictures, fades on take, live look edits, two playable placeholder videos

**Area:** godot-client, web-client
**Status: DONE (2026-10-30, Godot suite 23657/0 (+121 new in tests/test_demo_engine.gd), desktop demo on a private Xvfb with screenshots of a take mid-fade, a live PRV edit, the loop wrap, the clip start / end and a timeline on PRV; local Web export loaded and played the Theora clip in Firefox ESR). Not committed; owner eye on the GitHub Pages result still welcome.**

Owner, 30.10: "add a small display engine for the demo on github pages, so users can check out how creation and setup of
the looks look like (preferably with fades etc)". Follow-up the same day: "add a placeholder loop (10s loopable) and clip
(30s video start and finish different) videos to the godot pages demo client, so users can test with videos."

## 1. Investigation

- **The demo's pictures were stills.** `core/demo/demo_video.gd` (WO-815 phase 2) was the VideoSurfaces reader of a role:
  one CPU `Image` per look, redrawn only when `scene.live[ch]` changed (`poll()` keyed on `sceneId@updatedAt`); layer
  opacity / rotation were ignored (`look_still` only skipped `opacity <= 0`), a TAKE cut, a playing timeline never
  reached the pictures (`demo_timeline.gd` header: "no pictures"). Every consumer reads `VideoSurfaces.texture(role)`
  (`video/video_surfaces.gd:47`), a stable `Texture2D` created by `ShmTexture` and filled with `update_rgba` from
  `_process`; `features/live/live_preview.gd:205` reads only `reader.signal_lost`, `compose_tiles.gd:156` uses the texture
  as an AtlasTexture atlas, `canvas()` reads its size.
- **Where look edits arrive.** The Inspector / look editor edit the look and `features/live/preview_pusher.gd:42-48`
  sends `ProjectSync.send_deck_sync(true)` (`scene_deck_sync`, replaces `project.scenes.scenes` in
  `demo_scene.gd deck_sync`) then POST `/api/scene/preview-push`, which the demo already answered with `take(..., "preview")`:
  a fresh copy of the look in `scene.live[prv_ch]` with a new `updatedAt`. So the engine only has to read `scene.live`;
  no new client-side hook is needed, and an edit of the look already on the bus has the same `sceneId` (the node's
  "MIXER nudge" case, `layerVisuallyEqual` in `src/engine/scene-transition.js:97`), a different look is a re-take.
- **Transition length.** `src/api/routes-scene-take-look.js:55-69` takes the incoming look's `defaultTransition`
  (`{type, duration (FRAMES of the channel), tween}`; `transitionOverride` replaces it on a program take, `forceCut`
  cuts); `client/lib/transition-presets.js:7` `DEFAULT_TRANSITION` is CUT / 0; the demo looks and
  `globalDefaultTransition` carry `MIX 12 linear` and the channels run 50 fps, i.e. **0.24 s** on a box (the deck's
  "25 fr" field is the same thing). `scene-transition.js` keeps same-layer same-source layers as they are (no PLAY, no
  tween) and fades layers the incoming look does not cover (`scene-exit-layers`). Types: CUT / MIX / PUSH / WIPE / SLIDE
  (+ " + ANIMATE" on a PGM-only main).
- **Media in the demo** (`tools/demo/build-demo-data.py` MEDIA, `demo/state.json` media, `demo/thumbs.json`): all
  synthetic, one 640-wide JPEG per MOVIE / STILL (`tools/demo/build-demo-extras.py`), no real clips. Godot plays only Ogg
  Theora in-engine, so the placeholder videos are `.ogv`; the web export template used here is
  `web_nothreads_release.zip` (single thread).
- **CPU vs GPU.** At the demo's sizes (LED wall PGM 960x448, projection 960x540, operator canvas 1920x1080 with up to four
  windows) per-pixel `Image.blend_rect` / `resize` of every layer every frame is the browser's whole budget; a
  SubViewport + TextureRect + CanvasItem shader costs the CPU only the node updates (measured below).
- **Environment note (not a bug of this WO):** with `ui.cfg [live] auto = false` (this box's profile) the compose window
  layout is never created in a demo (the demo server starts with no operator cells and only Auto tiling creates them) —
  the Live preview is black. Screenshots below use a private `XDG_DATA_HOME` so Auto is on, as on a first visit.

## 2. What was done

New files, all under `godot/client/core/demo/` (≤ 270 lines each), pure model first, nodes second:

- **`demo_transition.gd`** — pure: `base_type` ("MIX + ANIMATE" → MIX, unknown → MIX, none → CUT), `seconds(tr, fps)`
  (frames / fps, CUT = 0), `ease(tween, p)` (linear, easein / out / inout quad..quint), and what a type does to the
  incoming / outgoing picture at progress p (MIX alpha; SLIDE / PUSH offset; WIPE clip; an outgoing MIX layer the
  incoming look covers stays under it, one it does not cover fades). **Demo choice:** every non-CUT transition lasts at least
  `MIN_SECONDS = 0.5` (12 frames at 50 fps is 0.24 s — over before a visitor sees it); `CLEAR_SECONDS = 0.6` for PRV
  clear / FTB (no duration in the demo's FTB route). Both are constants in this file.
- **`demo_bus.gd`** — pure model of one channel's bus. `update(entry, fx, now)` takes the live entry and how the simulated
  server got there; `frame(now)` returns draw items bottom → top: geometry from `look_thumb_math.gd` `sorted_layers` /
  `placement` (the look cards' math), `alpha` = layer opacity × transition, `rotation`, `clip`, the layer's running time `t`,
  playhead `pos` / `dur` / `loop` / `ended`, `stream` path, a name-hash `seed`. First sight of a bus = no fade (the show as it
  stands); same `sceneId` = an edit, applied at once and the running layers keep their clocks; another look = fade by `fx`
  (`at` = when the server did it, so a change noticed late is already part-way); empty entry = fade out; an unchanged layer
  (same number + source) is drawn once and not faded or restarted.
- **`demo_media.gd`** — the thumbs / Image cache moved out of `demo_video.gd` (forwarders stay there), `stream_for(id)`
  (`demo/*.ogv` → `res://`), `info(state, id)` (media list type / length).
- **`demo_shader.gd`** — one CanvasItem shader: draws the `uv_rect` window of the texture (crop / cover), `alpha`, a wipe
  `clip`, and for the synthetic MOVIE stand-ins (`motion` = 1) slow zoom + pan, a light band sweeping across and a colour drift,
  all driven by the layer's own time and seeded by the clip name (so clips never move alike); stills (STILL, real clips) get
  none of it.
- **`demo_bus_view.gd`** — a Control that draws one frame's items with a pool of TextureRects + that shader (position, size,
  rotation about the centre, uniforms); video textures come from the stage.
- **`demo_stage.gd`** — Node owned by `VideoSurfaces` in a demo: one SubViewport per role (pgmN / prvN / chN: black + one bus
  view; opgui: one clipped, scaled bus view per PGM / PRV window of the compose layout, rebuilt when the layout changes).
  The role's `Texture2D` IS the SubViewport's texture, so every consumer (Live preview, compose tiles, previs walls, look
  editor canvas) gets the moving picture unchanged; only held roles render (`UPDATE_ALWAYS` vs `UPDATE_DISABLED`). Real
  clips play in invisible `VideoStreamPlayer`s, one per layer instance, retired 1 s after nobody asks; a non-loop clip that
  ended is paused on its last frame (Caspar holds it).
- **`demo_timeline_look.gd`** — the air timeline as a synthetic live entry (clips under the playhead = layers, with their
  opacity / loop / `fillPx`), used by `demo_server.gd bus()` when its `sendTo` reaches the channel: Play puts the timeline's
  picture on PRV (sendTo preview) or PGM (Take) with a MIX fade, Stop fades back to the look.
- **`demo_server.gd`** — `bus_fx`, `buses`, `tl_shown`, `clock()` (seconds from `now_ms`), `bus(ch, now)`.
- **`demo_scene.gd`** — `take()` records `bus_fx[ch] = {kind, transition, fps, at}` (`transition_for`: the look's
  `defaultTransition`; `transitionOverride` on a program take; `forceCut` = CUT; `channel_fps`), clear / FTB record
  `ftb` / `clear`.
- **`demo_video.gd`** — kept as the RoleReader (`signal_lost`, `update_lost()`) and as the CPU fallback face for headless /
  tests: `poll()` rasterises the bus model (`raster(items, w, h, bus_size)`: scale, alpha, no rotation / clip / motion) when the
  bus or a fade moves; `look_still` now honours opacity.
- **`video/video_surfaces.gd`** (the one non-demo file touched; the real path is unchanged) — in a demo `_ensure` hands out
  `{"texture": stage.texture(role)}` instead of a ShmTexture and `_process` steps the stage instead of polling readers.
  The line `r = DemoVideo.new(role, Demo.shared())` that test_demo_phase2.gd greps is kept.
- **Videos** (follow-up): `tools/demo/build-demo-videos.sh` makes `godot/client/demo/placeholder_loop.ogv` (10 s, 640x360,
  25 fps, 446 kB: a colour plasma whose every term is a function of sin / cos(2π·t/10) plus an orbiting dot, so frame 0
  follows the last frame; label "PLACEHOLDER LOOP" + running time) and `placeholder_clip.ogv` (30 s, 1.26 MB: blue → orange
  drifting stripe pattern, big countdown 30 → 0 and a progress bar that fills); ffmpeg lavfi `color` + `geq` + `drawtext`
  only, no audio, libtheora q4. `tools/demo/add-demo-videos.py` (idempotent, run by the .sh) adds the two media to
  `demo/state.json` (MOVIE, 10 000 / 30 000 ms, 25 fps), two looks "Video loop" (loop on) / "Video clip" (loop off) to
  `demo/project.json` + the deck list, and their stills to `demo/thumbs.json`, and runs `build-demo-data.py`'s public-safe
  `scan()` on every file it writes. `build-demo-data.py` MEDIA also lists the two ids. `export_presets.cfg`: every preset's
  include filter is now `help/*.md, demo/*.json, demo/*.ogv` (confirmed: both files are in the exported `index.pck`).
  The synthetic stand-ins for all other media keep their motion shader.
- **Tests**: `tests/test_demo_engine.gd` (new, 121 assertions); `tests/test_demo_phase2.gd` `test_reader_follows_the_bus`
  advances the clock past the fade (a take no longer cuts).

### Not simulated (honest list)

Keyer / blend modes, layer effects (crop is honoured through placement; others are not), PIP overlays, templates / shaders /
live inputs on the picture (drawn black), keyframes and in / out points of timeline clips and a layer's trim, seeking a
clip (a clip appears from its first frame; Theora seeking is not used), clip audio, Caspar's own timing (fades run on this
computer's clock; a non-CUT transition lasts at least 0.5 s), rotation + wipe clip together, PGM → PRV exchange, `fadeOnEnd`.

## 3. What was VERIFIED

- **Godot suite: 23657 passed, 0 failed** (full run; the ERROR / WARNING lines at the end are the pre-existing exit-leak
  ones). `tests/test_demo_engine.gd` 121 / 0 and with `test_demo_phase2.gd` / `test_demo_server.gd` 368+ / 0 in an isolated
  run. It covers: transition math (types, frames → seconds, floor, easing, wipe never "no clip"); a take's fade — incoming
  alpha 0.1 / 0.25 / 0.5 / 0.75 at 10 / 25 / 50 / 75 % of the time, both looks on screen mid-fade, only the new look
  after, FTB / PRV clear fade to black; `forceCut`, `transitionOverride` WIPE / SLIDE geometry; a same-layer same-source
  layer is not faded or restarted; per-layer opacity in the composed frame (half opacity = half the still over black, 0 =
  black, rotation reaches the item); a PRV look edit (opacity + fill via `scene_deck_sync` + `preview-push`) changes the
  PRV frame at once without a fade and keeps the clip running; motion (two frames differ: item time and the shader's `t`
  parameter, `motion` = 1 for MOVIE only); the two .ogv are in the media list / load as `VideoStreamTheora` / have thumbnails /
  looks / deck entries and every export preset includes `demo/*.ogv`; loop wrap (pos 12.5 s → 2.5 s) and clip end
  (`ended` at 30 s, same player key); the stage builds surfaces, scaled clipped windows and retires players; a playing
  timeline fades in on PRV, Take moves it to PGM, Stop fades back; **cost: model + view update for the operator surface
  (4 windows) + pgm1 + prv1 = 0.26 ms per frame** headless (bound asserted < 5 ms).
  `node tools/ci/check-max-file-lines.js`: 0 files over 500. The public-safe test (`test_data_set_is_public_safe`, under
  1 MB, no IP / path / name) passes with the new data.
- **Desktop demo on a private Xvfb :93** (never `:0`; fresh `XDG_DATA_HOME`), real clicks with xdotool; screenshots in
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo865/`:
  - `s4.png` Live tab, moving stand-ins (zoomed, light band, colour drift); `take_fade_sheet.png` — Loop B → Song 1 wall
    crossfade over ~0.5 s on PGM 1 and PRV 1 (frames 0.12 s apart);
  - `prv_edit_live.png` — look editor on PRV: Inspector Opacity 0.4 and Rotation 12 typed, PRV 1 window and the editor canvas
    show the dimmed, rotated layer at once;
  - `clip_start_3s.png` (clip started on PRV and PGM, countdown 27 / 26), `clip_end_sheet.png` (3, 2, 1, 0 then the last frame
    held: orange, full bar), `loop_wrap_sheet.png` (label 8.1 … 9.9 s → 0.2 … 1.4 s, the dot and plasma continue without a jump);
  - `timeline_prv_sheet.png` — Timeline tab, Play: PRV 1 crossfades from Loop A to the timeline's Opener clip, the playhead runs.
  The first run showed a grey (not black) picture: the SubViewport's root Control had no size → fixed (anchors full rect).
- **Local Web export** (preset "Web", template `web_nothreads_release.zip` present in `~/.local/share/godot/export_templates/4.7.2.stable`):
  `godot/export/web-demo/` index.pck 4.88 MB (was 2.99; +1.7 MB videos +data), index.wasm 39.5 MB, both .ogv in the pck;
  served with `python3 -m http.server 8865`, Firefox ESR on :93 with its own profile: the demo loads (`w1.png`: the
  Live tab with moving stand-ins in the Compatibility renderer), "Video clip" taken to PGM: MIX fade from Opener, then the
  countdown 29 … 23 at real time on PGM and PRV (`web_clip_sheet.png`) — Theora plays in the single-threaded wasm build.
- **NOT verified:** a measured browser frame rate (it looked smooth, not timed); the published Pages site (nothing pushed);
  Windows / macOS; the loop on the Web build at its wrap (only the desktop wrap was captured); a hard seamless wrap of
  `VideoStreamPlayer.loop` (the desktop frames at 0.1 s steps show no jump, a single dropped frame would not show);
  owner's eye.

## 4. Open / uncertain

- The 0.5 s floor (and 0.6 s for clear / FTB) is a demo choice, not what the box does (0.24 s at 12 frames / 50 fps).
- Godot generated `placeholder_*.ogv.uid` files next to the videos (commit them with the videos, like the `.gd.uid` files).
- `godot/client/openxr_action_map.tres` shows as untracked in git status — not touched here.
