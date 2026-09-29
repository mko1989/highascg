# WO-581 — Playlist look taken to PGM always starts on item 1, not the item set in preview

**Status: DONE (2026-09-28 — offline suite 2518/0/2 + new smoke 4/4; deployed server + client; live PRV probe OK. Owner QA: set an item on a PRV-recalled playlist look, take it, confirm PGM opens on that item)**

Source: owner, 28.09.26:
> playlist workflow in looks. one of the workflows would be setting an item on the playlist in the
> preview and then playing the look with the set item. right now it always goes to the first item
> from list when taken to pgm instead of the one that was set in preview / or just from the compact
> playlist options

Follow-up to WO-347 (set_start) and WO-371 option C (⏮/⏭ step the PRV render).

## 1. Investigation

Two independent faults. Either one alone produces "always item 1".

**A. A look recalled on PRV was listed as LIVE, so the start item was never recorded.**
`src/api/routes-playlist.js` `handleStateGet` walked every `liveSceneState` channel, PRV
included, and pushed `live: true, channel: <PRV ch>`. On the box: "main lista" recalled on ch2
(`previewChannels: [2]`) came back `live:true channel:2`. For a live entry, the compact panel
(`client/components/playlist-control-panel.js`) sends the item dropdown as `goto` and ⏮/⏭ as
`prev`/`next`, all to the PRV channel. `triggerPlaylistAdvance` then advanced the PRV bus (and
armed PRV timers, against WO-355). `playlistStartIndices` was never written. WO-371's
`step_preview` could not be reached while the look sat on PRV, which is the one case it exists for.

**B. Even a recorded start item only arrived as a hop after item 1 was already on air.**
`src/engine/scene-take-lbg-jobs.js` hard-loaded `layer.playlist[0]` for auto lists (manual lists
used the channel-scoped runtime index, which `setupLayerPlaylists` wipes on every take, so also
0). `setupLayerPlaylists` armed item 0's timer or AUTO preload, then ran a `setTimeout(400)`
`triggerPlaylistAdvance` to the start item. The result: item 1 flashed on PGM, then a second
transition. A PRV recall never used the start index at all.

`scene-take-pgm-only.js` also loads list layers via `clipPath`, but `runSceneTakePgmOnly` has no
callers since WO-160b, so it was left alone.

## 2. What was done

- `src/engine/scene-take-playlist-start.js` (new): `resolvePlaylistStartIndex(self, sceneId,
  layer)` reads the channel-less `playlistStartIndices` key (WO-347), range-checked, default 0.
- `scene-take-lbg-jobs.js`: auto and manual lists load `playlist[startIdx]`. The per-item-loop
  LOOP check reads the start item, not `[0]`. This covers both PRV recall and PGM take.
- `scene-take-lbg-playlist.js` `setupLayerPlaylists`: the 400 ms hop is removed. The runtime index is
  parked on the start item for every mode (so manual Next goes to start+1), and the timer/preload
  chain arms from the start item (the video preloads start+1, honouring `playlistLoop`).
- `routes-playlist.js`: `handleStateGet` lists program channels first (live wins). A PRV-only
  recall lists `live:false` with a new `previewChannel`. So the panel's pick becomes `set_start`
  and ⏮/⏭ become `step_preview`, both existing paths. The PRV restage loop moves out of
  `step_preview` into `restagePreviewChannels()`, which `set_start` now calls too, so picking an
  item in the compact panel shows it on PRV straight away. It stays schedule-free and PRV-only.
- Panel label: PRV recalls read `· PRV chN` instead of `· not live`.
- `smoke-wo371-preview-playlist-step.test.js`: the source pin moves to the helper, with the same
  assertions (stagePlaylistItem, isPreviewCasparChannel, no triggerPlaylistAdvance) plus
  step_preview → restagePreviewChannels.

## 3. What was VERIFIED

- New `tools/smoke/smoke-wo581-playlist-take-starts-on-set-item.test.js` 4/4 (curated): PRV-only
  recall lists as not-live with previewChannel, set_start restages ch2 only with zero timers,
  PGM+PRV lists live on PGM, buildTakeJobs loads the start item (auto/manual/out-of-range → 0),
  and setupLayerPlaylists arms from the start item with exactly one AUTO preload and no hop.
- Playlist neighbour smokes (WO-224/211/251/371, item-loop): 25/25. Full offline suite
  2518 pass / 0 fail / 2 skip. File-line check clean. No new lint warnings.
- On the box: server restarted and client rebuilt with the kiosk reloaded. `/api/playlist/state`
  now reports "main lista" as `live:false previewChannel:2`. `set_start index:1` → OSC ch2 L11
  went `01Rajesh.PNG` → `02kpmg.PNG`, and PGM ch1 was untouched. Restored to index 0 afterwards.
- NOT probed live: the actual take to PGM (on-air). Owner QA.
