# Art-Net & pixel mapping — capability landscape (WO-241)

**Status:** Canonical reference (2026-07) | **Binary:** `bin/casparcg` highascg-build-v1, deployed 2026-07-15 — see [CASPARCG_BUILD_PROVENANCE.md](CASPARCG_BUILD_PROVENANCE.md)
**Walkthroughs:** [WALKTHROUGH_ARTNET_LED_WALL.md](WALKTHROUGH_ARTNET_LED_WALL.md) (native engines) · [WALKTHROUGH_PIXELMAP_FIXTURES.md](WALKTHROUGH_PIXELMAP_FIXTURES.md) (live JS pipeline)

This rig has **three independent engines** that turn live video into DMX-over-network (Art-Net / sACN). They coexist; pick per production. Everything below is read from the code actually deployed — source cites are `file:line` into the built Caspar tree (`/home/casparcg/caspar-build/src-tree/`) and this repo.

---

## The three engines

### 1. HighAsCG JS sampling pipeline — [LIVE-EDITABLE]

The WO-179 pipeline inside the Node server. Caspar streams a downscaled copy of a program channel back to Node (`ADD <ch> STREAM` MPEG-TS + local ffmpeg, or a FILE consumer on dedicated slot 97 — `src/sampling/dmx-sampling-ingress.js:17`), a worker thread samples per-fixture regions, and `src/sampling/dmx-output.js` transmits **Art-Net (npm dmxnet) or sACN (npm sacn) per fixture**. Fixtures are edited in the UI and applied **without touching Caspar's config or restarting anything** (`index.js:316` re-runs `SamplingManager.updateConfig()` on every settings save).

- Fixture model: sample rect + rotation + mirror H/V + grid cols×rows + colorOrder (rgb/grb/…/rgbw/rgbwa) + gamma + brightness + protocol + universe + start channel + destination IP (`client/lib/dmx-state.js:69-99`).
- Sampling: per grid cell, either single center pixel or region average capped at ~64 samples/cell (`src/sampling/fixture-transform.js:50-55`).
- Rates: default 25 fps, operator-configurable (`src/sampling/dmx-sampling.js:29,145`); ingress downscale 10–50 % of PGM (`dmx-sampling.js:79-82`).
- Also in this family: Art-Net **input** listener for the global border (default **OFF**, `src/artnet/artnet-slot-config.js:10-16`) and an sACN input receiver (`src/artnet/sacn-receiver.js`).

### 2. Native `<artnet>` consumer (improved-artnet, PR #1752) — [CONFIG+CASPAR-RESTART]

Compiled into the deployed binary (provenance row 1). A real Caspar `frame_consumer` attached to a channel in `casparcg.config`; registered **preconfigured-only** (`modules/artnet/artnet.cpp:36`) — there is no AMCP `ADD ... ARTNET`, so every fixture change means config edit + Caspar restart.

- Per-fixture sample **regions on the channel raster** with center/edge positioning, rotation (bilinear 4× supersampled resample, `artnet_consumer.cpp:63,371-410`), mirror-x/y, per-fixture host/port/universe.
- **True area averaging via libswscale** (`SWS_AREA`, `artnet_consumer.cpp:512-525`): each fixture group is downscaled to exactly cols×rows pixels — every source pixel contributes, no stride caps. This is the best-quality averaging on the rig.
- Fixture types DIMMER/RGB/RGBW, per-LED flux compensation, brightness, multi-universe auto-spill past 512 channels (`artnet_consumer.cpp:318-333`).
- Own send thread at `refresh-rate` Hz (default 10, `artnet_consumer.cpp:67,140-218`) — DMX rate is decoupled from video rate.
- 8-bit channels only (`artnet_consumer.cpp:745-746`).

### 3. Native `<pixel>` consumer (PR #1751) — [CONFIG+CASPAR-RESTART]

Also compiled in (provenance row 9). The opposite philosophy: **no regions, no averaging — the whole channel raster is the pixel map.** Every frame, every pixel of the video mode is converted (luma / rgb / rgbw / rgbx) and packed sequentially into consecutive Art-Net universes (`modules/pixel/consumer/pixel_consumer.cpp:83-116`, `artdmx_sink.h:76-109`). Grid resolution = channel video-mode resolution, so it is used with a small **custom video mode** matching the LED grid (e.g. 96×54). Per-channel color coefficients + gamma (`pixel_consumer.cpp:176-187`). Registered preconfigured-only as `pixel` (`modules/pixel/pixel.cpp:29-31`); Art-Net is the only protocol it accepts today (`pixel_consumer.cpp:148-150`).

---

## Comparison

| | JS pipeline (WO-179) | Native `<artnet>` (improved-artnet) | Native `<pixel>` (#1751) |
|---|---|---|---|
| **Badge** | [LIVE-EDITABLE] | [CONFIG+CASPAR-RESTART] | [CONFIG+CASPAR-RESTART] |
| **Latency path** | Caspar encode → UDP → ffmpeg decode → JS worker → dmxnet/sacn (extra encode/decode hop; runs at its own fps, default 25) | In-process: consumer holds the last frame, sends on its own thread at `refresh-rate` Hz (default 10, raise in config) | In-process, sends **every frame** at channel rate (50 fps on this rig) |
| **Live editability** | Full — fixtures, regions, rates re-apply on settings save, no Caspar restart | None — config regen/edit + Caspar restart per change | None — same, plus video-mode changes for grid changes |
| **Averaging quality** | Box average capped ~64 samples/cell (stride skips pixels on big regions), or single center pixel (`fixture-transform.js:50-55`) | **Best**: libswscale `SWS_AREA` full box filter, every pixel weighted (`artnet_consumer.cpp:518`); rotation via 4× supersampled bilinear | None needed — 1 source pixel = 1 LED (compose/scale content on the channel instead) |
| **Protocols out** | Art-Net **and sACN**, per fixture | Art-Net only | Art-Net only |
| **Universe range** | Art-Net clamped to universes **0–15** by dmxnet (`dmx-output.js:30`); sACN unrestricted | 0–32767, auto-spill across universes | 0–32767, sequential spill |
| **Fixture types** | Any colorOrder string incl. amber (rgbwa) | DIMMER / RGB / RGBW (+`fixture-channels` padding) | luma / rgb / rgbw / rgbx |
| **Config surface** | UI (Pixel Map tab + Inspector), persisted in `settings.dmx` | `<artnet>` block in a channel's `<consumers>` — full schema in the LED-wall walkthrough | `<pixel>` block + custom video mode |
| **Restart coupling** | None | Caspar restart (Device View → Apply Caspar config) | Caspar restart |
| **CPU cost** | Highest (ffmpeg decode + JS loops per frame) | Low (SIMD libswscale, one small scale per fixture group) | Lowest per pixel, but sends W×H×bytes channels per frame — keep the grid small |
| **Monitoring** | `[DMX]` lines in app log, live color preview over WS (`dmx-sampling.js:363-369`) | OSC/monitor state `artnet/…` + log warnings (`artnet_consumer.cpp:242-254,453-505`) | Log errors on send failure only (`pixel_consumer.cpp:104-112`) |

**Rule of thumb:** mapping edited during the show → JS pipeline. Fixed rig, best color fidelity / lowest CPU → native `<artnet>`. Raw LED processor or wall that wants a full raster → native `<pixel>`.

---

## What can we produce with this

Concrete production ideas, each pointing at the right engine.

1. **LED wall behind the stage, fed by a dedicated Caspar channel** — add a channel that carries wall content (loops, generative looks, a routed PGM copy), attach a native `<artnet>` consumer with one `fixture-count="WxH"` group per panel section. Area-averaged, restart-once, then rock solid all show. → [WALKTHROUGH_ARTNET_LED_WALL.md](WALKTHROUGH_ARTNET_LED_WALL.md).
2. **Pixel-tape stage outlines sampled from PGM edges** — thin fixtures (e.g. 128×1) whose sample regions hug the top/side edges of the program frame, so the tape "continues" the picture beyond the screen. Live-editable placement matters here (you re-aim regions after the set changes) → JS pipeline, `sampleMode: 'average'`. → [WALKTHROUGH_PIXELMAP_FIXTURES.md](WALKTHROUGH_PIXELMAP_FIXTURES.md).
3. **Matrix / blinder walls driven by a looks layer** — play stingers/looks on a dedicated layer of a small channel and let the native `<artnet>` consumer's DIMMER type drive blinder cells (luma-weighted 0.279/0.547/0.106, `artnet_consumer.cpp:429`); RGBW matrix cells get proper white extraction (`min(r,g,b)`, `artnet_consumer.cpp:436-443`).
4. **House-light color washes via sACN from PGM's dominant colors** — one or two big-region fixtures averaging the whole frame (or its left/right halves), protocol `sacn`, pointed at the house console's input universes. Only the JS pipeline speaks sACN, and it multicasts natively (`dmx-output.js:72-91`).
5. **Floor grids / dance-floor pixels** — mid-size grid (e.g. 24×16): either engine. Choose native `<artnet>` when the floor is rigged once per venue; choose JS when the floor mapping is re-blocked between acts.
6. **Low-res audience surfaces (wristband-style / seat pixels)** — hundreds of coarse cells fed the mood of the show: `<pixel>` consumer on a tiny custom video mode (the raster IS the seat map), content authored as ordinary Caspar media on that channel. Sequential universe packing does the addressing for you.
7. **External pixel processors (Madrix-style, Resolume, ArtNet-in media servers)** — hand them a clean raster: `<pixel>` consumer, type `rgb`, one universe boundary every 170 pixels; the processor re-maps downstream.

---

## Current limits & planned work

- **[PLANNED] WO-228 hybrid sws sampling** — replace the JS worker's stride-capped averaging with a Caspar-side ffmpeg `scale=cols:rows:flags=area` consumer feeding the existing live-editable output path (drafted in `work/work-orders/225_WO_ARTNET_INVESTIGATION.md`). Not implemented; today the UDP ingress already downscales with `flags=area` (`dmx-sampling-ingress.js:152`) but the per-cell average is still JS-side.
- **[PLANNED] WO-180 GDTF fixture import/export** — industry fixture exchange (`.gdtf`) into/out of the pixel-map fixture model. Research-stage only (`work/work-orders/180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md`).
- The **config generator emits no `<artnet>`/`<pixel>` blocks** (nothing in `src/config/` references them; only the JS listener defaults in `src/config/defaults-core.js:125-130`). Native-consumer blocks are manual config edits and are **lost on the next Device View regen** — re-add after every "Apply Caspar config". Generator support was drafted as WO-230 (retarget note in WO-233).
- JS Art-Net output is clamped to universes 0–15 (`dmx-output.js:30`); use sACN or the native consumers above that.
- All three engines are 8-bit (`artnet_consumer.cpp:745`, `pixel_consumer.cpp:140`).
