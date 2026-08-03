# WO-409 — PRV bus strips in the audio mixer (pre-take monitoring)

**Status: DONE (2026-08-03 — suite 1781/0/2, built + kiosk reloaded + service restarted; SOLO listening leg is owner-QA-gated on WO-406's Apply+restart)**
**Priority:** High (owner todos03.08.26: "the prv channels need to appear in audio mixer, so operators can monitor the audio of video before taking it to pgm")
**Source:** `work/work-orders/todos03.08.26` item 7
**Related:** WO-406 (monitor/headphone solo bus — PRV SOLO plays onto it), WO-115 (mixer split), WO-284 (audio screens)

## 1. Investigation

`collectProgramAudioRows` (client/lib/audio-mixer-rows.js) iterated **`cm.programChannels`
only** — the mixer had no concept of a PRV strip. Three consumers had PGM baked in:

- `parseBusMeterFillKey` regex-pinned `^pgm:` — a PRV master's meters would never update
  (meter loop itself is channel-generic, `readBusChannelPeakDbfs(casparChannel, …)`).
- Both solo POST call sites (console input groups, panel input layers) inline-parsed keys as
  `pgm:ch:layer:ln` — a whole-channel key would have produced `{ layer: NaN }` →
  `route://ch-NaN`.
- `/api/audio/solo` built `route://${channel}-${layer}` unconditionally — no way to solo a
  full channel (which is what "listen to this PRV" means).

PRV channels already emit audio OSC (`<mixer><audio-osc>` on ch 2 in the live config), so
meters need no server work.

## 2. What was done

- `audio-mixer-rows.js` — after each PGM master row, a `prv:<ch>` master row per screen
  (`cm.previewChannels[i]`, `isPreview: true`); callers pass `previewLabel`
  ("PRV 1 Master" console / "PRV 1 (ch N)" panel).
- `audio-mixer-console-masters.js` — badge shows PRV on preview strips + a SOLO button:
  toggles the shared solo store and POSTs `/api/audio/solo` like the layer strips
  (`syncAllSolosUI` already covers it by data-key). Fader = channel MASTER volume via the
  existing generic `postAudioVolume`.
- `audio-mixer-state.js` — `soloKeyToTarget(key)`: `pgm:1:layer:10` → `{channel, layer}`,
  `prv:2` → `{channel}`. Both former inline parsers now use it.
- `routes-audio.js` — a layer-less solo target routes the whole channel
  (`route://<ch>`).
- `audio-mixer-bus-meters.js` — meter fill key regex accepts `prv:` masters.
- `tools/smoke/smoke-wo409-prv-mixer-strips.test.js` (in the CI list) — 5 tests: mapper
  behavior (behavioral import), row model, renderer wiring, layer-less route, meter regex.

Panel (inspector) view gets the PRV strip with meter + fader; SOLO button is console-only
for now (the panel's layer strips keep theirs).

## 3. What was VERIFIED to work

- Suite 1781 pass / 0 fail / 2 skip; `build:client` + kiosk F5; `highascg` service
  restarted (solo route change live; caspar untouched).
- NOT yet heard: actual PRV audio in headphones — that leg needs WO-406's monitor channel
  in the RUNNING caspar (owner: Apply config → Caspar restart), then: open mixer → PRV
  strip meters move with preview content → SOLO → hear it on the USB headset before take.
