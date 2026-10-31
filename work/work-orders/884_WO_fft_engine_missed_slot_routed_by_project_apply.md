# WO-884 — Live audio playing, audio-reactive visuals still: the FFT engine never followed a slot routed by a project apply

**Area:** audio, engine
**Status: DONE (31.10, smoke 2/2; box: the listener was rebound and frames carry the live audio — 85 frames / 3 s, rms
0.014–0.135, kick counting)**

Owner 31.10: *"have live audio playing now, it has feed audio reactive visuals, but it doesnt look like anything is
coming."*

## 1. Investigation

- No UDP listener on `127.0.0.1:52221`, while the live-audio bridge (ffmpeg, started 08:48) tees s16le PCM to exactly
  that port (`udp://127.0.0.1:52221?pkt_size=1316`, `src/audio/live-audio-bridge.js:187`). Caspar listens on :52201 only.
- The journal has one `[AudioFFT]` line today: node start 08:20:37 `no source routed (live-audio inspector) and
  config.audioCapture disabled`.
- The source arrived later: the mhp_harder project's `hardwareConfig.casparServer.audio_fft_source_slot = 1` came back
  with the WO-882 repair, and apply-hardware / the Caspar apply wrote it to the live config, so the bridge restarted with
  the tee. The FFT engine reads the setting only at node start (`index.js:419-420`) and on the Audio inspector's own
  `POST /api/audio/live-inputs/apply` (`src/api/routes-audio.js:395`). A project load, apply-hardware or Caspar apply
  never rebinds it, so with any source routed that way the visuals get no frames.

## 2. What was done

- `src/bootstrap/audio-capture-lifecycle.js`: `resolveCaptureConfig()` split out of `startAudioCapture()`; the start
  remembers the resolved config; `syncAudioCapture()` restarts the engine only when that changed (same source → no gap).
- `src/config/routing-setup-live-inputs.js` `setupLiveAudioInputs`: calls `syncAudioCapture()` first, so on every
  live-audio setup (Caspar connect, apply, project load, the inspector apply) the listener is bound before any bridge
  PLAY starts its tee.
- `tools/smoke/smoke-wo884-fft-follows-routed-slot.test.js` (curated, offline-test-files-2): boot unrouted → slot set →
  sync rebinds and listens; unchanged → no rebind; unrouted → stops; setupLiveAudioInputs syncs before the PLAY.

## 3. What was verified

- Smoke 2/2 (fails on the old code: no `syncAudioCapture`).
- Box, live fix without a node restart (a restart would raise the WO-638 screen choosers mid-test):
  `POST /api/audio/live-inputs/apply` → `[AudioFFT] listening for bridge PCM tee on udp://127.0.0.1:52221`; a WS
  client saw 85 `audio_fft` frames in 3 s, rms 0.014–0.135, `parts.kick.n` counting.
- The new sync path itself loads at the next node restart (unit-proven, not yet exercised on the box).
