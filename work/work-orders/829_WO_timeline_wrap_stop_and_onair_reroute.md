# WO-829 — Timeline-in-look follow-up: loop wrap leaves an ended clip on air; on-air reroute never STOPs program

**Status: IN PROGRESS (30.10) — 3a and 3b fixed and verified by mock and live wire; 3c, 3d and 3j are open (see §4)**
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

## 3. Verified

<!-- filled after the live run -->

## 4. Still open (from the sweep, same area, not fixed here)

- **3c** `timeline-playback-amcp-send.js:354-404`: the opacity lead tween is computed for clip-local 0 even when the
  transport starts mid-clip, so a mid-clip start shows OPACITY 1 instead of the keyframed value.
- **3d** `timeline-playback-amcp-schedule.js:127,252,297` and `amcp-send.js:356`: tween frame counts use the
  timeline fps (25), but Caspar counts channel frames (50p), so keyframed fades run at half length. The wrap
  capture above shows it as well: `OPACITY 1 25 linear` for a 1 s fade on a 50p channel.
- **3j** `timeline-engine.js:78-81`: a layer deleted from an on-air timeline keeps playing.
  `timeline-playback-helpers.js:14-27`: the neutral reset omits ROTATION, ANCHOR, GRID and KEYER.
