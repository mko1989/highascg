# WO-449 — Clip-edge extension mid-play re-sends PLAY … LOOP (blank at file end)

**Status: DONE (06.08.26 — engine fix + smoke; service restart in the day's batch tail)**

Owner (todos06.08 line 13): *"grabbing a clips edge in timeline and extending it does not
have an effect on the actual playout, it only plays the first segment and then blanks."*

## 1. Investigation

- The clip started within its media length, so `_sendClipTransport` issued `PLAY … SEEK n`
  **without** `LOOP` (`timeline-playback-amcp-send.js:324` — loop only when `meta.loopClip
  || meta.implicitLoop`).
- The edge-drag DOES reach the server (canvas mouseup → `onClipDragEnd` → PUT →
  `eng.update()` → `_syncAmcpLayers`), and `clipTransportMeta` recomputes
  `implicitLoop=true` (clip.duration now exceeds the media span,
  `scene-play-seek.js:296`).
- But `timelineClipTransportStale()` compares only clipId/src/audioRoute/loopAlways/isRoute
  (`timeline-playback-helpers.js`) — the loop-requirement flip never re-triggered the
  transport. Caspar ran the file to its end and blanked, while the engine still considered
  the clip active until the new (extended) end. Same hole for a `clip.loop` toggle
  (`meta.loopClip` includes `clip.loop`, which is also absent from the staleness fields).

## 2. What was done

`_syncAmcpLayers` now computes `loopStale`: on a PLAYING timeline, same clip, transport not
otherwise stale, but `prev.implicitLoop !== meta.implicitLoop` or `prev.loopClip !==
meta.loopClip` → full transport re-send (`PLAY … LOOP SEEK <current frame>` — frame math
already wraps modulo the media span). `_prevKey` entries now store both flags. Paused
timelines are unaffected (resume already forces a full transport).

## 3. What was VERIFIED

- New `tools/smoke/smoke-wo449-clip-extend-loop.test.js` (registered in FILES): play a 8s
  clip of 10s media → PLAY without LOOP; extend to 30s mid-play via `eng.update()` → a
  re-sent `PLAY … LOOP`; identical second update → no transport churn. 1/1 green.
- Full suite in the batch tail. Owner QA: extend a playing clip past its source length —
  playout must keep looping to the new edge instead of blanking.
