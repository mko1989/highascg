# Walkthrough — live-editable pixel-map fixtures (HighAsCG JS pipeline)

**Badge:** [DEPRECATED — legacyJsPixelmap flag] · [LIVE-EDITABLE] — everything here re-applies on save with **no Caspar restart** and no config regen.
**Engine:** WO-179 sampling pipeline (`src/sampling/`, `src/artnet/`, `client/lib/dmx-state.js`). Cites are `file:line` in this repo.
**Landscape / engine choice:** [ARTNET_PIXEL_MAPPING.md](ARTNET_PIXEL_MAPPING.md)

**WO-242:** this whole engine is deprecated in favor of native `pixelmap` screen destinations
(dedicated Caspar channel + native `<artnet>` consumer — see
[WALKTHROUGH_ARTNET_LED_WALL.md](WALKTHROUGH_ARTNET_LED_WALL.md) and the "Pixel-map screen (native)
— primary flow" section of [ARTNET_PIXEL_MAPPING.md](ARTNET_PIXEL_MAPPING.md)). The code below still
works exactly as documented, but its fixture-creation UI is now hidden unless `settings.ui.legacyJsPixelmap` is set to `true`. (Note: the Device View "mapping nodes" band — "+ Add mapping node" button — is a separate canvas-splitting feature and remains fully active; see the Pixel Map tab inspector and ARTNET_PIXEL_MAPPING.md for clarity.) Only this engine gives you
**sACN output** and **restart-free live remapping** — the native path is Art-Net only and requires a
config regen + Caspar restart per change. Re-enable the flag if you specifically need those two
properties; otherwise use the native flow.

Use this engine when the mapping changes during the show: pixel tape you re-aim after a set change, house-light sACN washes, anything you want to nudge from FOH mid-act.

---

## 1. How it runs (so you know what you're operating)

1. When `settings.dmx.enabled` is true and fixtures exist, the server attaches a sampling tap per source program channel: default is Caspar `ADD <ch> STREAM udp://…` (MPEG-TS) decoded by a local ffmpeg with `scale=…:flags=area` (`src/sampling/dmx-sampling-ingress.js:137-160`); fallback/opt-in FILE mode uses a raw-RGB FIFO on dedicated consumer slot **97** (`dmx-sampling-ingress.js:17,217-250`) — both are dynamic AMCP consumers, not config-file consumers.
2. The tap is downscaled to 10–50 % of PGM, sized from the densest fixture grid ×2 safety margin (`src/sampling/dmx-sampling.js:60-86`).
3. A worker thread samples each fixture's grid cells (center pixel or region average), applies brightness → gamma LUT → colorOrder (`src/sampling/sampling-worker.js:60-172`).
4. `DmxOutput.send()` transmits per fixture: Art-Net via dmxnet or sACN via the sacn package (`src/sampling/dmx-output.js:26-91`).
5. Every settings save re-runs `SamplingManager.updateConfig()` live (`index.js:316`); it only restarts its own taps when the channel plan actually changed (`dmx-sampling.js:120-161`).

## 2. The fixture model (what you are editing)

Stored in `settings.dmx.fixtures`; created with these defaults (`client/lib/dmx-state.js:69-99`):

```json
{
  "id": "fixture_xyz",
  "sample": { "x": 0, "y": 0, "w": 200, "h": 200 },
  "rotation": 0,
  "mirrorH": false,
  "mirrorV": false,
  "sampleMode": "average",
  "sourceChannel": 1,
  "grid": { "cols": 1, "rows": 1 },
  "colorOrder": "rgb",
  "universe": 1,
  "startChannel": 1,
  "protocol": "artnet",
  "destination": "127.0.0.1",
  "gamma": 2.2,
  "brightness": 1.0
}
```

- `sample` is in **program-channel pixels** of `sourceChannel` (canvas syncs to the live PGM resolution, `dmx-state.js:144-152`).
- `grid` splits the sample rect into cols×rows cells → one DMX color per cell, row-major.
- `colorOrder` is a free string: `rgb`, `grb`, `bgr`… map raw channels; any order containing `w`/`a` switches to white-extraction (`w = min(r,g,b)`, amber = `min(r,g)×0.5`) — e.g. `rgbw`, `rgbwa` (`src/sampling/sampling-worker.js:30-58`).
- `protocol`: `artnet` or `sacn`. sACN multicasts when `destination` is empty (`dmx-output.js:77-80`); Art-Net unicasts to `destination` or broadcasts to 255.255.255.255 (`dmx-output.js:51-57`).

## 3. UI steps (as the code has them today)

1. **Enable the engine:** `settings.dmx.enabled` + `fps` (+ `debugLogDmx`). The settings modal currently passes the `dmx` object through untouched (`client/components/settings-modal-logic.js:108`) — there is no dedicated enable checkbox in the modal yet; flip it via the settings API (`POST /api/settings` with `dmx.enabled: true`) or devtools `dmxState.setEnabled(true)`. Honest gap, see §6.
2. **Pixel Map tab:** the workspace has a `pixelmap` tab (`client/index.html:91`, activation wiring `client/app.js:124-127`). While it is active, the main **Inspector** panel hosts the fixture properties editor (`client/components/inspector-panel.js:47-52,74-79`).
3. **Fixture properties** (`client/components/fixture-inspector.js:33-71`): Name, **Universe**, **Start Ch**, **Protocol** (Art-Net / sACN dropdown), **Destination**, **Color order**, **Source channel**, **Grid cols/rows**, **Brightness**, **Rotation (°)**, **Mirror H / Mirror V** checkboxes, **Sample mode** (`Single pixel (center)` / `Region average`), **Delete fixture**. Every field saves debounced (450 ms, `dmx-state.js:22,154-170`) and the server re-applies live.
4. **Creating a fixture — current gap:** `dmxState.addFixture()` exists (`client/lib/dmx-state.js:69`) but no button in the current build calls it, and the "DMX Fixtures" template section of the mapping browser (`client/components/pixel-mapping-browser.js`) is not mounted. Today fixtures are created by writing `settings.dmx.fixtures` (settings API) or `dmxState.addFixture({...})` from the browser console; after that, all editing is first-class UI via the Inspector.
5. **Don't confuse it with the Mapping Preview overlay** (`client/components/pixel-map-editor.js`): that editor (toolbar "Mapping Preview" / "Delete Slice" / "Close Preview") belongs to Device View **pixel-mapping nodes** — video slicing onto DeckLink/GPU outputs (`src/config/pixel-mapping-config.js`) — not DMX fixtures.
6. **Live feedback:** sampled colors stream to the UI over WebSocket `dmx:colors` (`src/sampling/dmx-sampling.js:363-369`, `client/lib/app-ws-handlers.js:122`). For on-console verification enable `debugLogDmx`: once per second the app log prints `[DMX] debug: <id> artnet→<dest> u<uni>@<start>: [ch,ch,…]` (`dmx-sampling.js:341-361`).

## 4. Live re-mapping mid-show

This is the whole point: change `sample` x/y/w/h, rotation, mirror, grid, universe, even protocol — the save debounce fires, the server updates config, and DMX follows within ~a second. No Caspar restart; the tap itself only re-arms when the source-channel plan changes (different channel, denser grid), which costs a sub-second `REMOVE`/`ADD` of the sampling consumer only — program output is untouched.

Watch the app log for the pipeline's own lines:

- `[DMX] Ingress MPEG-TS UDP (Caspar STREAM + local ffmpeg) @ 25 fps — channels: 1` (`dmx-sampling.js:167-172`)
- `[DMX] Channel 1: 1920x1080 PGM @ 10% → 192x108 buffer` (`dmx-sampling.js:184-187`)
- `[DMX] Channel 1: receiving pixel data (N bytes first chunk)` (`dmx-sampling.js:233-238`)
- `[DMX] Channel 1: no pixel data after 5s (…)` — the 5-second ingress watchdog (`dmx-sampling-ingress.js:76-88`)

## 5. Inputs (the other direction)

- Art-Net **input** listener for the global border effect: **default OFF** since WO-179 (`src/artnet/artnet-slot-config.js:10-16`, `src/artnet/artnet-receiver.js:60`); enable per border slot in its inspector. Port 6454.
- **sACN input** alternative on port 5568 (`src/artnet/sacn-receiver.js`), selected by the slot's `lightingProtocol` (`artnet-slot-config.js:18-23`).

## 6. Honest limits (numbers from code)

- **Averaging stride:** `Region average` caps at ~64 samples per cell — stride = `ceil(cellDim/8)` per axis (`src/sampling/fixture-transform.js:50-55`), on a buffer that is already only 10–50 % of PGM. Fine for washes and tape; a 1-cell fixture covering the whole frame is averaging ≤64 of ~20k buffer pixels. The native `<artnet>` consumer weighs **every** pixel (see the LED-wall walkthrough) — prefer it where color fidelity is critical and the rig is fixed.
- **Rates:** default 25 fps, configurable via `settings.dmx.fps` (`dmx-sampling.js:29,145`); the extra encode→UDP→decode hop adds latency the native consumers don't have.
- **Art-Net universes 0–15 only** in this path (dmxnet clamp, `src/sampling/dmx-output.js:30`). Use sACN for higher universes.
- **No fixture-creation button yet** (§3.4) and enable/fps have no settings-modal controls yet (§3.1).
- `rotation` + `Region average` averages the rotated cell's **bounding box**, not the exact rotated polygon (`sampling-worker.js:93-126`) — slight bleed on 45° tape runs.

## 7. NOT YET — planned, don't look for it in the UI

- **[PLANNED] WO-228 hybrid sws sampling:** move averaging into a Caspar-side ffmpeg consumer (`scale=cols:rows:flags=area`) feeding this same live-editable output path — kills the stride cap and most of the CPU cost while staying restart-free. Draft in `work/work-orders/225_WO_ARTNET_INVESTIGATION.md` (WO-228 section); status per WO-233: still the recommended interim architecture, not implemented.
- **[PLANNED] WO-180 GDTF import/export:** create fixtures from vendor `.gdtf` files and export ours for consoles (`work/work-orders/180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md`). Research stage, nothing shipped.
