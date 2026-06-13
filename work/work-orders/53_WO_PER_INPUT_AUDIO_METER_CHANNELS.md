# WO-53 — Dedicated channel per live input (isolated VU per input)

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" at the bottom describing what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry.
> 4. Do NOT delete previous agents' log entries.

## Implementation status (HighAsCG)

| Item | Status |
|------|--------|
| `getLowestStandardVideoModeId()` mode helper | Implemented (`src/config/config-modes.js`) |
| Default `live_audio_input_channel_mode` | Implemented (`src/config/defaults-caspar-server.js`) |
| Per-input channel allocation in channel map | Implemented (`src/config/routing-map.js`) |
| Per-input channel XML generation (`audio-osc`) | Implemented (`config-generator-*`) |
| DeckLink/ALSA playout on dedicated channels | Implemented (`src/config/routing-setup.js`) |
| `inputChannels` / `decklinkInputChannels` / `liveAudioInputChannels` exposed to client | Implemented (`src/config/channel-map-from-ctx.js`) |
| Multiview / Sources / device-view / live-input-modal re-pointed to per-slot channels | Implemented |
| Per-input VU section in audio mixer | Implemented (`client/components/audio-mixer-panel.js`) |
| Manual QA on target hardware | Pending |

---

## Problem

Live audio inputs (ALSA capture) and DeckLink capture inputs were all hosted on a **single shared
Caspar channel** (`inputsCh`):

- DeckLink slots `1…8` played on **layers `1…8`** (`PLAY inputsCh-N DECKLINK <device>`).
- Live ALSA slots played on **layers `10+`** (`PLAY inputsCh-{10+slot-1} alsa://… LOOP`).

CasparCG OSC only publishes **post-mix, channel-level** audio meters (`/channel/N/mixer/audio/…`); it
does **not** expose per-layer meters. So the inputs host channel's VU showed the **sum** of every input
on it. When several inputs (or another clip) played at once, the operator could not tell which input
produced audio, nor meter/preview a single input in isolation.

## Goal

Give **each live input its own isolated VU meter** by giving each input its **own Caspar channel** — so
the channel-level OSC meter equals exactly one input.

- **DeckLink inputs:** each gets its **own dedicated, full-quality channel** (at `inputs_channel_mode`).
  The DeckLink producer plays there directly (layer = slot). This is the input's real channel for
  video routing too — not a "cheap" side-channel.
- **Audio-only (ALSA) inputs:** each gets its **own cheap channel** at the **lowest standard video
  mode** (`getLowestStandardVideoModeId()` → `PAL`). The ALSA producer plays there directly (layer 10).

Inputs are **no longer bundled** onto a shared host (or onto the multiview channel).

## Design decision — one channel per input

Previously all inputs shared `inputsCh`, which is precisely what made per-input metering impossible.
The fix separates them:

- DeckLink is only opened once by the hardware anyway; giving each DeckLink its **own** channel is the
  natural CasparCG model (decode once on that channel, `route://` it everywhere — PGM, multiview,
  Sources → Live). Full quality is required because this is the actual video source channel, so it uses
  `inputs_channel_mode` (default `1080p5000`), **not** the lowest mode.
- ALSA inputs carry no useful video, so their channel can be the **cheapest standard mode** to keep
  GPU/compositor cost negligible. `getLowestStandardVideoModeId()` picks the smallest-area standard mode
  **with an integer frame rate** (clean 48 kHz audio cadence → stable meters); `NTSC` (720×486) is
  smaller but uses fractional 29.97 fps, so `PAL` (720×576 @ 25) is used. Override via
  `live_audio_input_channel_mode`.

Each input channel has `<audio-osc>true</audio-osc>` and no config consumers (producers are started via
AMCP). Because a channel hosts exactly one input, its channel-level meter is already isolated — no
extra metering channels or routing tricks are needed.

## Configuration model

`casparServer` keys:

| Key | Default | Meaning |
|-----|---------|---------|
| `inputs_channel_mode` | `1080p5000` | Video mode for each DeckLink input's dedicated channel (full quality). |
| `live_audio_input_channel_mode` | `''` (empty → lowest standard mode) | Video mode for each ALSA input's cheap channel. |
| `decklink_input_count` | `0` | Number of DeckLink inputs (each → one channel). |
| `live_audio_input_count` | `0` | Number of ALSA inputs (each → one channel). |

### Channel allocation (`getChannelMap`)

After program/preview and multiview channels are allocated, allocate one channel per input (DeckLink
first, then ALSA), then extra-audio/monitor/streaming. Exposed on the map:

```
inputChannels: Array<{
  kind: 'decklink' | 'live_audio',
  slot: number,            // 1-based input slot
  channel: number,         // dedicated Caspar channel
  layer: number,           // play layer (decklink: slot; alsa: 10)
  mode: string,            // video-mode id (decklink: inputs_channel_mode; alsa: lowest)
  route: string,           // route string for consumers (decklink: route://ch-slot; alsa: route://ch)
  label: string,           // 'DeckLink 1' / 'Live audio 1'
}>
decklinkInputChannels: number[]   // channel per DeckLink slot (index = slot-1)
liveAudioInputChannels: number[]  // channel per ALSA slot (index = slot-1)
inputsCh                           // back-compat alias = first input channel
inputsOnMvr                        // always false (no bundling)
```

### Playout (`routing-setup.js`)

- `setupInputsChannel`: for each DeckLink entry, `PLAY <channel>-<slot> DECKLINK <device>` (device
  conflict/duplicate detection preserved).
- `setupLiveAudioInputs`: for each ALSA entry, `PLAY <channel>-10 <alsa-uri> LOOP`.
- `setupLiveAudioPgmRoutes`: routes each ALSA input's full-channel route to PGM (unchanged behaviour).

### Client

`channel-map-from-ctx.js` forwards `inputChannels`, `decklinkInputChannels`, `liveAudioInputChannels`
(with per-channel resolution) into the WebSocket channel map. Consumers re-pointed to per-slot channels:

- **Audio mixer** (`audio-mixer-panel.js`): "Live inputs" section, one VU per `inputChannels` entry,
  reading the real isolated channel meter from OSC.
- **Sources → Live** (`sources-panel-helpers.js`, `sources-panel.js`, `sources-panel-live-render.js`),
  **multiview** (`multiview-layout-helper.js` `routeForCell`/`overlayType`, `multiview-state.js`),
  **device-view DeckLink inspector** (`device-view-inspector-decklink.js`), **live-input modal**
  (`live-input-modal.js`), and **mixer-fill** (`mixer-fill.js`) all resolve a DeckLink slot to its own
  channel (`decklinkInputChannels[slot-1]`, layer = slot).

## Related files

| Area | File |
|------|------|
| Lowest-mode helper | `src/config/config-modes.js` |
| Defaults | `src/config/defaults-caspar-server.js` |
| Channel map allocation | `src/config/routing-map.js` |
| Live audio route/layer resolution | `src/config/live-audio-input.js` |
| Channel plan / XML | `src/config/config-generator-channel-plan.js`, `config-generator-channels.js`, `config-generator-consumer-attach.js` |
| Playout | `src/config/routing-setup.js` |
| Client channel map | `src/config/channel-map-from-ctx.js` |
| Config compare / device snapshot | `src/config/config-compare.js`, `src/api/device-view-snapshot.js` |
| Multiview | `src/api/multiview-layout-helper.js`, `src/api/routes-multiview.js`, `client/lib/multiview-state.js` |
| Sources / device view / modal / mixer-fill | `client/components/sources-panel*.js`, `device-view-inspector-decklink.js`, `live-input-modal.js`, `client/lib/mixer-fill.js` |
| Audio mixer UI | `client/components/audio-mixer-panel.js` |

## Acceptance criteria

1. With `decklink_input_count` and/or `live_audio_input_count` > 0, generated `casparcg.config` contains
   one `<channel>` per input — DeckLink at `inputs_channel_mode`, ALSA at the lowest standard mode — each
   with `<audio-osc>true</audio-osc>` and empty consumers.
2. After "Apply server config and restart", each DeckLink plays on its own channel and each ALSA plays
   on its own channel; every input's OSC meter moves only with that input's audio.
3. The Inspector audio mixer shows a per-input "Live inputs" VU section; one input's audio does not
   bleed into another's meter.
4. DeckLink video routing, multiview cells, Sources → Live, and live-audio PGM routes resolve to each
   input's dedicated channel and play correctly.

## Non-goals (v1)

- Per-input fader/solo control on the input channel (metering only; existing solo/monitor system stays).
- Migration of saved looks/scenes that reference the old `route://oldInputsCh-N` strings (DeckLink input
  count was `0` at change time, so no existing routes to migrate).

## Work Log

### 2026-06-13 — Agent (WO creation + first implementation)

**Work Done:** Initial implementation used **additive** cheap meter channels that `route://`'d each
input's layer off the shared host (DeckLink stayed bundled on one channel). See status table history.

### 2026-06-13 — Agent (rework per user correction)

**Work Done:** Reworked per user feedback: DeckLink inputs are no longer bundled on a shared host —
**each DeckLink input now gets its own dedicated full-quality channel**, and **each ALSA input gets its
own cheap channel**. Removed the additive meter-channel machinery (`setupInputAudioMeters`,
`buildInputAudioMeterChannel`, `input_audio_meters_enabled`/`input_audio_meter_mode`). Added
`inputChannels` / `decklinkInputChannels` / `liveAudioInputChannels` to the channel map; emitted one
channel per input in the config generator; played DeckLink/ALSA on their own channels; re-pointed all
DeckLink route consumers (multiview, Sources, device-view inspector, live-input modal, mixer-fill) to
per-slot channels; pointed the audio mixer "Live inputs" VU at each input's dedicated channel. Updated
`config-compare` and `device-view-snapshot` to list per-input channels. Updated/added smoke tests in
`tools/smoke/smoke-config-generator-routing.js` (all 12 pass).

**Instructions for Next Agent:** Validate on target hardware with real DeckLink + ALSA inputs: confirm
each input has its own channel in INFO, that each channel's meter tracks a single input, and that
multiview/Sources/PGM routes still play. Then tick the "Manual QA" row. Note the WO filename still says
"meter channels"; the design is now "one channel per input" — rename only if convenient.
