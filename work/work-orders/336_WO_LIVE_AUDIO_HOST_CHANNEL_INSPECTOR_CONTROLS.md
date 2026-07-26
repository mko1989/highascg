# WO-336 — live-audio controls belong in the host-channel inspector

**Source:** owner report 2026-07-26 — "in the inspector of live audio input host channel i only have labels and remove button. whatever it is it should be in here … there should also be a way to change, restart the audio input etc." Also: the Sources tab does not bring up an inspector, **nor should it**.

**Status: not started.** Written 2026-07-26.

## Verified current state

1. What the owner sees: `client/components/device-view-destinations-inspector-host-channel.js` handles `role === 'live_audio_input'` with only the generic info table (Label/Type/Caspar channel/…, ~:46-54), a descriptive note (:119), and a Remove button (`removeLiveAudioInputSlot`). No device select, no start/stop, no FFT toggle. File is 311 lines (500-line limit applies).
2. The full control set already exists in `client/components/inspector-live-audio-input.js` (259 lines): ALSA device select + refresh (loads `/api/audio/devices`), Start/Stop (`/api/audio/inputs/start`, per-slot by design — `/live-inputs/apply` would glitch on-air inputs), status line, and the **"Shader FFT source / Feed audio-reactive shaders"** checkbox (:72-76) which POSTs `audio_fft_source_slot` to `/api/audio/live-inputs/config` + `/apply` (:101-120).
3. But that component is only mounted from `inspector-panel.js:123` and `inspector-panel-routing.js:83` — selection paths the owner does not reach (and the Sources tab intentionally opens no inspector). Effectively dead UI.
4. Slot resolution for a host-channel destination already exists: `liveAudioSlotFromHostDestination` in `client/lib/device-view-host-channels.js` (imported by the host-channel inspector at :10).
5. Precedent for per-role mounted controls in the same file: `mountDecklinkHostSourceControls`, `mountBrowserDisplayControls`, `mountNdiHostSourceControls`.

## Fix direction

1. Refactor `inspector-live-audio-input.js` to export a mountable block, e.g. `mountLiveAudioSlotControls(host, { slot, onChanged })`, containing: device select (+ refresh), Start/Restart button, Stop button, status line, and the Shader FFT source checkbox with the "(now: slot N)" hint. Keep both files under 500 lines — extract shared helpers if needed.
2. In `device-view-destinations-inspector-host-channel.js`, for `role === 'live_audio_input'`: resolve the slot via `liveAudioSlotFromHostDestination(d)` and mount the block between the info table and the Remove button. Changing the device should call the same config route (`live_audio_input_<slot>_device`) + per-slot restart, and `markCasparRestartDirty` only if the applied path actually requires it.
3. Decide the fate of the two old mount points (`inspector-panel.js:123`, `inspector-panel-routing.js:83`): if no reachable selection produces them, delete the calls; the component file stays as the home of the mountable block.
4. Deploy: `npm run build:client` + kiosk reload (XTEST F5, not XSendEvent).
5. Repoint any smoke tests that grep the moved source text (readFileSync+regex concat pattern; curated CI list is hard-coded).

## Acceptance

- Selecting the live-audio input host channel in the device view shows: device dropdown with current device (DM3 = `alsa://hw:2,0` on slot 1), Start/Restart, Stop, live status, and the Shader FFT source checkbox reflecting `audio_fft_source_slot`.
- Toggling the checkbox makes `sh-fft-test` react / stop reacting without a node restart (server already rebinds FFT before bridge restart, `src/api/routes-audio.js:344-351`).
- Changing the device restarts that slot's bridge only; other on-air inputs unaffected.
- No inspector opens from the Sources tab.
- Built dist-web deployed; curated smokes pass.

## Constraints

- Single-select FFT source across slots is by design (WO-333b) — keep it.
- The per-slot Start endpoint exists precisely because `/live-inputs/apply` re-PLAYs every slot (`src/api/routes-audio.js:369-371` comment); the new Restart button must use the per-slot path.
