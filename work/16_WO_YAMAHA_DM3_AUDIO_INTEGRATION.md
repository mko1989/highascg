# Work Order 16: Yamaha DM3 Audio Integration

> [!IMPORTANT]
> **AGENT COLLABORATION PROTOCOL**
> 1. Add dated entries to the **Work Log** in reverse chronological order.
> 2. Update task checkboxes (`[ ]` -> `[x]`) as they are completed.
> 3. Document design decisions or blockers in the work log.

---

## Goal

Integrate the **Yamaha DM3 Console** as the primary audio destination for the CasparCG server. Establish a stable stereo downmix to the console over USB and enable real-time visual metering in the WebUI via OSC telemetry.

## Tasks

### Phase 1: System-Level Audio Routing
- [x] **T1.1** Implement ALSA default device override logic
  - Method: `echo -e "defaults.pcm.card N\ndefaults.pcm.device M\ndefaults.ctl.card N" | sudo tee /etc/asound.conf`
  - Backend: `src/audio/audio-devices.js` -> `setDefaultAlsaDevice(card, device)`
- [x] **T1.2** Expose ALSA default setting via API
  - Route: `POST /api/audio/default-device`
  - Registered in `src/api/router.js` and `src/api/routes-audio.js`
- [x] **T1.3** Add UI for ALSA default selection
  - Location: **Settings > System** tab
  - Feature: List ALSA devices from `aplay -l` and allow the user to select and apply the system default.

### Phase 2: CasparCG Output Configuration
- [x] **T2.1** Configure stereo downmix for PGM
  - Logic: In `src/config/config-generator.js`, force `<channel-layout>stereo</channel-layout>` for all `<system-audio>` consumers in program channels.
- [x] **T2.2** Enable real-time audio telemetry
  - Logic: Ensure `<audio-osc>true</audio-osc>` is injected into the `<mixer>` block for all channels in the generated CasparCG config.

### Phase 3: UI/UX Refinement
- [x] **T3.1** Simplify Settings Modal
  - Rename "Audio / OSC" tab to **OSC**.
  - Remove redundant Caspar-specific FFmpeg audio output settings (moved to system-level ALSA management).
  - Keep OSC listener configuration (port, bind address, peak hold).
- [x] **T3.2** Verify Metering in Mixer Panel
  - Ensure the `audio-mixer-panel` component correctly reads OSC variables (`osc_chN_audio_L/R`) from the `VariableStore`.

---

## Work Log

### 2026-04-07 — Antigravity (Initial Implementation & Cleanup)

**Work Done:**
- **API:** Added `POST /api/audio/default-device` route to `router.js` and implemented the handler in `routes-audio.js`.
- **System Audio:** Implemented `setDefaultAlsaDevice` in `audio-devices.js` to write `/etc/asound.conf`.
- **WebUI:**
  - Added ALSA device selector to **Settings > System** tab in `system-settings.js`.
  - Refactored `settings-modal.js`: renamed "Audio / OSC" to **OSC** and removed defunct audio routing fields.
  - Fixed 404 error when applying audio settings due to missing route registration.
- **Config Generator:** Forced stereo layout for `<system-audio>` and ensured `<audio-osc>` is enabled for all channels.

**Status:**
- All phases (1–3) completed.
- System is ready for testing with the Yamaha DM3 console.

**Instructions for Next Agent:**
- Verify audio output on the physical console after clicking "Set ALSA Default" and "Write & Restart Caspar".
- Check if meters move in the bottom-right "Audio" panel during playback.

---
*Work Order created: 2026-04-07 | Parent: 00_PROJECT_GOAL.md*
