# WO-968 — A playlist look on PRV plays its items (option B), not just the first

**Area:** engine, godot-client
**Status: DONE (2026-11-05 — PRV runs its own channel-scoped chain; test:ci 5345/0 fail; live PRV ch3 looped clips + still, stepped and edited, PGM ch2 got no AMCP; simultaneous PGM+PRV proven offline)**

> Owner, 05.11.26: *"when playlist is being edited on prv it should play the playlist items, not just the first."*

This reverses the 29.07 decision recorded in [WO-371](371_WO_prv_playlist_preview_playback.md) (option C: PRV
frozen, ⏮/⏭ step; "do NOT rebuild the second PRV timer"). The owner now wants **option B**, which is what they
first answered on 28.07 ("it should continue playing as expected so each item and looping"). WO-371 §4 "If B"
is the acceptance list:

- recalling a look to preview plays the list end to end, honouring `playlistLoop` / per-item loop / timeless
  durations / manual advance exactly as PGM does;
- taking a look to PGM still works as before (WO-355: a channel take wipes that channel's playlist state);
- no timer is shared between channels — different progress on PGM and PRV at the same time.

## 1. Investigation

### 1.1 Why PRV sits on the first item

PRV is gated out of the playlist engine in two places, both through one predicate:

- `src/engine/scene-take-lbg-playlist.js:47` `isPlaylistChannelEligible()` returns false for every preview
  channel (`isPreviewCasparChannel`) — the WO-355 "playlists RUN on program only" rule (todos27.07.26).
- `:74` / `:95` — `setupLayerPlaylists()` computes `runs` from it and, for a PRV take, `continue`s before it
  records the active index or arms anything (no image timer, no LOADBG AUTO preload of the next clip). Only the
  WO-766 ↘ fade of the start item is queued (`:93`, deliberately — "a fade is not an advance").
- `:133` — `handlePlaylistOscUpdate()` skips the PRV channel on every OSC tick, so the advance detection, the
  "timeless item on air with no timer armed" re-arm, the WO-766/768 fade-end advance and the T211.5 stall
  watchdog never run there.

So a PRV recall loads the start item (WO-581 `buildTakeJobs`, `scene-take-lbg-jobs.js:117-129`) and nothing
ever follows it. Box evidence (05.11, before the change): the look `firebelly-torches-dv` (two .mov items, auto,
loop) was recalled to PRV ch3 eight times between 19:33 and 19:49 (`[scene-take] preview-only path prv=3`), and
the journal has not one `[Playlist]` line; `INFO 3` shows layer 10 holding `TESTOWE/FIREBELLY-TORCHES-DV`
(3.4 s) with `<background><producer>empty</producer>` — no AUTO preload queued behind it.

### 1.2 What is already in place (WO-354 foundation)

- PRV recalls ARE registered in `src/state/live-scene-state.js`: the preview-only take path awaits
  `liveSceneState.setChannel(bus1, …)` (`src/api/routes-scene-take.js:219`), the pgm→prv exchange too (`:379`),
  and the preview-push nudge path re-registers the edited look (`routes-scene-preview-push.js:177`). The OSC
  pass iterates `liveSceneState.getAll()`, so it will see the PRV entry once the gate is gone.
- Every piece of runtime state is channel-scoped: `playlistRuntimeKey(channel, sceneId, layer)` keys
  `playlistActiveIndices`, `playlistImageTimers`, `playlistOscPrevPlayingPath`, `playlistFadeEndArmed` and the
  watchdog bags. PGM and PRV of the same look already get two independent chains; nothing needs re-keying.
- PRV is bank-less: every PRV take forces `programLayerBankByChannel[prv] = 'a'`, so the OSC pass's
  `physicalProgramLayer(n, bank)` resolves the PRV layer correctly.
- The sticky start item `playlistStartIndices[`${sceneId}-${layer}`]` (WO-347 / WO-581) is channel-less and is
  read only by a take (`resolvePlaylistStartIndex`). The PRV chain writes only its own channel-scoped active
  index, so PRV's automatic advance can never move the item a PGM take starts on.

### 1.3 Other PRV-frozen assumptions found

- `src/api/routes-playlist.js:85-103` `restagePreviewChannels()` (set_start / step_preview → PRV) stages through
  the schedule-free `stagePlaylistItem` — with B the PRV list must run on from the picked item.
- `src/api/routes-playlist-edit.js:129` `currentIndex()` — the inspector's ▸ marker is "playing on program, else
  the start item"; a look only on PRV should mark the item PRV is playing.
- `src/shaderfx/shader-live-instances.js:30` `playlistNowValue()` returns null for PRV ("looks recalled on
  preview do not run playlists") — Shader Live would target the authored value, not the shader item PRV plays.
- `src/api/routes-scene-preview.js` `handlePreviewLiveClear()` drops the PRV live entry but leaves that
  channel's playlist runtime state. Harmless while PRV never armed anything; with B a ↘ fade-end timer
  (`playlist-fade-out.js:57`, no liveness check) could still fire after the clear and re-stage onto PRV.
- `triggerPlaylistAdvance()` (`scene-take-lbg-playlist.js:413`) arms the chain for the new item but never
  clears a timer still armed for the item being left. A jump from a still (timer armed) onto a clip left the
  still's timer running, which later hopped the list again — a latent PGM `goto` bug that a PRV pick / step
  would now hit on every use.
- The image timer fires with the `layer` captured when it was armed (`:345`). An edit patched into the live
  scene (`patchLivePlaylist`) is read by the OSC pass, but a still's timer still advanced through the
  pre-edit list.

### 1.4 Pinned behaviour that the decision changes

- `tools/smoke/smoke-wo371-preview-playlist-step.test.js` — source pins "step_preview / PRV restage must never
  arm the advance chain" and "restage via the schedule-free helper".
- `tools/smoke/smoke-wo581-playlist-take-starts-on-set-item.test.js` — "no timers on PRV" after set_start, and
  the message "playlists run on PGM only" for the not-live listing.
- `tools/smoke/smoke-wo766-playlist-fade-preview.test.js` — "a ↘ start item queues its fade on program and on a
  PRV recall" stays true as written (a ↘ start item arms nothing else on either channel).

### 1.5 Found on the box while verifying (05.11)

- **Stale OSC on a bank-less layer.** Every PRV recall / pick / step re-stages the SAME physical layer (PGM takes
  flip banks, so the incoming layer's OSC starts empty). For a few frames OSC still names the clip that was there:
  the first recall after enabling PRV logged `advanced to item 1` → `advanced to item 0` within 150 ms and sent
  three `LOADBG 3-10 … AUTO` (19:06:15.850 / .874 / .923, AMCP ring); the last one corrected it. A PGM `goto`
  reuses its layer too, so it has the same transient.
- **Clip → still never advanced (PGM too).** After `forest_jester-dv.mov` AUTO-promoted to
  `t9_pedestrians.png`, `/api/osc/state` for 3-10 held `file.name: "TESTOWE/FOREST_JESTER-DV"` next to
  `file.path: ".../t9_pedestrians.png"`. Caspar's image producer sends only `foreground/file/path` (UDP :6250
  sniff), so `osc-state-layer.js:200-207` keeps the clip's name, and the playlist OSC pass (`file.name ||
  file.path`) read the still as the clip: no advance, no duration timer, and the list sat on the still forever.
- Not part of this WO: the look layer carries `trimOutMs: 3403`, which the take applies to the playlist's
  start item (`LENGTH`), so on every recall item 0 plays 3.4 s, not 33.4 s. Items the chain loads later play
  in full. This is the same on PGM. It is left as a question for the trim work (WO-955/962/966): does a
  layer trim belong on a list layer at all?

## 2. What was done

Choice: the sticky start item (`playlistStartIndices`, channel-less) stays separate from PRV's channel-scoped
active index. A PGM take still reads only the start item (WO-581), and PRV's own advance writes only
`playlistActiveIndices["<prv>:<look>-<layer>"]`, so it can never move where the take starts. A pick / Next / ⏮⏭
on PRV moves the start item (unchanged) and PRV then runs on from it.

- `src/engine/scene-take-lbg-playlist.js`
  - `isPlaylistChannelEligible` removed. `setupLayerPlaylists` arms the chain on every channel (index,
    still timer, LOADBG AUTO preload, OSC binding), and `handlePlaylistOscUpdate` no longer skips PRV. All AMCP
    goes to the `channel` the chain was armed on; no code path switches channel.
  - `isSceneStillLive()` (`:64`) is shared by the still timer and, new, the WO-766/768 fade-end advance, which had
    no liveness check. A ↘ fade running when PRV is cleared or retaken no longer stages onto the cleared channel.
  - The still timer hops through the list as it is NOW (`:360`): the live scene's layer, as patched by
    `patchLivePlaylist`, instead of the list captured when the timer armed.
  - `triggerPlaylistAdvance` (`:442`) now returns its promise (true/false), so the PRV restage can await it. After
    staging it clears a still timer left on the key (`:446`), which fixes the latent goto-off-a-still double hop.
  - Stale-OSC guard (`:56-62`, `:187`): an OSC mismatch with the item just staged is ignored for 400 ms
    (`playlistStagedAt`, wiped with the channel's state).
  - `oscForegroundFile()` (`:143`): when `file.path` names a different file than `file.name`, the path wins.
- `src/api/routes-playlist.js:103` — `restagePreviewChannels` (set_start / step_preview → PRV) uses
  `triggerPlaylistAdvance` instead of the schedule-free `stagePlaylistItem`. It still touches only
  `isPreviewCasparChannel` channels. The state listing (`:44`) adds `previewActiveIndex` (the item PRV is
  playing). `live:false` + `previewChannel` stay, so a panel pick on a PRV recall is still a set_start (WO-581).
- `src/api/routes-playlist-edit.js:129` — the inspector's ▸ marker (`currentIndex`) shows the program item,
  else **the item PRV is playing**, else the start item. This is server-only; the Godot client already renders
  `currentIndex`, so no godot/client file changed. The marker is a snapshot taken at each describe / edit /
  transport response; the inspector does not poll it (follow-up only if the owner wants it live).
- `src/api/routes-scene-preview.js:117` — `/api/scene/live/preview/clear` wipes the PRV channel's playlist
  runtime state.
- `src/shaderfx/shader-live-instances.js:30` — Shader Live resolves a PRV playlist layer through PRV's own
  runtime index, like program; with no index it uses the start item.
- Not changed: a clip's LOADBG AUTO preload that was queued before an edit still plays the pre-edit next item
  once. After that the chain follows the edited list. PGM behaves the same (note for later; no WO).
- `work/work-orders/371_WO_prv_playlist_preview_playback.md` — note at the top that option C's "sits still"
  part is superseded by this WO. The ⏮/⏭ step and pick stay.

### Pinned smokes repointed (owner decision changes the contract)

- `smoke-wo371-preview-playlist-step.test.js`: the pin "PRV restage must never arm the advance chain" became
  "PRV restage stages AND runs on (triggerPlaylistAdvance)", still preview-channels-only. "step_preview
  reaches a channel only through the PRV-only helper" is kept, and so is "stagePlaylistItem schedules nothing".
  The manual-list case still asserts no timer (manual advance honoured) and adds an every-AMCP-to-ch7 check. New
  case: stepping an AUTO list arms the still's timer under the PRV key only.
- `smoke-wo581-playlist-take-starts-on-set-item.test.js`: "no timers on PRV" became "item 2 preloaded AUTO
  on PRV ch2, PRV index on the pick, a clip arms no timer", plus `previewActiveIndex`. The not-live listing
  assertion stays, with a reworded message.
- `smoke-wo766-playlist-fade-preview.test.js`: unchanged and passing (a ↘ start item arms only its fade on both
  channels).
- New `tools/smoke/smoke-wo968-prv-playlist-runs.test.js` (curated, `tools/ci/offline-test-files-3.js`), 10 cases:
  a PRV recall plays every item and wraps (PRV-only AMCP); loop off stops on the last item; a manual list arms
  nothing; PGM + PRV of one look run independent timers with different indices at the same time, PRV's
  advance sends nothing to PGM and leaves the start item alone, and a PGM-channel wipe keeps PRV running; the
  OSC pass advances a PRV clip list; a stale frame is not an advance; clip → still reads the path and arms the
  timer; a still's timer plays the edited list; a jump off a still clears its timer; the inspector marker and
  Shader Live follow PRV; source pins for the PRV clear and the removed gate.

## 3. What was VERIFIED

**Offline:** `npm run -s test:ci` 5345 tests / 5340 pass / **0 fail** / 5 skipped. The playlist neighbours
(WO-211/224/251/371/581/766/768, item-loop, osc-index-match) and the WO-968 smoke ran 53/0 on their own.
`npx eslint` on the changed files gave 0 errors (one existing warning, `lastElapsed` in `shouldForceAdvance`).
`format:check` is clean, and no file is over 500 lines (the engine file is now 487).

**Live box, 05.11 (node restarted three times with the change; channel map from `/api/settings`: PGM 2, PRV 3;
look `firebelly-torches-dv`, 2 clips, auto, loop):**

- **PRV advances by itself, loop included** (journal + AMCP ring, `3-10`):
  `20:06:15.848 Preloading next item 1 (forest_jester)` → `20:06:48.783 advanced to item 1` → `20:06:58.110
  advanced to item 0` → `20:07:31.029 advanced to item 1` → `20:07:40.319 advanced to item 0`. That is clip
  lengths 33.4 s / 9.3 s, back to back, and it loops. Ring: `LOADBG 3-10 TESTOWE/FOREST_JESTER-DV MIX 25
  linear AUTO` (19:06:58Z, 19:07:40Z, 19:08:22Z UTC) alternating with `… FIREBELLY-TORCHES-DV … AUTO`. Before
  the change: eight PRV recalls (19:33–19:49 local), not one `[Playlist]` line, and `INFO 3` showed
  `<background><producer>empty</producer>`.
- **Step on PRV runs on** (`/api/playlist/edit/next`, look only on PRV → step_preview): response
  `startIndex 1, previewChannels [3]`. Ring `19:11:57.756Z LOADBG 3-10 FOREST_JESTER-DV MIX 25 linear`,
  `PLAY 3-10`, `LOADBG 3-10 FIREBELLY-TORCHES-DV … AUTO`, then `19:12:07.154Z LOADBG 3-10 FOREST… AUTO` (the
  next hop on its own). The OSC sniff kept naming FIREBELLY until 20:11:57.792 (after the stage), and the
  guard kept it out: no stray advance line. `/api/playlist/state`: `live false, previewChannel 3, startIndex 1,
  previewActiveIndex 1`.
- **Edit while on PRV plays the edited list, incl. a timeless still**: `POST /api/playlist/edit op:add
  t9_pedestrians.png` → `patched 1` (only PRV held the look), `currentIndex 0` = the item PRV was playing.
  Then `20:16:11.596 advanced to item 1 (forest) / Preloading next item 2 (t9_pedestrians.png)` →
  `20:16:21.172 advanced to item 2: …/t9_pedestrians.png / Scheduling image timer … 20000ms` →
  `20:16:41.173 Advancing from image to item 0 (firebelly)`. A full cycle clip → clip → still (20 s) → wrap.
  The first attempt, before the `oscForegroundFile` fix, sat on the still for more than 60 s (§1.5).
- **PGM untouched:** over the whole session, no `LOADBG|PLAY|LOAD|CG|MIXER|STOP|CLEAR 2…` in the AMCP ring,
  0 `AMCP → … 2-` journal lines, 0 `[Playlist] … on 2-` lines, and `INFO 2` had 0 layers before and after.
- **Not driven live:** PGM and PRV playing at the same time with different progress. That needs a take to PGM,
  and this API has no clean way to put PGM back to empty afterwards. It is proven offline instead (WO-968
  smoke, "PGM and PRV of one look"): two timer handles, PRV index 2 while PGM stays on 0, PRV's step sends
  nothing to PGM, and a PGM-channel wipe keeps PRV's timer. A PGM take of the look is still the existing
  WO-355/581 path, unchanged by this WO.
- **Restored:** set_start 0 plus a PRV recall of the stored look (2 items, start 0). The project was never
  written (`GET /api/project` rev 133 before and after, scenes identical), so no autosave restore was needed.

**Owner check (one line):** recall a playlist look to PRV and watch it play every item and loop. Take it to
PGM: it starts on the ▸ start item.
