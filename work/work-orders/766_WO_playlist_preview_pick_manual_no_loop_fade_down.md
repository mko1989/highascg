# WO-766 — Playlist workflow: drop media on the layer list, Manual Next no longer loops, pick / Next on preview, ↘ fade down when done

**Area:** engine, godot-client
**Status: IN PROGRESS (25.10) — offline-verified (smoke 9/0, test:ci 3332/0, Godot 21760/0, client boot check); node restart + client relaunch + owner QA pending**

Owner 25.10:
> the playlist workflow for layers. first of all i should be able to add a layer to a look by draging media onto the
> layers list. then when playlist is selected as workflow, ive added media files, they do not have loop on the clips
> and the loop playlist is not selected, the first clip on the list still loops. it doesnt let me change the item on
> the list when its not on program. ridicules, thats what the preview is for. to the existing options add a fade down
> when done, should be labeld with an arrow pointing diagonaly bottom right. this should set the item to play and fade
> out the clip at the end (default half the frames that the frate rate is , in my case 50/2=25frames fade out.

## Investigation

1. **Layer list drop.** The look editor's layer list (`look_editor.gd` `_list`, an ItemList; `live_tab.gd:103` "the
   compose frame + layer list stay in the workspace") had no drop forwarding. Only the compose frame took drops
   (`_frame.set_drag_forwarding(..., _can_drop, _drop)`), and `_can_drop` rejected a multi-select drag (no `value`).
2. **"The first clip still loops."** Live `/api/playlist/state` + autosave: "Look 3 (copy)" L11, 21 clips with no
   loop tick, `playlistLoop: false`, **`playlistAdvance: 'manual'`**, recalled on PRV ch2. WO-224 T224.6 made a
   Manual Next list loop every item until Next: `scene-take-lbg-jobs.js:216-219` (`isLoop = true` for manual) and
   `stagePlaylistItem` (`loop: layer.playlistAdvance === 'manual' || …`). So item 1 loops whatever the ticks say.
3. **"It doesn't let me change the item when it's not on program."** The inspector's Next went to
   `/api/playlist/edit/next`, which refused with 409 "This look is not on program — Next works while it plays."
   (`routes-playlist-edit.js:109`). The inspector rows had no pick at all. The server already had the preview path:
   `set_start` and `step_preview` (WO-347 / WO-371 C / WO-581, `routes-playlist.js:139-181`) move the start item and
   re-stage a PRV recall with the schedule-free `stagePlaylistItem`. Only the footer Playlists panel used them.
4. **Fade down.** The existing layer `fadeOnEnd` (`clip-end-fade.js`) fades by MIXER OPACITY, then STOPs and MIXER
   CLEARs the layer (`:212-226`), which would end a playlist and leave the opacity state to restore. Probed Caspar
   instead (25.10, hidden layer 3-950 at 1 % fill): `PLAY` a 7.04 s clip, then `LOADBG 3-950 EMPTY MIX 25 AUTO`. The
   transition began at 6.64 s (25 channel frames = 0.5 s at 50 fps before the end) and the layer held `color` at
   7.10 s. So Caspar fades a clip out ending exactly at its last frame, with no opacity involved. OSC does not clear
   the old file fields on the swap to `color` (`osc-state-layer.js:145-175`), so the end can't be seen there; an auto
   list moves on by the remaining time OSC reported while the item played.
5. `scene-take-lbg-playlist.js` was at 500 lines; `look_editor.gd` and `router.js` at 500 too.

## What was done

- **Drop on the layer list** — `look_layer_ops.gd drop_sources(data)`: a single source or a `{type:"multi"}` drag, never
  an effect or a playlist row. `look_editor.gd`: the list gets the same drag forwarding as the frame, and a drop adds one
  layer per source in drag order (frame and list alike), stopping at the first refusal.
- **Manual Next no longer loops** (reverses WO-224 T224.6). Only the item's own Loop loops. A plain item plays once
  and holds its last frame until Next. `triggerPlaylistAdvance` no longer arms a preload / timeless timer for a manual
  list: an AUTO preload behind a non-looping clip would have auto-advanced it.
- **Pick / Next off program** — `routes-playlist-edit.js`: `handleNext` off program → `step_preview` (direction next).
  New `POST /api/playlist/edit/pick {sceneId, layerNumber, index}` → `goto` on program, else `set_start`. Describe
  returns `currentIndex` (playing on program, else the start item) and `fadeFramesDefault`. Inspector
  (`playlist_section.gd`): a double-click (or Enter) on a row picks it, ▸ marks the current item, and Next re-describes
  after it moves. Double-click rather than single, so a drag-reorder on a live list never jumps on air.
- **↘ fade down when done** — new `src/engine/playlist-fade-out.js`. A ↘ item (`item.fadeOut`, timed clips only) plays
  once and `LOADBG ch-l EMPTY MIX n AUTO` is queued behind it. n = the layer's `playlistFadeFrames`, else half the
  channel rate (`resolveChannelFramerateForMixerTween`: 50 → 25).
  - Where the fade is queued: the take's start item (on PRV too, since a fade is not an advance and WO-371 C holds),
    each `stagePlaylistItem` (Next, goto, PRV re-stage) and an OSC-detected auto advance.
  - Auto lists: no AUTO preload behind a ↘ item. `scheduleFadeEndAdvance` arms one timer per item from OSC
    elapsed/duration (the timer lives in `playlistImageTimers`, so takes and hops clear it), then the next item MIXes
    in from the empty layer (a fade up). The stall watchdog skips ↘ items.
  - Planner (`playlist-edit.js`): `item {fadeOut}` and `loop` exclude each other, a still is refused, and
    `settings {fadeFrames}` takes 1…250 (0 = default). `scene-take-payload.js` carries `playlistFadeFrames`.
  - Inspector: a "↘" check column next to Loop (not on stills), the ✕ moves to it, and a "↘ Fade frames" field shows
    the default until set.
- Room: the path-matching helpers moved to `src/engine/playlist-path-match.js` (re-exported unchanged). The router
  comment went inline.

## What was VERIFIED

- `tools/smoke/smoke-wo766-playlist-fade-preview.test.js` 9/9 (added to the curated list). It covers: planner
  exclusivity and still refusal; 50 → 25 and 25 → 13 frames, the layer value winning; Manual Next onto a plain clip
  (`loop:false`, nothing armed); onto a ↘ clip (LOADBG, PLAY, then `EMPTY {auto, MIX, 25}`); a take with a ↘ start
  item on ch1 (program) and ch2 (PRV) queuing only the fade; one advance timer per item with stale OSC never re-arming;
  a manual take job without LOOP; `handlePick` off program setting the start item; describe rows.
- `smoke-wo603-playlist-edit` repointed: Next off program is no longer 409; it goes to `step_preview`, which answers
  "No playlist on that look/layer" in the test (no project look there).
- `npm run test:ci` 3332 pass / 0 fail. API contract regenerated (`docs/wiki/api/contract/http.md`, +1 route).
  Godot 21760/0 (+`test_drop_sources_wo766`), `run-client.sh --check` boot OK, 500-line check 0 over, eslint 0
  errors (one older warning in `shouldForceAdvance`).
- Live Caspar: the `EMPTY MIX n AUTO` timing above (probe only; the engine path itself is not live-run yet).
- **Pending:** node restart + client relaunch. Then live: pick and Next on the PRV recall of "Look 3 (copy)"; a manual
  item holds instead of looping; tick ↘ on an item and watch it fade out over 25 frames at its end; drop media on the
  layer list. Owner QA.
