# WO-916 — Pixel map: always on, cheap sampling, its own output to the lighting console

**Area:** mapping, lighting
**Status: DONE (31.10.26 — 25 Hz grid sampling ~5.6 % of a core on the box, console Art-Net/sACN e2e 0 mismatches, GUI e2e 10/10)**

Owner, 31.10.26:
> The sampling takes too much power and it can't only work when I look. When the mapping is configured it should output
> all the time to the lighting console, then it's up to LD to send it out to fixtures or not. What could be a less taxing
> option for the sampling?

Answers to the follow-up questions (31.10.26): no console yet; unicast is fine in real life; Art-Net and sACN as a choice;
universes as a choice — the fixtures' own (13–18) or a separate block for the console to merge in; pixel colour only (the
LD keeps dimmer / white); "do recommended sampling fixes" (a point grid per cell, a fixed output rate).

Follows [WO-915](915_WO_pixeline_edges_follow_the_dioda_bus.md) (which gated the sampling on "a mapped head on the wire or
someone looking" and capped the looking-only case at 10 Hz) and [WO-897](897_WO_pixel_map_tick_matches_channel_rate.md)
(every Caspar frame sampled once).

## Investigation (31.10, Opus)

**Cost today.** `src/fixtures/pixel-map-frame.js` averages every pixel of a region (exact up to 4 × 65 536 px per
region, `:16`, `:24-38`). The live map is 896 cells of 40 × 16 px on pgm1 (3840 × 1792) = 573 440 pixels summed in JS per
frame, 3 577 preads (rows × merged spans, `MERGE_GAP_PX` 1024). Measured on the box against the live pgm1 segment
(scratchpad `bench_pm.js`, the real 896 rects, 60 reads each):

| sampling per cell | ms / frame | reads | 48 fps (today) | 25 fps |
|---|---|---|---|---|
| every pixel (today) | 6.42 | 3 577 | ~31 % of a core | ~16 % |
| 4 × 2 point grid (as 7 168 1-px regions) | 1.24 | 1 008 | ~6 % | ~3 % |
| centre pixel | 0.36 | 504 | ~2 % | ~1 % |

Most of the cost is the rows: a 16-px-high cell reads 16 rows; a 2-row grid reads 2. The arithmetic per sample is the
smaller part. The grid measurement was done through 7 168 separate point regions (plan overhead included), so a real grid
inside one region is at most that.

**When it runs.** `pixel-map-service.js:84-88` `wanted()` = a mapped head on the wire (DMX master on + universe listed)
or a `/live` / previs reader in the last 5 s; else the tick idles. With only a reader, `WATCH_SAMPLE_MS` 100 (`:229`).
With the DMX master off and nobody looking (the shop today) nothing is sampled — the owner's "it can't only work when I
look". With a head on the wire every Caspar frame is sampled (WO-897 watcher, `:143-160`, kicks the engine per frame).

**Where it goes.** Only into the follow engine's fixture universes (`write()` → `follow-engine.js:301`), sent under the
DMX master (`fixtures.dmx.enabled` + universes list), the visualiser rule, the self-loop guard and the lighting duty
(`follow-engine.js:172-177`, `follow-service.js:119-122`). There is no output for a console: the box can only drive the
heads itself, and the bytes it sends carry the whole head (GDTF defaults / programmer / `fixed`), not just the colour.

## Plan

1. **Sampling = a point grid per cell.** `average` takes one sample at the centre of each ~10 × 10 px sub-cell, at most
   16 × 16 per region (40 × 16 → 4 × 2 = 8 samples, 2 rows). `point` unchanged.
2. **A fixed rate** (`pixelMapSettings.rate_hz`, default 25, 0 = every Caspar frame): the frame watcher marks a new frame
   due only when the last due one is ≥ ¾ of the period old (50 fps → every 2nd frame, steady, no judder); only due frames
   are read.
3. **Always on**: no idle state, no watch — while there are enabled mappings, every due frame is sampled, the previs and
   the box's own fixture output (when its master is on) keep showing / sending it.
4. **Console output** (`pixelMapSettings.console`: `enabled`, `protocol` artnet | sacn, `dest` a.b.c.d[:port], `layout`
   fixture | block, `universe` = the block's first universe): pixel colour only, sent after every sample when it changed
   (1 s refresh), independent of the DMX master; through the same socket, lighting duty and self-loop guard.
   - `fixture`: the fixtures' own universes and slots, colour channels only (everything else 0).
   - `block`: 3 slots (R G B) per mapping, 170 per universe from `universe` on, ordered by fixture (universe, address)
     then pixel; `/live` lists each mapping's console universe + slots for the LD's patch.
   - Art-Net needs an address (no broadcast: it lands on this box's own lighting input); sACN without one = multicast.
5. Godot pixel-map window: a "Console" row (send, protocol, address, universes, first universe, rate).
6. Live project: remove the WO-915 `fixed` dimmer-open / white-0 on the 56 PixelLines (the LD owns dimmer and white).

## What was done (31.10, Opus)

- **`src/fixtures/pixel-map-frame.js`** — `average` is a point grid now: one sample at the centre of each ~`GRID_PX` 10 px
  sub-cell, at most `GRID_MAX` 16 per axis (`samplingOf` → `{ xs, ys }`; 40 × 16 → x +5/15/25/35, y +4/12). Rows read
  per cell drop from 16 to 2; the plan still merges spans per row. `point` = the centre pixel as before. Chosen over a
  smaller every-pixel region or a GPU downscale: no Caspar change, no extra consumer, and an LED cell is one colour field.
- **`src/fixtures/pixel-map-settings.js`** (new) — `pixelMapSettings` = `{ smooth (WO-893), rate_hz, console }`; a POST
  names any of them, the others keep their value; all-default drops the key.
- **`src/fixtures/pixel-map-service.js`** — the WO-915 watch / idle gating is gone (`watch()`, `WATCH_MS`,
  `WATCH_SAMPLE_MS`, `idleTicks`, `wanted`): while there are enabled mappings every due frame is sampled. The frame
  watcher kicks the engine only for due frames (`t − dueAt ≥ 750 / rate_hz`, ¾ of the period, so 50 fps → every 2nd
  frame, steady); `sample()` reads only due surfaces (a surface with no due frame for `HOLD_MS` is read anyway, so
  missing / stale still updates). `rate_hz` 0 = every tick (the WO-897 behaviour; the loopback / bus smokes use it).
  Stats gain `skipped` (frames left out by the rate) next to `missed`. After every sample (or the 1 s refresh) the
  smoothed colours go to the console output; `/live` reports `rate_hz`, `console` (status per universe) and each
  mapping's console place.
- **`src/fixtures/pixel-map-console.js`** (new) — the console output: Art-Net or sACN, unicast to `dest`
  (Art-Net without an address sends nothing — a broadcast would land on this box's own lighting input; sACN without one
  = multicast), layout `fixture` (the heads' own universes + colour slots via `writePixel`, everything else 0) or
  `block` (R G B per mapping, 170 per universe from `universe`, ordered by fixture universe / address / id, then pixel).
  Only the colour, independent of the DMX master; a packet per universe when its bytes changed, else a 1 s refresh;
  its own sACN CID / source name "HighAsCG pixel map".
- **`src/fixtures/follow-service.js`** — the engine's send wrapper (lighting duty) and `isSelfLoop` are shared with the
  pixel map service, so the console output obeys the same duty and self-loop guard; `visual()` no longer calls
  `pixelMap.watch()`.
- **Godot `pixel_map_console.gd`** (new) + **`pixel_map_window.gd`** — a "Console" block under the smoothing rows: Send,
  Art-Net / sACN, the console address, "Fixture universes" / "Own block", "From universe" (block only), "Rate Hz", and a
  status line from `/live` ("→ 10.0.0.5:6454 · 6 universe(s) · … packets" or why nothing goes out). Saved with the
  smoothing in one POST.
- **Live project mhp_harder** — the 56 PixelLines' WO-915 `fixed` values (dimmer open, white 0) removed via
  `POST /api/project/autosave` (rev 578; backup `~/.highascg/backup/wo916-*`). The LD owns dimmer and white; the previs
  bars are dark until the console (or this box's programmer) opens the dimmer — the editor swatches and the console
  output carry the colours.
- Console defaults: enabled, Art-Net, fixture universes, **no address** → nothing goes out until the owner types the
  console's IP.

## Verified (31.10)

- **Cost on the box** (896 cells on pgm1 3840 × 1792, ch2 ≈ 48 fps): 24.4–24.6 samples / s at 2.27 ms per sample
  (grid + console frame) ≈ 5.6 % of a core, was ~31 % (6.42 ms × 48). `missed` ~1.4 / s from event-loop stalls (frames the
  watcher saw too late), `skipped` ≈ `frames` as designed.
- **Always on**: DMX master off, nobody on `/live` or the previs → still sampling at 25 Hz and sending to the console.
- **e2e against the real shm frame** (scratchpad `e2e_console.py`: an independent 4 × 2-grid mean of the shm frame vs
  `/live` vs the console packet bytes, sent to 127.0.0.1:6455 / 5568): artnet + fixture — 896 mappings, 0 mismatches, 0
  stray bytes, universes 13–20; sacn + block 101 — universes 101–106, 0 mismatches, source "HighAsCG pixel map"; artnet +
  block 40 — universes 40–45, 0 mismatches.
- **Rate** (`e2e_rate.py`, an opacity fade): 24.3 packets / s per universe, gap median 42 ms, max 64 ms.
- **Offline**: new `smoke-wo916-pixel-map-console.test.js` (13 tests: settings, both layouts, the 170 wrap, refresh,
  sACN multicast / unicast, no address, self-loop skip, console off still samples, a real UDP round trip on
  127.0.0.1:6455, wiring pins); the WO-807 / 893 / 897 / 915 pixel-map smokes updated (grid, always on, 25 Hz test:
  missed 0, frames 24–26 of 48–50). Godot suite 25 581 passed, 0 failed (console model + window rows).
- **GUI e2e** `07_pixel_map` (sandbox, real window): 10 passed — new step types 127.0.0.1:6455, picks "Own block", from
  universe 300, Save → `/settings` stores it, ArtDMX u300 slots 1–6 = [128, 64, 100, 255, 255, 0] (pixel 1 average,
  pixel 2 point), status "→ 127.0.0.1:6455 · 1 universe(s)".
- Not proven: a real console (none in the shop yet) — the LD's merge / patch is owner-side.
