# CasparCG Enhanced

A build-ready fork of [CasparCG Server](https://github.com/CasparCG/server) maintained by [ifelseWare](https://github.com/gmeisel01).

This fork provides a single repository that bundles three improvements to CasparCG that are currently under review for inclusion in the main project. Rather than waiting for upstream merges, you can clone and build this fork today and have all three fixes working immediately.

---

## What's included

### Screen Consumer
The stock screen consumer has two limitations that affect non-standard output configurations:

1. **GL viewport bug** — When `<width>` and `<height>` are set to a non-standard canvas size (ultra-wide, LED wall, multi-display span), the GL render target was initialized to the channel's native format dimensions rather than the configured window size. The result was that content rendered at native resolution and was simply stretched to fill the larger window rather than rendered at full canvas resolution. This fix sets the GL viewport to the actual configured window dimensions from the start.

2. **No custom canvas documentation** — Using a non-standard canvas size also requires a matching `<video-modes>` entry in the config so the channel mixer itself operates at the correct resolution. Without it the mixer canvas stays at the native format width regardless of the screen consumer window size. The `casparcg.config` reference section has been updated with full documentation, cadence calculation guidance, and a complete working example for ultra-wide and multi-display configurations.

Additional options added to the screen consumer:
- `<aspect-ratio>` now accepts `width:height` ratio strings (e.g. `3840:1080`) and decimal values in addition to the standard named ratios
- `<always-on-top>` — keeps the output window above all other windows
- `<borderless>` — removes window chrome for clean fullscreen spanning across displays
- `<brightness-boost>` and `<saturation-boost>` — per-consumer linear color adjustments
- `<enable-mipmaps>` — improves quality when content is displayed significantly smaller than native resolution

---

### OAL System Audio Consumer
The stock OAL consumer is callback-driven, meaning the OpenAL audio clock controls when audio packets are dispatched. On channels that also have a video output, this causes the audio and video clocks to drift apart over time, producing gradual sync issues that worsen the longer the system runs.

This fix replaces the callback-driven dispatch with a video-scheduled approach — audio packets are scheduled to wall-clock time matching the video frame, mirroring the approach used by the DeckLink consumer. An auto-tune mechanism (75% correction factor, 1ms threshold) continuously trims any residual drift without audible artifacts.

---

### PortAudio Consumer
CasparCG has no native support for ASIO or JACK audio output. The only system audio option in stock CasparCG is the OAL consumer which is limited to stereo output on a single device.

This new consumer adds full ASIO (Windows) and JACK (Linux) support via PortAudio with the following capabilities:
- Configurable output channel count — not limited to stereo
- ASIO device selection by name with fuzzy matching
- Lock-free FIFO ring buffer bridging CasparCG's push model with PortAudio's pull callback
- Video-scheduled dispatch with the same auto-tune latency correction as the OAL fix
- Configurable buffer size, FIFO depth, and latency compensation

Config options: `<device-name>`, `<host-api>`, `<output-channels>`, `<buffer-size-frames>`, `<latency-compensation-ms>`, `<fifo-ms>`, `<auto-tune-latency>`

---

## Building
Follow the standard [CasparCG build instructions](https://github.com/CasparCG/server/blob/master/BUILDING.md). All three features are included in the `working` branch and require no additional steps to enable — they are built as part of the standard build process.

---

## Upstream PRs
Each of these changes has a corresponding pull request open against the main [CasparCG/server](https://github.com/CasparCG/server) repository. This fork exists so the community can use these features today without waiting for the upstream review process to complete.
