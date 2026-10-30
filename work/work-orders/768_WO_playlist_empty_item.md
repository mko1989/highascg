# WO-768 — Playlist: an empty item (transition the layer to nothing, then on to the next clip)

**Area:** engine
**Status: IN PROGRESS (25.10) — offline-verified (smoke 7/0, test:ci 3343/0, Godot 21760/0, client boot check); deployed, owner QA pending**

Owner 25.10:
> make a wo and add it into the app. ability to add an empty playlist item. so the operator can play a clip from the
> list, then manually transition to nothing on that layer then play next clip so on.

## Investigation

1. **No such item exists.** Items come only from a media drop (`playlist-edit.js:47 itemFromSource`, op `add`), and
   `isDroppableSource` (`:35`) refuses an empty value. There was nowhere to put "nothing" in a list.
2. **Caspar already has the primitive.** `LOADBG ch-l EMPTY MIX n` + `PLAY ch-l` transitions a layer to nothing
   (WO-766 probe: the layer then holds `color`). `resolveSceneClipForAmcp('EMPTY')` returns `EMPTY` unchanged. So
   `stagePlaylistItem` (`scene-take-lbg-playlist.js:356`), the path of Next / goto / PRV step, plays an item whose
   value is `EMPTY` with the playlist's own transition, with no engine change. The next Next then MIXes the next
   clip in from the empty layer.
3. **Timing.** `isTimelessPlaylistItem` (`:18`) counts `EMPTY` (no timed extension) as timeless:
   - Manual list: it holds until Next. That is the owner's flow.
   - Auto list: it holds for its duration, like a still, then moves on.
4. **OSC pitfall on auto lists.** After the swap to `color`, Caspar keeps the previous clip's file fields
   (`osc-state-layer.js` clears them only for the `empty` producer). `handlePlaylistOscUpdate` (`:121`) would then
   match the stale file back to the clip, "advance" to it and preload. While an empty item is current, the OSC pass
   must leave the layer to the empty item's timer.
   - A clip followed by an empty item on an auto list is preloaded `LOADBG EMPTY <transition> AUTO`. Its end has to
     be timed from OSC elapsed/duration, as WO-766's ↘ is (`scheduleFadeEndAdvance`), because OSC never shows it.
5. **Take starting on an empty item.** `buildTakeJobs` (`scene-take-lbg-jobs.js:91-137`) builds a full job from the
   start item's value, with audio filter / SEEK / IN / LENGTH. On `EMPTY` those mean nothing. The load must be a bare
   `EMPTY` with the transition.
6. **Consumers that would mistake `EMPTY` for a file:**
   - `media-exists.js:14` NON_MEDIA_RE: `clipMissing('EMPTY')` → true, so the row shows ⚠ and the look's
     missing-media audit (`:66`) lists it;
   - `project-media-root.js:213 normalizeSourceRef` would rewrite it to `<project>/EMPTY` under project-scoped media;
   - `replication/project-media-refs.js:21` would list it as a clip to replicate.
   - The planner's `sourceOf(list[0])` (`playlist-edit.js:56`) makes `layer.source` the first item, so an empty
     first item would make the layer's source `EMPTY`.

## What was done

- `src/engine/playlist-empty.js` (new) defines the item `{type:'empty', value:'EMPTY', label:'— empty —', duration}`,
  plus `isEmptyPlaylistItem` and `firstRealItem`.
- **Planner** (`playlist-edit.js`):
  - New op `add_empty {at?}` inserts at a row (default: the end). Its duration is the list's timeless length.
  - The layer `source` is now the first *real* item in mode / add / move / remove, so an empty first row never
    becomes the source.
  - ↘ is refused, as on any timeless item. Loop is allowed: on an auto list it holds the layer empty until Next.
- **Engine** (`scene-take-lbg-playlist.js`):
  - `stagePlaylistItem` and `queueNextPlaylistItem` load `EMPTY` for an empty item, with the playlist transition
    unchanged. So Next → the clip dissolves to nothing; Next → the next clip MIXes in.
  - The OSC pass skips a layer whose current item is empty (item 4).
  - The WO-766 end timer also arms for a clip whose next item is empty. At the clip's end the empty item takes over
    (its own timer), on top of the `EMPTY … AUTO` preload that already dissolved the clip.
- **Take** (`scene-take-lbg-jobs.js`): a start item that is empty loads bare `EMPTY` with the take's transition. It
  gets no template CG and no AF / SEEK / IN / LENGTH, and LOOP is off.
- **Not a file:**
  - `media-exists.js` NON_MEDIA_RE gains `^empty$`, so there is no ⚠ and no missing-media audit entry;
  - `project-media-root.js normalizeSourceRef` and `replication/project-media-refs.js` skip type `empty`.
- **API:** `describeRows` adds `empty`, names the row "— empty —" and never marks it missing.
- **Inspector** (`playlist_section.gd`): a **+ Empty** button under the item list adds one after the selected row (else
  at the end). The row is muted, its seconds field works for auto lists, Loop applies, and there is no ↘. A drag
  reorders it like any row.
- Web client not touched: the Godot client is the operator UI. The web inspector would show the row as a plain item
  named "— empty —".

## What was VERIFIED

- `tools/smoke/smoke-wo768-playlist-empty-item.test.js` 7/7 (added to the curated list). It covers:
  - planner insert / range / source rules;
  - manual Next onto empty → exactly `LOADBG 1-11 EMPTY {loop:false, MIX 12}` + `PLAY`, nothing armed, then Next
    plays the next clip;
  - auto: the empty item's timer, and a clip before it preloading `EMPTY {auto, MIX 12}`;
  - OSC: the clip's end hands over to the empty item, and stale file fields afterwards change nothing;
  - a take onto an empty start item → bare EMPTY;
  - non-file consumers, describe rows and the inspector button.
- `npm run test:ci` 3343 pass / 0 fail, Godot 21760/0, `run-client.sh --check` boot OK, 500-line check 0 over,
  eslint 0 errors.
- Live Caspar: `LOADBG … EMPTY MIX n` + `PLAY` takes a layer to nothing (WO-766 probe on 3-950).
- **Owner QA:** in a playlist look, add **+ Empty** between two clips. With Manual Next: Next plays clip 1, Next
  dissolves it to nothing, Next brings clip 2 in.
