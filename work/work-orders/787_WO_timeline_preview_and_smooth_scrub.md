# WO-787 — Timeline: nothing on preview, and scrubbing jumps

**Status: DONE (26.10 — smokes + offline suite + Godot tests; live on the box against the owner's timeline on PRV; owner QA = scrub in the Godot timeline tab)**

Owner, 26.10:
> timeline workflow is lacking. first it does not show on preview. the seek isnt smooth on the screen, it makes bigger
> jumps.

Parents:
- [WO-602](./602_WO_godot_port_timeline.md) (Godot timeline tab);
- [WO-62](./62_WO_PROJECT_SCOPED_MEDIA_ROOT.md) (project-scoped media);
- [WO-536](./536_WO_LOOPED_CLIP_RESTARTS_INSTEAD_OF_RESUMING.md) (looping-clip seeks);
- [WO-592](./592_WO_media_library_links_versions_inspector.md) (SEEK counts channel frames).

## Investigation

The owner's timeline has one clip: `INTRO.mov` from project `mhp_harder`, NotchLC 3840×1792, 25 fps, 5 GB. It plays on
PRV channel 2, which runs at 50p.

1. **"Does not show on preview": Caspar never found the file.**
   - At 20:59 the clip was still stored as `projects/mhp_harder/INTRO.mov`. Later the project normaliser
     (`normalizeProjectMediaRefs`, `src/engine/project-scenes.js:240`) rewrote it, like every look's source, to the
     project-relative `INTRO.mov`.
   - Looks resolve that form to the project CLS id (`resolveSceneClipForAmcp` → `resolveClipForAmcpLoad`, WO-62). The
     timeline engine sent `clip.source.value` as stored (`timeline-playback-amcp-schedule.js` `clipTransportMeta`
     `srcQ`).
   - Reproduced after a server restart and a seek: `LOAD 2-210 "INTRO.mov" SEEK 250` → `File not found.` →
     `404 LOAD FAILED`.
2. **The picture sat at half the playhead.**
   - The engine computes frames at the timeline's fps (25). On this build, SEEK counts channel frames (WO-592, memory
     note).
   - Measured: `PLAY 2-210 … SEEK 250` played from 5.0 s, but the engine meant 10 s.
   - Paused seeks to 10 / 20 / 33 s landed at 5 / 10 / 16.5 s (INFO `<time>`).
3. **Scrubbing a playing timeline restarted the producer on every mouse move.**
   - Owner's drag, Caspar log 20:59:25: 20+ cycles of `STOP 2-210` + 13 neutral MIXER lines + `STOP` +
     `PLAY 2-210 "…INTRO.mov" SEEK n` within one second, each followed by `ffmpeg[…INTRO.mov] Destroyed`.
   - Cause: `_syncAmcpLayers` had `needsFullTransport = … || (force && playing)` (WO-93: "Playing scrub: STOP+PLAY
     once at the new frame — never CALL SEEK (decoder stutter)"). The "once" does not hold for a drag: the Godot ruler
     (`timeline_view.gd` `_seek_to`) posts a seek on every mouse move.
   - Effect: black between reopens, and a picture only where the drag paused, i.e. the "bigger jumps".
   - Measured on this file while playing, time from the command until INFO reports the target (5 targets each):
     - STOP + PLAY SEEK: 211–262 ms.
     - CALL SEEK: 206–418 ms.
     - The latency is the same. CALL SEEK keeps the last frame on screen meanwhile, and a later SEEK overrides a
       pending one. The "decoder stutter" claim was never measured.
4. **Client: up to 6 seek requests in flight.** `transport.seek` posted every drag step through the 6-slot API pool,
   so the requests could reach the server out of order. The engine could then end short of where the drag stopped.
5. **An empty channel had no framerate variable.** `query-cycle.js` writes `channel_N_framerate` only inside the
   per-layer loop. After a restart, PRV (empty) had none, so `resolveChannelFramerateForMixerTween` fell back to the
   hint.

## What was done

- **`src/engine/timeline-playback-amcp-schedule.js`** `clipTransportMeta`:
  - `srcQ` resolves through `resolveSceneClipForAmcp`, the looks' resolver. It is lazy, so the disk check runs only
    when a PLAY or LOAD is built, not on every tick. Routes pass through.
  - New `caspFrame` = frame × channel fps / timeline fps, for the target channel. `frame` stays in timeline frames,
    which `_prevKey` and the stale checks compare.
- **`src/engine/timeline-playback-amcp-send.js`**:
  - Every SEEK on the wire uses `caspFrame`: the PLAY / LOAD lines and the three CALL SEEKs.
  - A seek of the same clip seeks in place (`CALL … SEEK`), whether playing or paused. Full transport only runs when
    the transport is stale (new clip, source, AF route, loop mode), or for a route on a playing timeline (no position
    to seek).
  - The separate paused / playing scrub branches are merged.
- **`src/utils/query-cycle.js`**: a channel's framerate is recorded from its INFO even when it has no layers.
- **`godot/client/features/timeline/timeline_transport.gd`** `seek`:
  - One request in flight. The latest `{id, ms}` waits and is sent when the current request returns.
  - The playhead and clock still move on every step.
- **Smokes:**
  - New `smoke-wo787-timeline-preview-and-scrub.test.js` (4 tests):
    - a project-scoped clip → `LOAD 2-210 "PROJECTS/MHP/INTRO" SEEK 250` (temporary media dir, active slug);
    - 25 fps on 50p → SEEK 500, and paused CALL SEEK 1000;
    - a drag over a playing timeline sends only CALL SEEKs, ending at 1550;
    - source pins for query-cycle and the Godot coalescing.
  - Repointed:
    - `smoke-timeline-playing-seek` last block, from "playing scrub uses STOP+PLAY" to one CALL SEEK and no PLAY;
    - `smoke-wo536` expects `PLAY 2-210 "TEST" LOOP`, the CLS id looks send too;
    - `smoke-wo556` Bug A's regression check now pins that the release call without `skipAmcpApply` no longer
      re-PLAYs the kept program channel. The flash it documented came from this restart.
- Not changed:
  - An audio-route edit still re-PLAYs with the new AF: `update()` → `timelineClipTransportStale`.
  - A newly routed channel still gets a full PLAY (no `_prevKey`).

## Verified

- **Offline suite:** 3390 tests, 3388 pass, 0 fail, 2 skipped. Lint 215 warnings (budget 216). Prettier OK. No file
  over 500 lines. No new unwired exports.
- **Godot:** tests 21892 passed / 0 failed. `run-client.sh --check` boot OK.
- **Live on the box** (server restarted; the owner's timeline pushed with POST /api/timelines, as the client does;
  PRV ch 2; position read from INFO):
  - `channel_2_framerate=50` right after the restart (was missing).
  - Paused seeks 10 / 20 / 33 s landed at 10 / 20 / 33 s (were 5 / 10 / 16.5).
  - Play from 33 s → 34.48 s after 1.5 s.
  - Playing seeks: to 12 s → 12.72 s after 1 s; to 40 s → 40.76 s after 1 s.
  - A 60-step drag (16 ms apart, 40 → 46 s) → 46.44 s, 0.7 s after release.
  - Wire for the whole run:
    - 1 × `LOAD 2-210 "PROJECTS/MHP_HARDER/INTRO" SEEK n` (LOAD OK);
    - 1 × RESUME, 92 × `CALL 2-210 SEEK n`;
    - STOPs only from the test's own stops; no PLAY restarts.
- The 14 Auras' programmer values were restored after the restarts (see WO-784).
- **Owner QA (relaunch the client):**
  - Scrub the ruler paused and playing.
  - Look at the PRV picture between steps; there should be no black.
  - Check A/V after a playing scrub, since that was WO-93's stated concern.
- Not tested: the implicit-loop length lookup (`resolveClipDurationMs`) with project-relative names. Untouched here.
