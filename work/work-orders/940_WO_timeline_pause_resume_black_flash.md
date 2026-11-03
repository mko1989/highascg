# WO-940 — Spacebar pause → play sometimes flashes black: resume restarted the producer instead of RESUME

**Area:** engine, amcp
**Status: DONE (03.11.26 — live A/B on ch3 with INTRO.mov (NotchLC 3840×1792), 25 spacebar-shaped cycles each: old code 12 restarts → 12 black flashes of 2–3 frames in the channel recording; fixed code 25 RESUME, 0 restarts, 0 black frames. New smoke fails 3/5 without the fix; offline curated suite 5290/0/5)**

Owner, 03.11.26: "when i play and pause timeline with spacebar, sometimes when it resumes play there is a brief flash
of black on the screen. should never happen."

## Investigation

Spacebar → `timeline_keys.gd:48` → `timeline_transport.gd:214 toggle_play()`. Pause = `POST …/pause`. Play =
`PUT` timeline, `POST …/seek {ms: round(playhead)}`, `POST …/sendto`, `POST …/play {from, sendTo}`.

`play()` (`src/engine/timeline-playback-runtime.js`) only sends `RESUME` when `_canResumePlayback(id)` is true. That
check (`timeline-playback-amcp-send.js:34`) requires each layer's cached `_prevKey.frame` to equal the frame at the
paused position (`_validateClipStateForResume`). Otherwise `play()` takes the full transport: `STOP` +
`PLAY … SEEK n`. `STOP` empties the layer (`layer.cpp:100`, `foreground_ = frame_producer::empty()`), so the
channel shows black until the new producer delivers its first frame.

`_prevKey.frame` only advances on the 40 ms tick (`_syncAmcpLayers`, the `playing && !force` branch).
`pause()` stores the exact `cellNowMs` position but never refreshes the cache. A pause that falls in a later
timeline frame than the last tick leaves the cache one frame behind. The client then seeks to the position the
pause broadcast just gave it. That seek is a no-op (`samePausedPos`, < 1 ms), so nothing fixes the cache, and
resume restarts the producer. This happens on roughly half of all pauses, which is the owner's "sometimes".

Offline repro (fake AMCP, mocked clock, `play(4025)`, 5 ticks, pause 0/10/20/30/39 ms after the last tick, then the
client sequence): 0 and 10 ms → `RESUME 2-210`; 20, 30 and 39 ms → `STOP 2-210` + `PLAY 2-210 "TEST" SEEK 106`.

Live on the box (old code, the client's exact HTTP sequence, ch3 = preview):
- TALK2.mp4 (light H.264), 25 cycles: 11 restarts.
- INTRO.mov (NotchLC 4K), 25 cycles: 12 restarts.
- The first 4K recording showed no black because the look on 3-10 is INTRO_HAP, the same picture, under 3-210,
  so a STOP revealed it. The real-show symptom depends on what sits under the timeline's layers. With 3-10..12
  cleared, the channel recording (`ADD 3 FILE … -an`, 50 fps) had 12 black runs of 2–3 frames, one per restart.

## What was done

`src/engine/timeline-playback-runtime.js` `pause()`: one `_syncAmcpOnTimelineTick(id, now)` at the pause instant,
before `cell.playing = false`. This is the same sync the ticker runs, so it also handles a clip that entered or
exited in the ≤ 40 ms since the last tick. `_prevKey.frame` now describes the paused position, `_canResumePlayback`
passes, and resume sends `RESUME` only.

Why not relax `_validateClipStateForResume` (for example ±1 frame): that would hide real staleness, such as a scrub
that did not land (WO-536). The cache was wrong, so the fix is to make it right at pause.

`tools/smoke/smoke-wo940-pause-resume-no-restart.test.js` (curated): the client sequence after a pause 0–39 ms past
the last tick must put exactly `RESUME 2-210` on the wire.

## What was VERIFIED

- Smoke: 5/5 with the fix, 3/5 fail without it (the 20/30/39 ms cases).
- Offline curated suite: 5290 pass / 0 fail / 5 skip.
- Live, fixed code, 25 cycles each: TALK2 → 25 PAUSE / 25 RESUME, no restart. INTRO.mov → same, and 0 black frames
  in the ch3 recording (3-10..12 cleared, same setup as the failing run). Node restarted on the fixed code;
  the ch3 look came back on restart.
- Not covered: route:// clips. They keep their own re-PLAY on force seek, and pause/resume on a route has no
  position to drift.
