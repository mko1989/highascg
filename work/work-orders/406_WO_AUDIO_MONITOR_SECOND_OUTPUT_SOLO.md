# WO-406 — Audio monitoring on a second output + mixer solo, end to end (todos03.08.26 item 2)

**Status: IN PROGRESS (implemented + staged 2026-08-03; owner QA = Apply config → Caspar restart → SOLO with the USB headset)**
**Priority:** High (owner: "a good way to get audio monitoring on a second audio output (system audio) so I can monitor each channel or input by soloing it in the audio mixer")
**Source:** `work/work-orders/todos03.08.26` item 2
**Related:** WO-44 (the original spec for exactly this — requirements doc, never carried a status line and was never implemented as a whole), WO-115 (mixer split), WO-157 (screen-then-pair routing), WO-249 (source-pair reporting), WO-16/WO-354-era (DM3 — **hardware is single-open**, so the monitor output must be a different physical device than the DM3 main out)

## 1. Investigation (what exists vs what's missing)

### Already in the tree — the solo system is substantially built

- **Server solo API**: `src/api/routes-audio.js:284` — `POST /api/audio/solo` takes
  `{ solos: [{channel, layer}…] }`, plays `route://` sources onto a monitor channel's solo
  layer band, multi-solo summing and clear-to-default included.
- **Config model**: `src/config/audio-preview.js` — `normalizeAudioPreview()` reads
  `audio_preview_enabled`, `audio_preview_bus` (`preview_1` | `multiview`), device name, solo
  layer band (`soloLayerStart`/`Count`), default source; `resolveAudioPreviewChannel()` falls
  back to `map.monitorCh`.
- **Config generation**: `src/config/config-generator-audio-xml.js:412` —
  `buildMonitorChannelXml()` emits a dedicated monitor channel when
  `monitor_channel_enabled` is true, with `monitor_portaudio_device`; root
  `<system-audio>` already emitted (`caspar_root_system_audio: true` on this box,
  `highascg.config.json:23`).
- **Mixer UI**: `client/components/audio-mixer-console-input-groups.js:129,202-212` — SOLO
  button per strip, Ctrl/Cmd+click multi-solo, posts to `/api/audio/solo`, and already
  degrades gracefully ("Solo API not supported on this playout server") — which is exactly
  what happens on this box today.

### Missing — why the owner has no monitoring

1. **Nothing enables it.** `rg audio_preview_enabled client/` → zero hits: no settings UI or
   device-view surface sets `audio_preview_enabled` / `monitor_channel_enabled`. On this box
   neither key is in `highascg.config.json`.
2. **No monitor consumer in the generated config.** Live `config/casparcg.config` has 5
   channels (PGM, PRV, Operator GUI, live-audio, NDI) — no monitor channel, no second audio
   device. The single `<portaudio>` root consumer is `hw:0,0` stereo (the main out).
3. **Device selection.** WO-44 §Technical Notes flags the open question: enumerate system
   audio (ALSA/Pulse) devices distinctly from the PortAudio main out so the monitor consumer
   can target headphones/motherboard-out. `src/api/routes-audio.js` + `hardware-info.js` are
   the starting points. Constraint from the DM3 history: the DM3 is single-open — the
   monitor MUST be a different physical device.

### Owner input needed before building

- **A406.1**: Which physical output should be the headphone/monitor out? `aplay -l`
  (03.08): the main portaudio out `hw:0,0` is **card 0 ALC1220 Analog** (motherboard —
  already taken as main), so the candidates are **card 1 NVidia HDMI 0–3** (audio out
  through a monitor's speakers/headphone jack) or a USB audio dongle (none plugged in
  today). The choice lands in `monitor_portaudio_device` / system-audio device-name.

## 2. Work plan

1. Enablement surface per WO-44's shape: an "Audio Outputs" entry in device view (or a
   settings toggle as the minimal first cut) that sets `monitor_channel_enabled` +
   `audio_preview_enabled` + the device, then regenerates the caspar config (apply→restart
   flow, same as other consumers).
2. Device enumeration endpoint listing system-audio candidates, tagged separately from the
   DM3/main PortAudio device.
3. Verify the existing solo band end to end: solo one DeckLink input strip → hear it alone
   on the monitor out; Ctrl+click a second → summed; click again → back to the default
   source (PRV bus per `audio_preview_default_source`).
4. Smoke: config generator emits the monitor channel XML when enabled (extend the existing
   audio-xml smoke).

## 3. What was done (2026-08-03, same session as the triage)

Owner answered A406.1: user-selectable device, testing on a just-plugged **USB headset**
(`aplay -l`: card 2 Sennheiser SC60 → PortAudio id `hw:2,0`).

- **`src/config/monitor-bus.js` (new)** — `resolveMonitorBus(config)`: ONE resolver for the
  bus. Explicit `monitor_channel_enabled`/`monitor_portaudio_device` casparServer keys win;
  otherwise an enabled `audioOutputs` entry with `role: 'monitor'` **and a device name**
  supplies device + buffer/latency/fifo. No device → not enabled (a defaulted PortAudio
  device could double-open the main out). Reads both app config and merged flat config.
- **`src/config/routing-map.js`** — `monitorCh` allocation now goes through the resolver
  (net −1 line; file was at 490/500), so the runtime channel map (= what
  `/api/audio/solo` resolves) agrees with the generator.
- **`src/config/build-caspar-generator-config-audio.js`** — `applyMonitorBusToMerged()`:
  derives the flat `monitor_*` keys from the role entry after the cable loop, so
  `getChannelMap(merged)` and `buildMonitorChannelXml` see them.
- **`src/api/settings-post.js`** — the audioOutputs sanitizer whitelists fields and **ate
  `role` on the first live save** (found by the staging round-trip); now passes
  `role: 'monitor'` through.
- **`client/components/device-view-inspector-audio.js`** — "Monitor / headphone bus (mixer
  SOLO output)" checkbox in the audio-output inspector; save writes the role and the status
  line says Apply + Caspar restart are needed.
- **`tools/smoke/smoke-wo406-monitor-bus.test.js` (new, in the CI FILES list)** — 4 tests:
  resolver precedence/refusals, channel-map allocation, generator derivation + emitted XML,
  and source-pins on the client save, solo fallback, sanitizer passthrough.
- **Staged for the owner's test**: `audioOutputs` now carries
  `{id: audio_monitor_usb, role: monitor, deviceName: hw:2,0}` (posted via
  `/api/settings` after the service restart; `config/audio_outputs.json` has it).

## 4. What was VERIFIED to work

- Offline suite **1773 pass / 0 fail / 2 skip** including the new smoke.
- Node service restarted (deploy loop) and the live `/api/caspar-config/generate` output
  now contains `Caspar channel 5: Monitor / headphone mix` with `hw:2,0`, stereo, matching
  buffer settings — planned-vs-running diff is **exactly** that one channel block.
- NOT yet verified (owner QA): Apply config → Caspar restart → mixer SOLO plays the strip
  into the headset, Ctrl+click sums, clear returns the default (PRV 1) feed.

## 5. Caveats recorded

- **Do not press SOLO before Apply + Caspar restart**: the map already resolves monitorCh=5,
  but in the RUNNING caspar channel 5 is the (dormant) NDI host channel — solo would play
  routes onto it. Owner: NDI "is not live now, doesn't matter." Follow-up idea: guard the
  solo route with the WO-381 configComparison ("monitor channel not in running Caspar").
- The stored NDI extra live source pins `hostChannel: 5` while the map no longer allocates
  a channel for it — if that NDI source is ever re-enabled it will collide with the monitor
  channel. Same planned-vs-stored family as WO-377/381; fix belongs there, noted here.
