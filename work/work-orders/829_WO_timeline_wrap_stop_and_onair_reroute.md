# WO-829 — Timeline-in-look follow-up: loop wrap leaves an ended clip on air; on-air reroute never STOPs program

**Status: DONE (30.10, smoke 4/4 + offline suite 3670/0 fail + live AMCP wire on PGM ch1) — 3a wrap STOP, 3b on-air
reroute, 3c mid-clip opacity, 3d channel-frame tweens, 3j deleted-layer STOP. Left as is (§4): ROTATION/ANCHOR/GRID/KEYER
missing from the neutral reset; a shifted layer re-enters at its In point (`startBehaviour`).**
**Source:** the 29.10 code sweep (`work/sweep-29.10.2026/REPORT.md` §3, batch 081 `src-engine--part3.md`), run in the
same owner request as WO-828: "run full tests to see if it's transitioning and playing exactly as explained".
**Related:** WO-828 (the spec and the seamless wrap D2/D3), WO-555 (setSendTo stops only removed channels), WO-558.

---

## 1. Investigation

### 3a — a loop wrap leaves a clip that ended at the timeline end on air

`_tick` wraps a looping timeline with `play(id, 0, { seamless: true })` (timeline-playback-runtime.js, WO-828 D2).
For a restart of the SAME timeline, `play()` replaced `_prevKey` with an empty `Map` before `_applyAt`.

`_syncAmcpLayers` sends a layer's exit `STOP` only from the branch `else if (prev?.clipId)`, which needs a cache
entry. So a layer that had a clip running at the end of the pass, and has no clip at the new position, was never
stopped.

Mock reproduction (scratch `t2.js`, recording AMCP): a 30 s timeline has layer a with a clip at 0–10 s, layer b at
20–30 s and layer c at 0–30 s. Play at 25 s, then wrap:

- the wire carried `STOP/PLAY 1-210` and `PLAY 1-212`, but **no `STOP 1-211`**;
- clip B (on its last frame) stayed on PGM through the next 20 s of the pass.

This predates WO-828: the non-seamless wrap reset `_prevKey` the same way. It is a deviation from the WO-828 spec,
where a layer shows only while its clip is under the playhead.

### 3b — moving an on-air timeline off program never STOPs program

`TimelineEngine.update()` (timeline-engine.js) stored the PUT body, including its new `sendTo`, and only then
called `setSendTo(updated.sendTo, id)`. `setSendTo` reads the "old" routing from the stored timeline, which is
already the new routing, so `routingChanged` was always false:

- no `STOP` went to the removed channel (the WO-555 logic never ran);
- the cache entries of the removed channel were never dropped;
- the next tick played only the new channels, so the old program layers stayed on PGM, frozen on their last frame.

Godot's Destination picker (`timeline_dest.gd:94-109`) and the web editor change `sendTo` by PUTting the whole
timeline, so this is a normal operator path.

## 2. What was done

- **`src/engine/timeline-playback-runtime.js` `play()`:** on a restart of the same timeline, the cache keeps its
  entries for layers that have NO clip at the new position, and drops the rest as before. `_syncAmcpLayers` then
  sends those layers the normal exit `STOP` in the same batch and COMMIT. Layers with a clip at the new position
  still restart from an empty entry, and the WO-828 seamless re-PLAY (no STOP) of a continuing clip is unchanged.
  - I chose this over an explicit STOP loop in `play()` because it reuses the one exit path, which also clears the
    keyframe caches and pending scrub seeks for the layer.
- **`src/engine/timeline-engine.js` `update()`:** when the timeline is on air and the PUT carries `sendTo`, the
  stored routing is kept until `setSendTo(newSendTo)` has diffed against it. A same-routing PUT (every clip edit)
  stays a no-op on the wire.
- **`tools/smoke/smoke-wo829-timeline-wrap-and-reroute.test.js`** (curated in `tools/ci/offline-test-files-2.js`):
  - the wrap test: STOP of the ended layer, the continuing clip re-PLAYed with no STOP;
  - the reroute test: a same-routing PUT sends nothing; PGM→PRV STOPs 1-210 and PLAYs 2-210.
  - Both fail on the old code (checked by swapping the HEAD copies back in: 0/2) and pass on the new code (2/2).

## 1b. Investigation, second pass (3c, 3d, 3j)

### 3c — a mid-clip start faded the clip-local-0 opacity segment in

`_sendClipTransport` always computed the lead tween with `opacitySegmentAtLocalMs(clip, 0, …)`. Mock: a clip with
opacity keyframes 0→1 (0–1 s), then 1→0 (5–6 s), played from 25 s, got `OPACITY 0 0` followed by `OPACITY 1 25 DEFER`,
so it faded to full when it should have stayed at 0. Nothing corrected it, because the tick saw the cached start value.

### 3d — keyframe tweens counted timeline frames

`_applyClipMixer` got `fps: tl.fps` (25), and `_sendClipTransport` hard-coded 25. Caspar counts MIXER tween
durations in CHANNEL frames, the same as SEEK (WO-787), so on the 50p channels every keyframed fade ran at half
length: a 1 s fade was sent as 25 frames, which is 0.5 s.

### 3j — a layer deleted from an on-air timeline kept playing

`_syncAmcpLayers` walks only `tl.layers`. After a delete the remaining layers shift down one physical layer, and
the top one, which no longer exists, never gets a STOP.

## 2b. What was done (second commit)

- **`timeline-playback-amcp-send.js`:**
  - Both `_sendClipTransport` call sites pass `localMs`.
  - A clip whose transport starts more than 2 ticks (80 ms) past its start gets no lead tween. Its transport batch
    inits the opacity interpolated at the real position. Entry at the clip start (a tick lands up to ~2 ticks late)
    keeps the WO-139/528 lead tween unchanged.
  - Tween durations use `resolveChannelFramerateForMixerTween(self, ch, tl.fps)`, the WO-787 helper.
- **`timeline-engine.js` `update()`:** when on air, the physical layers above the new layer count that still have a
  cache entry are STOPped and their entries dropped. A shifted layer whose clip changed is restarted by the existing
  clip-id staleness check.
- The smoke gained 3c/3d and 3j cases. The 3j case fails on the previous commit (3 pass / 1 fail) and passes on the
  new code.

## 3. Verified

- **Offline:**
  - `smoke-wo829-timeline-wrap-and-reroute` passes 4/4. Its 3a and 3b cases fail on the pre-WO code (0/2).
  - Full offline suite: 3670 tests, 3668 pass, 0 fail, 2 skipped. No file is over 500 lines, and eslint is clean
    on the changed files.
- **Live, PGM ch1:** node was restarted on the new code (PID 2783932 for 3a/3b; restarted again for 3j). The test
  timeline `wo829tl` was 12 s and looping:
  - layer A: `KV LOOP 2.mov`, 0–12 s;
  - layer B: `KV LOOP.mov`, 8–12 s, ending at the timeline end.
- The timeline was played from 6 s with sendTo program. Caspar log, "Received message":
  ```
  07:18:18.352 STOP 1-210 / PLAY 1-210 "…KV LOOP 2" SEEK 300      (6 s × 50p channel frames)
  07:18:20.354 STOP 1-211 / PLAY 1-211 "…KV LOOP" SEEK 0          (B enters at 8 s)
  07:18:24.357 PLAY 1-210 "…KV LOOP 2" SEEK 0                     (wrap: seamless, no STOP — WO-828 D2)
  07:18:24.359 STOP 1-211                                         (wrap: B stopped — 3a)
  07:18:32.395 STOP 1-211 / PLAY 1-211 "…KV LOOP" SEEK 0          (B enters again)
  07:18:36.395 PLAY 1-210 … SEEK 0 / 07:18:36.397 STOP 1-211      (second wrap, same)
  ```
- **3b:** a PUT of the same timeline with sendTo `{preview:true, program:false}` while it played:
  - wire: `07:19:01.157 STOP 1-210`, `.160 STOP 1-211`, then `STOP 2-210` and `PLAY 2-210 "…KV LOOP 2" SEEK 36`;
    preview joined at the current position;
  - `GET /api/state`: playback still playing, `sendTo` preview-only.
- **3j:** a 2-layer timeline (both 0–12 s) played on PGM from 1 s, then a PUT without layer A:
  - wire: `07:21:12.271 STOP 1-211`, then `STOP 1-210` and `PLAY 1-210 "…KV LOOP"`. B moved down to 1-210 and the
    old top layer was stopped.
  - B re-entered at `SEEK 0`. That is the clip's `startBehaviour: 'beginning'` rule (scene-play-seek.js:307), which
    applies to any clip whose transport restarts mid-air. It is existing behaviour, left as is.
- **Cleanup:** the test timeline was stopped and DELETEd after each run; `grep wo829 projects/*.json` finds nothing.
- **Not probed:** a picture or luma probe of PGM. The evidence is the wire, because each fault was a missing or
  extra AMCP command.

## 4. Left as is (owner call if wanted)

- `timeline-playback-helpers.js:14-27`: the neutral mixer reset omits ROTATION, ANCHOR, GRID and KEYER, so a
  rotation effect removed from a clip leaves the layer rotated until the next look take. Not on any WO-828 path.
- A clip that restarts mid-air because of an edit re-enters at its In point (`startBehaviour: 'beginning'`). This
  is per-clip and existing behaviour, and `relativeToPrevious` is available.
