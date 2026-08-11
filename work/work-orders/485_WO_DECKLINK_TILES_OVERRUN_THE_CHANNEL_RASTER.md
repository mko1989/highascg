# WO-485/486 — DeckLink subregions were cut from the SDI mode, not the channel raster

**Status: DEPRECATED (11.08.2026 — the diagnosis was WRONG and the change is reverted; see §4.
The operator-GUI half survives as WO-486. Successor lead: WO-487, the forced YUV pixel format.)**

## 1. Investigation

Owner 11.08, after several rounds: *"when not outputting to decklink the speed of playback is
normal. but thats not a solution. caspar most certainly can play both to screen consumer and to
decklink outputs with normal speed, even when the channel is custom resolution (thats what the
subregions are for) … right now its playing at around 80% not half. when i added decklink inputs on
top of it on ports 3 and 4 it dropped to 50% speed."*

Every part of that is right, including the mechanism. The subregions were present — I had wrongly
reported them missing after grepping the generated XML with a filter that hid them; dumping the
`<decklink>` block verbatim showed them. They were simply **wrong**:

```
channel raster : 6144 x 1536
device 1       : src-x 0     3840 x 2160
device 2       : src-x 3840  3840 x 2160
```

Device 2's region ends at x=7680 on a 6144-wide canvas (**1536px past the edge**) and both regions
are 2160 tall on a 1536-tall canvas (**624px past the bottom**). Caspar fetches an out-of-bounds
region per card per frame.

**Why that slows playback rather than just looking wrong.** The DeckLink consumer is the one that
carries the channel's synchronization clock — verified in the source the binary was built from:

```cpp
decklink_consumer.cpp:1266   bool has_synchronization_clock() const override { return true; }
screen_consumer.cpp:1020     bool has_synchronization_clock() const override { return false; }
```

So PGM1 ticks at whatever the cards can sustain, while PGM2 (screen consumer only) free-runs. That
predicts exactly the three observations: **~80%** (a throughput deficit, not a halved clock — a
halved clock is always exactly 50%), **~50%** once two DeckLink inputs competed for the same
hardware, and **realtime** with the DeckLink consumer removed.

**Cause** — `pixel-mapping-config.js`, tile sizing for outputs with no authored mapping rect:

```js
const { width: specW, height: specH } = resolveOutputPixelSize(outDef)  // the SDI MODE: 3840x2160
const tileW = slice?.rect?.w ?? specW
const tileSrcX = hasRect ? Number(slice.rect.x) : decklinkPackX
if (!hasRect) decklinkPackX += tileW                                     // packs 0, then 3840
```

The tile was sized from the **output's mode** and packed by that width, with nothing tying it to the
canvas it is cut from.

## 2. What was done

- Rect-less tiles now split the **channel raster** evenly across the DeckLink-cabled outputs
  (`programRasterFor()` + an even horizontal pack), so the box's rig yields
  `device 1: 0,0 3072x1536` and `device 2: 3072,0 3072x1536`.
- **Every** tile is clamped to the raster, authored rects included — a rect saved before a
  destination was resized is as wrong as an overflowing default. A tile that starts off-canvas is
  dropped rather than emitted at zero size.

**WO-486, same message:** *"the operator gui somehow defaults to custom and 1920x1080 which is
wrong. it should just be 1080p50 (or 60) or any other mode chosen from the dropdown."* WO-243 made
`pixelmap` and `operator_gui` both custom-by-default. That is right for a pixelmap wall, whose
raster comes from its fixtures, and wrong for an operator GUI, which is an ordinary monitor.
`operator_gui` now defaults to `1080p5000`, and an explicit `custom` whose dimensions ARE a shipped
mode resolves to it — but only when dimensions were actually supplied, since a bare
`normalizeDestination({mode})` means "size unknown", not "1920x1080". An ultrawide operator monitor
(2560x1080) still lands on custom, correctly.

## 3. What was verified

- `tools/smoke/smoke-decklink-tile-subregion-raster.test.js` (curated list) — 5/5, built on the
  box's exact rig: 6144x1536 + two 2160p50 cards → 3072x1536 tiles at x=0 and x=3072; no tile may
  leave the raster; an authored rect is honoured but clamped (5000+2048 → 5000+1144); one card
  takes the whole raster; a 1080p5000 channel splits into two 960x1080 tiles.
- `smoke-wo243-operator-gui` repointed to the new default with a new case pinning that an ultrawide
  stays custom and an explicit-custom-1920x1080 resolves to `1080p5000`. The pixelmap contract is
  untouched — its test still passes unchanged.
- Suite **1977 tests, 1975 pass, 0 fail, 2 skip**; eslint clean.

**Not verified live:** not deployed to .28, and PGM1 was idle every time I sampled it over AMCP, so
the speed itself is still unmeasured by me. Owner QA: re-apply the Caspar config (the subregions
change only on Apply), then play the timer clip on PGM1. Expected `<subregion>` per card afterwards:
`0,0 3072x1536` and `3072,0 3072x1536`.

**Still open on this thread:** whether 2160p5000 is even the right per-card mode once each card is
fed a 3072x1536 region — a mode nearer the region size would avoid the conversion the log reports
(`Device supports video-format with conversion: 1080p50`). That is a rig decision, not a code one.


## 4. Why this was wrong — reverted

Owner: *"decklink sdi can only use standard video modes. thats a standard way of mapping to have
larger sdi output and just put the actual video frames where they appear, leaving the rest blank.
the blank parts are moot … search the repo for a doc with correct decklink subregions config."*

That doc is `config/casparcg copy.config`, a rig the owner built and tested. It settles it:

```
channel raster 5120x1024, four cards @ 1080p5000
  region src-x    0  w 1920  -> ends 1920
  region src-x 1920  w 1920  -> ends 3840
  region src-x 3840  w 1920  -> ends 5760   <-- 640px PAST the 5120 raster
```

**The proven config overruns the raster too, and runs at full speed.** The pattern is deliberate:
each region is the size of the card's standard SDI frame, packed by that width; the video lands
where it lands and the remainder of the frame is blank. `.28` follows exactly the same pattern
(3840-wide regions from a 6144 canvas at 2160p50) — it is not malformed.

So the overrun is not the fault, and WO-485's change was worse than useless: sizing tiles from the
raster would have fed non-standard dimensions into `resolveDecklinkTileVideoMode`, and a DeckLink
SDI output can only take a **standard** mode. Reverted in full (`pixel-mapping-config.js` restored,
smoke deleted).

**What I should have done:** read the reference config first. The owner said from the start that
this class of setup was built and tested; the repo held the proof, and I reasoned from arithmetic
instead of looking. The geometry "looked wrong" only because I had no baseline for what right
looks like.

**Surviving from this WO:** the operator-GUI default (now WO-486) — unrelated to the DeckLink path
and still correct.
