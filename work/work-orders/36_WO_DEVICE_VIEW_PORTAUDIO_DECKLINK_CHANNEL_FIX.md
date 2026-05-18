# Work Order 36: Device View — PortAudio pipeline, DeckLink detection, and channel enumeration fixes

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Fix the broken PortAudio pipeline, unreliable DeckLink port detection, and channel enumeration issues identified during the Device View audit. The core problems are:

1. PortAudio device list never reaches the UI (missing `audio` field in live snapshot)
2. PortAudio consumer XML is gated behind `custom_live` build profile with no UI control
3. Audio connectors (`audio_out`/`audio_in`) are never suggested by the device graph
4. DeckLink log parser uses hardcoded model name as startup marker
5. Virtual channel enumeration allows duplicate channel numbers

---

## Scope

### In scope

- Wire PortAudio device enumeration into the Device View live snapshot
- Add `caspar_build_profile` selector to Device View Caspar Settings inspector
- Add `audio_out`/`audio_in` connector suggestions from live PortAudio data
- Fix DeckLink log parser startup marker to be model-agnostic
- Add guard against duplicate/overlapping channel numbers in virtual channel mode

### Out of scope

- New PortAudio features (channel routing, spatial audio)
- DeckLink firmware/driver management
- Audio mixing UI

---

## Implementation plan

### Phase 1 — PortAudio device list in snapshot (Bug 1)
- [x] **T36.1** Add `listPortAudioDevices` call to `buildLiveSnapshot()` in `device-view-snapshot.js`
- [x] **T36.2** Return `audio: { portaudio: [...] }` in the live snapshot payload
- [x] **T36.3** Verify UI reads work: rear panel audio inventory, inspector device selector, monitor device selector

### Phase 2 — Audio connector suggestions (Bug 5)
- [x] **T36.4** Add `audio_out` / `audio_in` connector generation in `suggestConnectorsAndDevicesFromLive()` from PortAudio device list
- [x] **T36.5** Add `audio_out` to `AUTO_CASPAR_KINDS` in `device-graph-constants.js` so mergeHardwareSync replaces stale audio connectors

### Phase 3 — Build profile UI + PortAudio gate fix (Bugs 2 & 6)
- [x] **T36.6** Add `caspar_build_profile` dropdown (`stock` / `custom_live`) to the Caspar Settings inspector in `device-view-inspectors.js`
- [x] **T36.7** Wire save/load of `caspar_build_profile` through settings patch API
- [x] **T36.8** Show warning text when PortAudio is enabled but profile is `stock`

### Phase 4 — DeckLink log parser fix (Bug 3)
- [x] **T36.9** Replace hardcoded `'DeckLink 8K Pro'` startup marker with generic `'DeckLink'` match in `decklink-enum.js`
- [x] **T36.10** Improve backwards search to find the initialization block for any DeckLink model

### Phase 5 — Channel enumeration guard (Bug 4)
- [x] **T36.11** Add duplicate channel number detection in `getChannelMap()` for virtual main channels
- [x] **T36.12** Log warning when overlapping channel assignments are detected

---

## Acceptance criteria

- Audio devices appear on the rear panel when PortAudio devices are available
- PortAudio device dropdown in GPU connector inspector is populated
- Monitor Channel device selector is populated
- Setting `caspar_build_profile` to `custom_live` from UI causes PortAudio consumers to appear in generated CasparCG config
- DeckLink ports are detected regardless of card model (DeckLink Duo, Mini, 8K Pro, etc.)
- Virtual channel mode warns/prevents duplicate channel assignments

---

## Risks / notes

- `listPortAudioDevices` may add latency to snapshot builds (mitigated by TTL cache in audio-devices.js)
- Changing build profile requires CasparCG restart to take effect
- Audio connector IDs should be stable across restarts (keyed by device name)

---

## Work Log

### 2026-04-27 — Agent (WO creation from audit)

**Work Done:**
- Created WO-36 from Device View full audit findings.
- Documented 5 bugs with root cause analysis and fix plan.
- Organized into 5 implementation phases.

**Status:** Work order created. Starting implementation.

**Instructions for Next Agent:** Begin with Phase 1 (T36.1-T36.3) as it's the foundation for all audio-related fixes.

### 2026-04-27 — Agent (Full implementation of all phases)

**Work Done:**

**Phase 1 — PortAudio device list (T36.1-T36.3):**
- Added `listPortAudioDevices` import and call to `buildLiveSnapshot()` in `src/api/device-view-snapshot.js`
- Snapshot now returns `audio: { portaudio: [...] }` field
- Wrapped in try/catch to not block snapshot on enumeration failure
- UI reads at `live?.audio?.portaudio` and `lastPayload?.audio?.portaudio` now receive actual data

**Phase 2 — Audio connector suggestions (T36.4-T36.5):**
- Added PortAudio device → `audio_out`/`audio_in` connector generation in `suggestConnectorsAndDevicesFromLive()` in `src/config/device-graph-suggest.js`
- Uses stable slug-based IDs (e.g. `audio_out_hdmi_stereo`) to survive restarts
- Added `audio_out` and `audio_in` to `AUTO_CASPAR_KINDS` in `src/config/device-graph-constants.js`

**Phase 3 — Build profile UI (T36.6-T36.8):**
- Added `caspar_build_profile` dropdown (Stock / Custom Live) to `renderCasparSettingsInspector` in `web/components/device-view-inspectors.js`
- Wired save/load through the existing settings patch flow (`casparServer.caspar_build_profile`)
- Added dynamic warning message when profile is `stock` and PortAudio/Monitor features are enabled

**Phase 4 — DeckLink log parser (T36.9-T36.10):**
- Replaced hardcoded `'DeckLink 8K Pro'` in `src/utils/decklink-enum.js` with generic regex `/DeckLink\s+\S+/i`
- Made backwards search case-insensitive for DeckLink keyword detection
- Verified parsing works for DeckLink 8K Pro, Duo 2, Mini Monitor, Quad 2, etc.

**Phase 5 — Channel enumeration guard (T36.11-T36.12):**
- Fixed virtual channel assignment in `src/config/routing-map.js`: missing `prv` now results in `null` (disabled) instead of defaulting to `pgm` channel number
- Added duplicate channel detection loop with console.warn
- Verified: `{ pgm: '1' }` → `{ pgm: 1, prv: null }` (no overlap)

**Verification:**
- All routing-map tests pass (normal, virtual, no-prv scenarios)
- DeckLink parser correctly handles multiple card models
- PortAudio XML generation correctly gates on `custom_live` profile

**Status:** All 12 tasks complete. On-target testing recommended.

**Instructions for Next Agent:** Deploy to target hardware and verify:
1. Audio devices appear on rear panel and in inspector dropdowns
2. Changing build profile to "Custom Live" and enabling PortAudio produces valid XML config
3. DeckLink detection works with the actual hardware card model
4. Virtual channel mode prevents PGM/PRV overlap

---
*Work Order created: 2026-04-27 | Series: device-view audit fixes*
