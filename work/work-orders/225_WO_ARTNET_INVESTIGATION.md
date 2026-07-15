# WO-225 — Art-Net pixel-mapping redesign: full investigation → multiple follow-up WOs

**Status:** Investigation | **Date:** 2026-07-15
**Source:** owner: "we need to redo the artnet pixel mapping workflow. first of all it looks like casparcg has native artnet consumer. second of all there is something baked in that can do pixel averaging (sws_scale). third there is a improved artnet consumer, that we could build into the extended version of caspar we are using." + "yes artnet needs a full investigation with multiple work orders."

## Scope (investigation only — output = evidence + a numbered set of draft WOs 226a/b/c… appended here)
1. **Current state:** map the existing WO-179 pipeline (src/ lighting/artnet/sacn/pixel sampling code, where frames are sampled, region averaging, output rates) — files, data flow, measured cost.
2. **Native consumer:** does the SHIPPED binary (/home/casparcg/highascg/bin/casparcg — the owner's extended build) expose an artnet consumer? Probe: `strings bin/casparcg | grep -iE "artnet|art-net"` , `bin/casparcg --help` if safe (DO NOT start a second server instance — check flags only if it exits immediately; otherwise rely on strings + docs), config generator support (src/config/config-generator*.js grep artnet), CasparCG 2.4/2.5 docs in the repo/wiki (docs/, highascg-wiki-map).
3. **sws_scale averaging:** identify what "baked in" averaging exists (ffmpeg consumer scaling? the compose FILE consumer? sws flags in config?) and whether a downscaled dedicated consumer could replace JS-side region sampling (e.g. 1 px per fixture region via a tiny ffmpeg consumer output).
4. **Improved artnet consumer:** the owner believes an improved consumer exists that could be built into the extended Caspar. Search local caspar source if present (find / -name "*.cpp" artnet under any caspar src dir; check /home/casparcg for build trees), the wiki, and repo notes. Document what "building it in" would require (source tree, build toolchain present on this box? cmake? — check).
## Deliverable
Append to THIS file: findings with evidence per question, a recommended architecture (JS-sampling vs native consumer vs hybrid), and 2-4 draft follow-up WOs with tasks/risks. NO code changes, NO caspar restarts, NO second caspar instances.

---

## Investigation findings (2026-07-15)

Read-only investigation. No caspar restarts, no second instance, no code changes. All commands below are non-destructive (`strings`, `ldd`, `file`, `grep`, `find`).

### Q1 — Current WO-179 JS pipeline: files, data flow, rates

**Files (confirmed via `grep -rilE "artnet|sacn|pixel" src/ client/`):**
- Ingress/orchestration: `src/sampling/dmx-sampling.js` (375 lines), `src/sampling/dmx-sampling-ingress.js`
- Worker: `src/sampling/sampling-worker.js` (172 lines), `src/sampling/fixture-transform.js` (81 lines, added in WO-179)
- Output: `src/sampling/dmx-output.js` (105 lines) — wraps npm `dmxnet` (Art-Net) and npm `sacn` (sACN)
- Input (global border): `src/artnet/artnet-receiver.js`, `src/artnet/sacn-receiver.js`, `src/artnet/artnet-udp.js`, `src/artnet/artnet-packet.js`, `src/artnet/artnet-slot-config.js`
- Client UI: `client/components/fixture-inspector.js`, `client/components/pixel-map-editor-canvas.js`, `client/components/inspector-global-border-artnet.js`

**Data flow (`dmx-sampling.js` + `sampling-worker.js`):**
1. `SamplingManager._planChannels()` (dmx-sampling.js:60-86) computes a per-program-channel downscale `targetScale` from fixture grid density: `max(rows/fullH, cols/fullW) * 2.0` safety margin, clamped to **10%-50%** of source resolution.
2. Ingress is one of two modes (`_useUdpIngress()` in dmx-sampling-ingress.js):
   - **UDP**: Caspar `ADD <ch> STREAM udp://…` (MPEG-TS) → a locally spawned `ffmpeg` process decodes to raw RGB (`-fflags nobuffer -flags low_delay`). This is the default/reliable path.
   - **FILE**: Caspar `ADD <ch> FILE` → named FIFO, raw RGB read directly (dedicated consumer slot index 97, `DMX_FILE_CONSUMER_INDEX`).
3. Frame rate: `this.fps = this.config.fps || 25` (dmx-sampling.js:29,145) — **25fps default**, operator-configurable.
4. Each scaled frame is handed to a `worker_threads` Worker (`sampling-worker.js`). Per fixture, per grid cell:
   - `sampleMode: 'center'` (legacy default) — one pixel at the cell center, after mirror/rotation transform.
   - `sampleMode: 'average'` (new default, WO-179 T179.3) — `averageRegion()` (fixture-transform.js:41-76) computes the cell's rotated/mirrored bounding box and averages pixels inside it, **capped at ~64 samples/cell via stride** (`targetSamples = sqrt(64)`, strideX/Y = `ceil(cellDim/8)`) — this is a manual, CPU-bound, uncapped-per-frame box average done entirely in JS, independent per fixture/cell (no shared downscale reuse across fixtures beyond the one shared channel scale).
   - Then brightness → gamma (256-entry LUT) → `extractColors()` reorders into the fixture's `colorOrder` (rgb/grb/rgbw/rgbwa/amber).
5. Output: `DmxOutput.send()` (dmx-output.js) routes per-fixture to either a cached `dmxnet` Art-Net sender or a cached `sacn.Sender`, keyed by `universe:destination`.

**Measured/observed cost:** No live measurement was taken (no caspar execution permitted). Qualitative cost profile from code: JS-side cost scales with `Σ(fixtures × cells × min(64, cellPixels))` every frame at up to 25fps, entirely on Node's worker thread; ingress cost is a full ffmpeg decode (UDP mode) or FIFO read (FILE mode) of a 10-50%-scaled frame per program channel. `PERFORMANCE_RUN_CHECK_BULLETIN.md` §H lists this as an **open, not-yet-executed** perf work package (PERF-H1/H2/H3 — "SamplingManager poll interval vs hardware", "Art-Net universe size and buffer reuse" — unstarted, no timing data recorded anywhere in the repo).

**Prior conclusion in WO-179 itself:** "Stock CasparCG Art-Net: none" — confirmed independently below with more precision: stock upstream has none, but the **shipped extended binary does**.

### Q2 — Native Art-Net consumer in the shipped binary

**This is the headline finding: the shipped `bin/casparcg` (9.1MB ELF, not stripped, BuildID `c119f765…`) already contains a real, compiled-in native Art-Net consumer module.** `strings bin/casparcg | grep -iE "artnet"` returns 64 matches including full C++ mangled symbols and one literal source path repeated across all of them:

```
/home/serwer/CasparCG_Enhanced/src/modules/artnet/consumer/artnet_consumer.cpp
```

Demangled symbols show a complete CasparCG module, structured exactly like the stock `ffmpeg`/`decklink`/`oal` consumer modules:
- `caspar::artnet::artnet_consumer` — class implementing `initialize()`, `send()`, `send_dmx_data(const uint8_t*, size_t)`, `name()`, `index()`, `print()`, `state()` — this is CasparCG's standard `core::frame_consumer` interface.
- `caspar::artnet::init(const core::module_dependencies&)` — the module registration hook (same pattern as every other built-in module).
- `caspar::artnet::create_preconfigured_consumer(const boost::property_tree::wptree&, …)` — **config-file-only** factory (takes the parsed `casparcg.config` XML subtree).
- `caspar::artnet::get_fixtures_ptree(const boost::property_tree::wptree&)` → `std::vector<caspar::artnet::fixture>` — parses a `<fixtures>` block from XML into fixture objects.
- `caspar::artnet::average_color(const core::const_frame&, rect&)` and `caspar::artnet::compute_rect(box, int, int)` — **native, in-process region-averaging of the live frame**, i.e. exactly the "region average per fixture" logic that WO-179 T179.3 reimplemented by hand in JS.
- `caspar::artnet::computed_fixture` (separate type from `fixture`, backed by `fixture_calculation.cpp`) — suggests a second, computed/derived fixture mechanism (e.g. grid auto-generation) beyond manually placed fixtures.
- Config key strings present verbatim in the binary: `artnet/host`, `artnet/port`, `artnet/refresh-rate`, `artnet/universe`, `artnet/fixtures`, `artnet/computed-fixtures` — this is the boost `property_tree` path syntax CasparCG uses for XML config, meaning the consumer is driven by a `<artnet>` block nested in a channel's `<consumers>` in `casparcg.config`.
- Error string confirms it's live code, not dead/stripped: `"Artnet consumer only supports 8-bit color depth."`

**Important limitation found:** unlike `ffmpeg`/`decklink` (which expose both `create_consumer` for dynamic `ADD <ch> CONSUMER …` AMCP calls *and* `create_preconfigured_consumer` for config-file startup), `artnet` **only has `create_preconfigured_consumer`** (`strings bin/casparcg | grep -oE "caspar6artnet.*create_consumer"` returns nothing for a bare `create_consumer`, and no `"ARTNET"` AMCP keyword string exists in the binary). **This means the native consumer can only be enabled by editing `config/casparcg.config` XML and restarting casparcg — it cannot be added/removed live via AMCP `ADD`/`REMOVE`.** That is a materially different operating model than the current JS pipeline, which reconfigures live via `SamplingManager.updateConfig()` with no caspar restart.

**Config generator (`src/config/`):** `grep -rilE "artnet" src/config/` matches only `src/config/defaults-core.js`, which defines JS-side `artnetInputEnabled`, `artnetInputPort` (6454), etc. — these are the WO-179 *global-border-input* receiver's defaults, unrelated to the native consumer. **The config generator (`config-generator*.js`) currently has zero awareness of the native `<artnet>` consumer block** — it never emits one into `casparcg.config`.

**Docs/wiki:** `docs/reference/` has no artnet file. The stock CasparCG wiki mirror (`/home/casparcg/bridge/casparcg/highascg/.reference/casparcg-wiki/Server/Consumers/`) lists only `Bluefish-Consumer.md`, `Decklink-Consumer.md`, `Image-Consumer.md`, `NDI-Consumer.md`, `Screen-Consumer.md`, `Consumers.md` — **no Artnet-Consumer.md, confirming stock/upstream CasparCG (and its wiki) has no Art-Net consumer; this is exclusive to the "CasparCG_Enhanced" fork the owner is running.** `/home/casparcg/highascg-wiki-map` (the project's own interactive map data) has no artnet-consumer-specific content either — only the JS-side `src/artnet/` module is indexed there.

### Q3 — sws_scale / ffmpeg-based averaging

Confirmed via `ldd bin/casparcg`: the binary links `libswscale.so.7` directly, and `strings bin/casparcg | grep sws` shows real (non-stripped) imports: `sws_getContext`, `sws_scale`, `sws_freeContext` — all resolved against `LIBSWSCALE_7`. This is used internally by CasparCG's own `ffmpeg` consumer/producer chain for all scaling/format conversion, including the existing FILE/STREAM consumers this project already drives.

**Prior art already in this codebase** (`src/preview/compose-preview-consumer.js`, `src/preview/compose-preview-ffmpeg-jpeg.js`, `src/streaming/caspar-ffmpeg-setup.js`): the compose-preview feature already runs a dedicated small `ADD <ch> FILE` ffmpeg consumer (slot index `701`) that downscales the live channel via an ffmpeg `scale=` video filter — e.g. `caspar-ffmpeg-setup.js:98-99` hardcodes `SCALE_HALF_VF = 'scale=w=iw/2:h=ih/2'` and `:110` builds `scale=${resMap[config.resolution]},format=yuv420p,fps=${fps}` — before JPEG-encoding to a poll-able file. This is a proven, already-working pattern in this repo for "attach a tiny dedicated consumer to a channel that downscales via ffmpeg's `scale` filter (libswscale) and hands you a small buffer/file," and it runs at a configurable low fps (`cp.fps ?? 2`) separate from program fps — i.e. cheap.

**What a downscaled-ffmpeg pixel-averaging consumer would look like:** an `ADD <ch> FILE`/`STREAM` (or a new dedicated slot, mirroring `DMX_FILE_CONSUMER_INDEX`/`COMPOSE_FILE_CONSUMER_INDEX`) with an ffmpeg `scale=<gridCols>:<gridRows>:flags=area` filter targeting one pixel per fixture grid cell directly — `flags=area` specifically requests libswscale's area-averaging algorithm (true box filter), which is the mathematically correct operation for "average all source pixels feeding one LED," as opposed to the default bicubic/bilinear scaling ffmpeg otherwise uses. This would let libswscale (in a native, presumably SIMD-optimized C library already linked into the binary) do the averaging that `sampling-worker.js`'s `averageRegion()` currently does by hand in JS with a manual 64-sample stride cap — likely both cheaper and more accurate (no stride-induced sampling gaps) than the current JS implementation, **without needing the native artnet_consumer at all** — it's a pure downscale target read back into the existing Node ingress path.

### Q4 — Local source tree / build toolchain for the native consumer

- `find /home/casparcg -maxdepth 5 -iname "*caspar*" -type d` and a filesystem-wide `find / -xdev -iname "artnet_consumer*"` / `-iname "CasparCG_Enhanced"` found **no local copy of the CasparCG_Enhanced source tree** anywhere on this box. The only "caspar" source-looking directories present are this project's own `src/caspar/` (HighAsCG's AMCP client wrapper, JS) and vendored wiki/client references — nothing that resembles the actual CasparCG C++ server source.
- The embedded build path `/home/serwer/CasparCG_Enhanced/…` indicates the binary was built on a **different machine** (user `serwer`, presumably the vendor/enhancer's build box), not on this live broadcast box. This binary was shipped pre-built; "building it in" is not a local recompile of an existing tree — there is no tree here to modify.
- Build toolchain on this box: `g++`/`gcc` 13.3.0 and `make` are present, but **`cmake` is not installed** (`which cmake` → not found). CasparCG upstream and forks build via CMake, so at minimum `cmake` (and almost certainly a large set of `-dev` headers: boost 1.83, the exact ffmpeg 6.0/7.x dev headers matching the linked `.so` versions, SFML 2.6 dev, TBB dev, CEF headers/binaries, and possibly the Decklink SDK for the decklink module) would need to be installed before any local build could even be attempted — and only once the actual `CasparCG_Enhanced` source is obtained from wherever `serwer`'s build environment lives.
- **Conclusion: "building an improved consumer into the extended Caspar" cannot happen on this box today.** The realistic near-term work is (a) exercising the *already-compiled-in* native artnet consumer via config (Q2/WO-228 below), which requires no rebuild at all, and (b) separately obtaining the `CasparCG_Enhanced` source (from the vendor/owner) if genuinely new C++ changes are wanted later — that is a distinct, much larger undertaking (toolchain provisioning + full CasparCG build, likely 1-3+ hours minimum) that should not be scoped as a haiku-sized task.

---

## Recommended architecture

Three options were evaluated:

1. **JS sampling (status quo, WO-179):** Fully live-reconfigurable (no caspar restart), already shipped and working, but does a manual, stride-capped, single-threaded-per-worker region average in JS at up to 25fps per program channel — the most CPU-expensive and least accurate of the three options, with zero measured perf data yet (PERF-H1/H2/H3 still open).
2. **Native `artnet_consumer` (config-only):** Would eliminate the JS worker and JS Art-Net/sACN send path entirely by pushing per-fixture region averaging (`average_color`/`compute_rect`) and Art-Net transmission into the C++ core, likely far cheaper and running on Caspar's own render thread cadence rather than a decoded-and-rescaled copy. **But it is preconfigured-only** — every fixture/mapping change from the operator UI would require rewriting `casparcg.config`'s `<artnet>` block and a full caspar restart, which glitches live PGM output. This is a poor fit for a box where fixture mapping is edited live during a show (current JS pipeline's main strength). It also has no config generator support today and its exact XML schema is not yet confirmed (only the ptree key names are known from binary strings — the nesting, attribute types, and value formats need to be reverse-engineered, ideally against upstream CasparCG_Enhanced release notes/docs if the owner can obtain them, since this repo's docs/wiki mirrors are silent on it).
3. **Hybrid — downscaled-ffmpeg averaging feeding the existing JS output path:** Keep the JS-side live-reconfigurable Art-Net/sACN *output* (dmxnet/sacn senders, protocol dispatch, brightness/gamma/colorOrder — all fine as-is), but replace the *sampling* half with a dedicated small ffmpeg consumer (mirroring the proven `compose-preview-consumer.js` pattern) that uses `scale=…:flags=area` to let libswscale do true box-averaging server-side, handing back a tiny buffer (ideally exactly `gridCols × gridRows` pixels per fixture, or per program channel if grids share a channel) instead of a 10-50%-scale frame that JS then re-averages by hand. This keeps the live-reconfigurable operating model (no caspar restart on fixture edits — consumer add/remove/resize is dynamic like the existing DMX FILE/STREAM ingress) while moving the actual averaging math into native, already-linked, likely-SIMD code.

**Recommendation: pursue option 3 (hybrid) as the near-term win, and option 2 (native consumer) as a parallel, lower-priority investigation/spike — not a replacement — because of its config-only/restart-required limitation.** Option 3 is a bounded, testable change within the existing JS architecture and ingress pattern already proven by compose-preview. Option 2 is architecturally the "right" long-term answer for CPU cost but is gated on reverse-engineering an undocumented XML schema and accepting a restart-on-remap operating model that conflicts with how operators currently use this feature live; it should be scoped as an investigation/spike, not committed to, until its live-editability tradeoff is explicitly accepted by the owner.

---

## Draft follow-up work orders

### WO-228 — sws_scale downscaled averaging consumer (hybrid sampling upgrade)

**Goal:** Replace JS-side manual region averaging (`sampling-worker.js` `averageRegion()`/64-sample stride cap) with a dedicated ffmpeg `FILE`/`STREAM` consumer per sampled channel that downscales directly to the fixture grid resolution using `scale=<cols>:<rows>:flags=area`, modeled on `src/preview/compose-preview-consumer.js` / `caspar-ffmpeg-setup.js`'s existing dedicated-slot pattern.

**Haiku-sized tasks:**
- [ ] T228.1 Spike: manually construct one `ADD <ch> FILE <path> vcodec rawvideo pix_fmt rgb24 vf scale=<cols>:<rows>:flags=area` command (do NOT send it in this box — draft it against a disposable/offline caspar instance or a scratch config, or get owner sign-off before any live AMCP send) and confirm libswscale actually honors `flags=area` for extreme downscales (e.g. 1920x1080 → 8x4) — verify output pixel values look like true averages, not point samples.
- [ ] T228.2 Add a new dedicated consumer slot constant (e.g. `DMX_AREA_CONSUMER_INDEX`) parallel to `DMX_FILE_CONSUMER_INDEX` in `dmx-sampling-ingress.js`; build the `ADD`/`REMOVE` AMCP lines and FIFO/read-back plumbing, gated behind a new `sampleEngine: 'js' | 'native-scale'` per-channel or global config flag defaulting to `'js'` (no silent behavior change).
- [ ] T228.3 Update `sampling-worker.js` to accept pre-averaged per-cell pixels directly (skip `averageRegion()` entirely) when `sampleEngine === 'native-scale'`; keep brightness/gamma/colorOrder/mirror/rotation logic (rotation/mirror would need to move to the ffmpeg crop/transform stage or be pre-applied to fixture placement before building the scale target).
- [ ] T228.4 Smokes + a documented manual hardware A/B check (JS-average vs native-scale on the same fixture) before flipping the default.

**Risks:** ffmpeg `flags=area` behavior/availability should be double-checked against the linked ffmpeg version (avfilter 60/libavfilter.so.9 per `ldd`); rotation/mirror fixtures don't map cleanly onto an axis-aligned `scale` target — likely need per-fixture-orientation grouping or a pre-rotation crop step, adding complexity; multiple fixtures with different grids on the same program channel need either one scale target sized to the union of all grids or one consumer per fixture (more consumer slots, more AMCP churn) — needs a design decision before T228.2.

### WO-229 — Native artnet_consumer config schema reverse-engineering (investigation only)

**Goal:** Determine the exact `casparcg.config` XML schema for the native `<artnet>` consumer block found in `bin/casparcg` (Q2 findings above: `host`, `port`, `refresh-rate`, `universe`, `fixtures`, `computed-fixtures` ptree keys confirmed to exist, but nesting/attributes/value formats are not).

**Haiku-sized tasks:**
- [ ] T229.1 Ask the owner whether the vendor (`serwer`'s `CasparCG_Enhanced` fork) published release notes, a sample config, or a wiki page anywhere outside this box — check any vendor download page, changelog, or bundled example config that may ship alongside a future binary update, before attempting to guess the schema from symbols alone.
- [ ] T229.2 If no docs are found, more carefully mine the binary: `objdump -d`/`strings -t x` around the `get_fixtures_ptree`/`create_preconfigured_consumer` symbols for adjacent literal strings (attribute names, default values, enum-like strings for e.g. color order) that didn't surface in the coarse `grep -i artnet` pass; cross-reference against how `decklink`/`ffmpeg` consumer blocks are structured in this project's own `config/casparcg.config`-adjacent generator code for the XML nesting convention CasparCG_Enhanced likely follows (config generator already emits decklink/ffmpeg consumer blocks — use those as a schema template).
- [ ] T229.3 Once a candidate schema is drafted, validate it **only** in an isolated/offline test environment (never this live box) — e.g. a throwaway VM or a second machine — before proposing any change to this box's `config/casparcg.config` or config generator.
- [ ] T229.4 Write up findings (schema + confidence level + open questions) as a new WO for actual config-generator integration, gated on T229.1-3 producing a trustworthy schema.

**Risks:** guessing the schema wrong and testing it live could crash casparcg or silently no-op the consumer; must not be validated on this box. If no schema can be recovered with confidence, this WO should conclude "not viable without vendor docs" rather than ship a guessed integration.

### WO-230 — Config generator support for native artnet consumer (blocked/depends on WO-229)

**Goal:** Once WO-229 produces a validated schema, add `<artnet>` consumer block emission to `src/config/config-generator-consumer-attach.js` (the existing per-consumer attach pattern used for decklink/ffmpeg/screen), gated behind an explicit opt-in setting, defaulting off, and clearly documented as **restart-required** (unlike every other live-editable setting in this project's config UI).

**Haiku-sized tasks:**
- [ ] T230.1 Add `nativeArtnetConsumer: { enabled: false, host, port, refreshRate, fixtures: [...] }` to the DMX/lighting config schema (parallel structure to existing `dmxConfig.fixtures`, but only the fields the native consumer needs).
- [ ] T230.2 Config-generator emission of the `<artnet>` block per WO-229's schema, only when `nativeArtnetConsumer.enabled === true`.
- [ ] T230.3 UI warning/banner in the lighting inspector: enabling the native consumer requires a full server restart to take effect, and changing fixtures afterward requires another restart — explicitly different UX from the current live JS pipeline.
- [ ] T230.4 Decide and document interaction with the existing JS `DmxOutput`/`SamplingManager` — likely mutually exclusive per channel (don't double-send DMX from both a native consumer and the JS path for the same universe) — add a guard that warns/blocks enabling both for the same universe/destination.

**Risks:** restart-on-change is a meaningful operator-facing regression versus today's live pipeline for any operator who enables it; must be opt-in and clearly scoped to advanced/rare setups (e.g. a fixed, unchanging rig) rather than the default lighting workflow. Depends entirely on WO-229's schema being trustworthy — do not implement against a guessed schema.

### WO-231 — DMX/Art-Net sampling performance measurement (close out PERF-H1/H2/H3)

**Goal:** Before committing to WO-228/230, get actual numbers for the current JS pipeline's cost, per `PERFORMANCE_RUN_CHECK_BULLETIN.md` §H (PERF-H1 "OSC packet → variable update: alloc rate", PERF-H2 "SamplingManager poll interval vs hardware", PERF-H3 "Art-Net universe size and buffer reuse") — all three are still open/unmeasured, and a hybrid/native rewrite should be justified against a real baseline, not just qualitative code-reading.

**Haiku-sized tasks:**
- [ ] T231.1 Instrument `sampling-worker.js`'s per-frame processing (wall-clock time for the `process` message handler) and `dmx-sampling.js`'s ingress read loop with lightweight timing logs (behind `debugLogDmx` or a new debug flag), without changing default behavior.
- [ ] T231.2 On the live box, with the owner's consent and a real/typical fixture rig configured, capture a short timed sample window (existing live rig, no new caspar instance — just observe the already-running pipeline) — record fps actually achieved vs configured `fps`, per-frame JS processing time, and fixture/cell counts at time of capture.
- [ ] T231.3 Write the numbers into `PERFORMANCE_RUN_CHECK_BULLETIN.md` §H (mark PERF-H1/H2/H3 done with data) and reference them from WO-228 as the baseline to beat.

**Risks:** must not add always-on logging overhead to the hot path by default; must not require a caspar restart or new instance to capture — observe the existing live pipeline only.

---

**Numbering note:** work-orders through 227 exist at time of writing (`226_WO_TIMER_SCREEN_OVERLAY_UX.md`, `227_WO_COMPACT_MIXER_8CH_OVERFLOW.md`); this investigation's drafts start at 228 to avoid collision.

## 2026-07-15 — CORRECTION (owner appended sources after the investigation ran)
- Improved artnet consumer SOURCE: https://github.com/firecraftgaming/caspar-server/tree/improved-artnet
- The shipped extended build's SOURCE: https://github.com/gmeisel01/CasparCG_Enhanced — owner built it from source previously ("custom cef build"), so "rebuild unrealistic" is WITHDRAWN; a rebuild is planned.
- New task: research CasparCG/server PRs beneficial to live events (owner seeds: #1762, #1751, #1727; more to come). → WO-233.
