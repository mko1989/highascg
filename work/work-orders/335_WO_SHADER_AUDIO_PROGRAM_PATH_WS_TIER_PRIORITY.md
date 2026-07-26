# WO-335 — shader audio reactivity on the Caspar program path (WS FFT tier priority)

**Source:** owner report 2026-07-26 — "works in the little preview window of the modal, but does not receive audio when on caspar's program."

**Status: core fix implemented and verified on program 2026-07-26; follow-up tasks open.** This is the file-form continuation of the WO-333/333b labels already used in code comments (no 333 file exists; do not reuse the number).

## Root cause (verified live via CDP on Caspar's CEF, port 9222)

A `file://` page in CEF is a **secure context**: `navigator.mediaDevices.getUserMedia` exists and auto-grants without a prompt, returning the "Default" ALSA device — the silent ALC1220 analog input (the DM3 is exclusively held by the live-audio bridge and unavailable). Old `template/shaders/player.js` tried tier A (getUserMedia) first and, on success, never consulted the WS `audio_fft` feed — which the same probe showed working fine from inside CEF. The GUI modal preview is served over LAN http (insecure context, no `mediaDevices`), so it fell through to the WS tier and worked. Hence preview-works / program-silent.

## Implemented (2026-07-26, template/shaders/player.js)

1. `start()` now always runs `initTierB()` (WS) and starts `initTierA()` in the background without blocking or gating (`player.js` ~275-283).
2. `updateAudio()` priority per frame: fresh WS `audio_fft` (< 1.5 s) wins → else analyser → else OSC-level synth (`player.js` ~254-265). `sampleTierB()` reduced to pure synth fallback; header comment rewritten.
3. Verified: CDP-reloaded `sh-fft-test` on the live program (2560×896 CEF page), two screenshots 2 s apart show a live moving spectrum/waveform from the DM3.
4. Also this session: `sh-fft-test` shader added to the library as an unmistakable reactivity test card (spectrum bars + waveform + bass flash); shader-FFT source routed from live-audio slot 1 via `audio_fft_source_slot=1` (see the host-channel inspector WO-336).

No re-export of existing `sh-*.html` templates was needed — they all reference the shared `player.js`.

## Remaining tasks

1. Smoke coverage: check `tools/smoke/smoke-wo266-shader-fx.test.js` / `smoke-wo268-shader-cef-continuity.test.js` for readFileSync+regex assertions against the old player.js text (repo convention: refactors must repoint them) and run the curated smoke list.
2. Tier A device pick hardening (`player.js` `pickAudioDevice`): when WS is down, only use the analyser if a `monitor|loopback` device matched or `?audioDev=` was given — never silently fall back to a default mic that shadows nothing but still reports `audioMode='analyser'`.
3. `template/shaders/ShaderToyLite.js:283` fills `iChannelResolution[]` with canvas size for every channel; the audio channel should report `(512, 2, 1)`.
4. `docs/wiki/guides/shader-fx.md`: the "no monitor/loopback device on a stock box" warning predates the slot-tee routing — update it to name the inspector "Shader FFT source" toggle as the primary path for program-audio reactivity.

## Acceptance

- `sh-fft-test` visibly reacts on Caspar program (CEF) and in the shader modal preview, with the FFT source routed from a live-audio slot.
- Killing the node (FFT feed gone) degrades shaders to OSC-level synth within ~1.5 s and recovers when it returns.
- Curated smokes pass.

## Constraints

- Only shaders with a pass channel set to `audio` AND GLSL that samples that iChannel react — the `audio.enabled` checkbox alone does nothing (7 of the 8 pre-existing shaders are wired to nothing; that is authoring, not a bug).
- Never point `config/audio_capture.json` device mode at the DM3 — it is a single-open hw device owned by the bridge; the slot tee (UDP :52221) is the correct source.
