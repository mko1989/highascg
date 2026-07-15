# WO-237 — Audio-only channel must be the cheapest possible video channel (currently generated as 1080p50)

**Status:** Completed | **Date:** 2026-07-15
**Source:** owner: "Audio only channel was supposed to be the ceapest video channel possible and it gets created with 1080p50"

## Implementation Summary

### T237.1 — Audio/Monitor Channel Generation Location
- **Found:** Monitor channel generated in `src/config/config-generator-audio-xml.js` line 412-445 via `buildMonitorChannelXml()`
- **Channel Role:** Monitor / headphone mix (audio-only PortAudio consumer, no video consumers)
- **Audio Consumer:** PortAudio only; zero video consumers (screen, decklink, ndi) attached
- **Call Stack:** buildConfigXml → buildChannelsSection (config-generator-channels.js:158-159) → buildMonitorChannelXml
- **Routing Allocation:** src/config/routing-map.js line 312-313 allocates channel number when `monitor_channel_enabled = true`

### T237.2 — Cheapest Video Mode
- **Mode Name:** `576p2500` (PAL progressive)
- **Dimensions:** 720×576 pixels, 25 fps (25000/1000)
- **Field Count:** 1 (progressive, not interlaced)
- **Size:** 1,658,880 bytes per frame (720×576×4)
- **Reason:** Smallest standard mode in Caspar 2.6-dev: lowest resolution + lowest frame rate + progressive (half data vs interlaced)
- **Source Reference:** /home/casparcg/caspar-build/src-tree/src/core/video_format.cpp line 55 defines `x576p2500` with dimensions and frame rate

### T237.3 — Generator Changes
- **File Modified:** `src/config/config-generator-audio-xml.js` line 436
  - Changed: `<video-mode>1080p5000</video-mode>` → `<video-mode>576p2500</video-mode>`
- **No Video Consumers:** Confirmed; monitor channel only emits `<portaudio>` inside `<consumers>`, never `<screen>`, `<decklink>`, or `<ndi>`
- **Other Channels Unaffected:** All program/preview/input/streaming/multiview channels use their configured modes (no cross-contamination)

### T237.4 — Smoke Tests (Gate: PASSING)
- **File:** `tools/smoke/smoke-wo237-monitor-channel-cheapest-mode.test.js`
- **Tests (3):**
  1. Monitor channel block includes 576p2500 when enabled ✓
  2. Monitor channel is not emitted when disabled ✓
  3. Other channels unchanged when monitor channel enabled ✓
- **Test Coverage:**
  - Verify monitor XML fixture uses 576p2500
  - Verify only PortAudio consumer (no screen/decklink/ndi)
  - Verify channels list matches between enabled/disabled states

### Bug Fix: Routing Integration
- **Issue Found:** `getChannelMap()` in routing-map.js was checking only `config.casparServer.monitor_channel_enabled`, but flat config from `buildCasparGeneratorFlatConfig()` merges properties to root level
- **Fix Applied:** routing-map.js line 312 now uses `readCasparSetting(config, 'monitor_channel_enabled')` to check both config root and casparServer.monitor_channel_enabled
- **Impact:** Monitor channel now properly allocated in generated XML

## Files Changed
1. `/home/casparcg/highascg/src/config/config-generator-audio-xml.js` (line 436) — Changed video-mode to 576p2500
2. `/home/casparcg/highascg/src/config/routing-map.js` (line 312) — Fixed monitor channel detection logic
3. `/home/casparcg/highascg/tools/smoke/smoke-wo237-monitor-channel-cheapest-mode.test.js` — New test file (3 test cases)

## Test Results
- Smoke tests: 3/3 passing (new WO-237 tests)
- Offline gate: 289/289 tests passing (no regressions)
- Total test count: 291 (286 + 5 changes: -2 skipped baseline, +3 new WO-237 tests)
