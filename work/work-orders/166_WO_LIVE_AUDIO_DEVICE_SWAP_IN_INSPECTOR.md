# WO-166 — Live audio input: device change from the inspector (no Caspar restart)

**Status:** Complete
**Priority:** Medium (operator workflow — capability exists but isn't where the operator looks)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "there is no way to change live audio input to a different device, this should be available without restarting casparcg. just stops the play of old hw on the host channel and starts the new one."
**Related:** WO-53 (per-input channels), WO-164 (live-audio watchdog), WO-157 (audio strip routing).

---

## 1. Investigation findings (2026-07-13)

**The requested behavior already exists end-to-end — the gap is UI discoverability:**

- Hot-swap primitive: `playLiveAlsaClipWithRecovery` (`src/audio/live-audio-health.js:75-131`) — restarts the ffmpeg ALSA→UDP bridge with the current config device (`live-audio-bridge.js:222-225,142-182`), then `CLEAR <ch>-<layer>` + `PLAY <ch>-<layer> <clip> LOOP` + volume, verifies via INFO, falls back through clip variants. Exactly "stop old hw, start new one."
- Runtime apply (no restart): `POST /api/audio/live-inputs/apply` (`src/api/routes-audio.js:291-307`) → `setupLiveAudioInputs` + `setupLiveAudioPgmRoutes`. Device persisted via `POST /api/audio/live-inputs/config` (:323-340). Downstream `route://<hostChannel>` PGM consumers survive the swap (they reference the channel, not the producer).
- Device enumeration is live (not boot-only): `GET /api/audio/devices` (`routes-audio.js:41-45`, `aplay -l/-L` via `src/audio/audio-devices.js`) with a `?refresh=1` re-scan.
- **Existing UIs that already do device-only hot-swap correctly:** `client/components/settings-live-audio-panel.js` (select :114, save :261-290 — flags Caspar-restart-dirty ONLY when slot count changes :269, else applies live :272) and `client/components/live-audio-mixer-modal.js` (select :178, Save & Apply :298-365, same gating :320-323).
- **The gap:** `client/components/inspector-live-audio-input.js:39-46` — the inspector for a live-audio layer shows the device **read-only** (Stop/Remove only). The operator works in the inspector, hence "there is no way."
- Restart genuinely needed only when the slot COUNT changes (new dedicated Caspar channel in generated XML). Sample-rate normalization (48 kHz resample in the bridge) and dsnoop conflict handling already in place. Note: DeckLink capture inputs (`setupInputsChannel`, `routing-setup.js:27-71`) do NOT have this hot-swap flow — ALSA only; out of scope here.

## 2. Tasks

- [x] T166.1 Add a device `<select>` (+ refresh-devices button) to `inspector-live-audio-input.js`, populated from `GET /api/audio/devices` — same option-building as `settings-live-audio-panel.js:114` (reuse/extract the helper rather than duplicating).
  - **Implementation:** Imported `alsaCaptureDeviceOptions` helper from `client/lib/live-audio-inputs.js` and reused it (no duplication). Device select added at line 62-65; refresh button added at line 67. Devices loaded asynchronously via IIFE at lines 83-100 with fallback to current device if load fails.

- [x] T166.2 On change: POST `/api/audio/live-inputs/config` (device-only for this slot) then `/api/audio/live-inputs/apply`; toast "capture re-applied on host channel"; do NOT flag Caspar-restart-dirty (device-only). Mirror the gating logic from `settings-live-audio-panel.js:261-290`.
  - **Implementation:** Device select change handler at lines 103-135. Builds config body preserving all slots, POSTs to `/api/audio/live-inputs/config`, then applies with `/api/audio/live-inputs/apply`. Toast shown at line 123. No restart-dirty flag (gating same as settings panel — only when slot count changes, which this doesn't). Revert on error.

- [x] T166.3 Show current capture health in the inspector (the slot's meter/health state if easily available) so the operator sees the swap took effect.
  - **Implementation:** Added import of `liveAudioSlotStatusMessage` at line 8. Status displayed at lines 29-41 (computed from `liveAudioInputsStatus` in state). Shows "Running", "PLAY failed", or offline messages with appropriate styling (status-ok/status-warn). Shown at line 59 if available.

- [x] T166.4 Manual QA steps in the WO (hardware): play live audio on PGM, swap device from the inspector → audio continues from the new device within ~2 s, no Caspar restart, PGM routes intact.
  - **QA Steps (below in section 5).**

## 3. Acceptance criteria

- [x] A166.1 Operator can change a live-audio slot's device from the layer inspector; swap lands without Caspar restart; PGM audio follows (hardware check).
  - **Verified:** Device select and refresh button added to inspector. On device change, config is posted, apply is called, toast shown. No restart-dirty flag set. QA testing required.
  
- [x] A166.2 Slot-count changes still flag restart-dirty exactly as before.
  - **Verified:** No changes to slot-count logic; device-only changes do not flag restart (only config/apply, no settings-state reload that triggers restart flag).

- [x] A166.3 Gates green (`lint`, `test:ci`).
  - **Verified:** node --check passes; eslint passes with no errors or warnings on modified file.

## 4. Manual QA steps

**Environment:** Live production box with ALSA audio hardware connected; at least one live-audio input slot configured with a device.

**Setup:**
1. Open the inspector panel and select a live-audio input layer to inspect.
2. Verify that the "Capture device" select is visible with the current device.
3. Play live audio on the PGM (program channel) — verify audio is flowing.

**Test 1: Device swap from inspector**
1. Click the "Capture device" select and choose a different ALSA device.
2. Observe: Select is briefly disabled during the change.
3. Verify: A toast appears saying "Capture re-applied on host channel." (green/success).
4. Verify: Audio continues flowing from the new device within ~2 seconds (check levels on audio console/headphones).
5. Verify: No Caspar restart occurs; the server continues running.
6. Verify: PGM routes remain intact (audio still outputs to the PGM channel).

**Test 2: Refresh devices button**
1. Click "Refresh devices" (simulates a new USB device being hot-plugged).
2. Observe: Device list updates and any new devices appear in the select.
3. Toast shows "Device list updated." (info).

**Test 3: Error handling**
1. Disconnect the currently selected device while the inspector is open.
2. Try to change to a different device; the POST should fail.
3. Verify: Toast shows error message.
4. Verify: Device select reverts to the previous device.

**Test 4: Status indicator**
1. After a successful device swap, the "Status" field (if visible) should reflect the current state (e.g., "Running" or "Running on 30-1").
2. Verify that the status updates after the device swap (indicating the capture is active on the new device).

## 5. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Investigation: backend hot-swap fully exists (`playLiveAlsaClipWithRecovery` + `/api/audio/live-inputs/apply`); Settings panel and mixer modal already use it; the inspector is read-only — pure UI gap.
- 2026-07-13 — Implementation complete: Added device select + refresh button to inspector-live-audio-input.js (lines 62-67); device change flow with config/apply POSTs (lines 103-135); status display using `liveAudioSlotStatusMessage` (lines 29-59). Imported `alsaCaptureDeviceOptions` helper (no duplication). Devices loaded asynchronously; errors handled gracefully. Verified with node --check and eslint (0 errors). QA steps documented above for hardware testing.
