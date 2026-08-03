# WO-406 — Audio monitoring on a second output + mixer solo, end to end (todos03.08.26 item 2)

**Status: OPEN (triaged 2026-08-03 — most parts already exist in code; the enablement path is the missing piece)**
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

- **A406.1**: Which physical output should be the headphone/monitor out? (Motherboard
  analog out, HDMI/DP audio on the operator monitor, USB dongle…) `aplay -l` on the box
  will list candidates; the choice lands in `monitor_portaudio_device` / system-audio
  device-name.

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

## 3. What was done / verified

Nothing yet — triage only (this session verified the above file:line facts and the absence
of the enablement keys in the live config).
