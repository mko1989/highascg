# WO-807 — Region-to-fixture-pixel mapping: average a screen area into one pixel of a lighting fixture

**Area:** mapping, lighting
**Status: DONE (29.10, all phases built and e2e-verified on the box; only physical rig movement is owner QA) — phase 1 (backend + patch link) DONE 29.10 (offline suite, live routes, a live average check, an ArtDMX loopback); phase 2 (Godot region editor) BUILT 29.10 (Godot suite + headless probes against the live server); GUI e2e PASSES 29.10 (`07_pixel_map` 9/9 in the sandbox, full run 41/41: operator path → DMX 425–427 = 128/64/100 on 127.0.0.1:6455; it found and fixed a window taller than the screen and a sandbox reading the live /dev/shm); automatic edge proposal BUILT + applied live 29.10 (56 PixelLines → 896 mappings, DMX master off; Godot tooltip/modal pending); rig movement is owner QA · live e2e 29.10: pixel-map editor + proposal tooltip/modal PASS on the glass**

Owner, 29.10:
> i mean the ability to map certain parts of for instance output to a led wall and send its color values to a lighting fixture. you can take the current project for instance. id like to map selected on the screen parts of screen to a corresponding pixelline fixture so they would become a kind of extension of the screen. as pixel density irl of led wall to a light fixture per cm/m whatever, there is a huge difference, so this needs to be implemented. for instance we take a 100px wide x 200px tall area of the screen to be mapped to first pixel (channel) of the fixture. here we need an averaging mode where pixels from that are on the screen get averaged into a single pixel.

Reference: `work/state_of_pixel_mapping.md` (what exists, what is missing).

## What is wanted

- **Regions on a screen's output.** Each region is a rectangle in a channel's raster (for example 100 × 200 px at
  x, y of the program output).
- **Each region drives one fixture pixel.** Region → pixel N of a patched fixture (PixelLine: N pixels, colour
  order RGB / RGBW). The mapping says: this region is pixel 1 of PixelLine "X".
- **Averaging mode.** The region's pixels are averaged to one RGB value per frame (the default), or the centre
  pixel is taken (a point mode for small regions).
- **Linked to the patch.** The fixture comes from the lighting patch (universe, start address, pixel count,
  colour order from the GDTF mode), not typed by hand.
- **Output.** ArtDMX over Art-Net (`src/fixtures/artdmx.js`) to the fixture's universe at the patch address.
  sACN later if needed.

## Investigation (to fill before code, file:line)

- The sampling source. The legacy engine (`src/sampling/dmx-sampling.js`, `sampling-worker.js`,
  `dmx-sampling-ingress.js`) reads Caspar's frame stream through a FIFO per channel. Confirm how frames reach
  it today and whether it can run without the legacy flag (`defaults-core.js:110`). Decide: re-use it as a
  library, or move the sampler into `src/fixtures/`. Keep the 500-line limit.
- `averageRegion` (`src/sampling/fixture-transform.js:41`) and its stride (`ceil(cellDim/8)`, line 50-55): is the
  average exact enough for a 100 × 200 px region at the output frame rate? Measure the cost at 1080p and at the
  box's real channel size.
- The patch: which fields a PixelLine head carries (`src/fixtures/follow-patch.js`, `gdtf-parse.js`): pixel
  count, colour order, DMX address stride per pixel. Confirm for the MHP rig's PixelLine heads.
- Where region definitions live: the project (`project.fixtures` is client-owned, see WO-764 note on
  `normalize_fixture`) or a new slice. Pick one and say why.

## Investigation (29.10, Opus)

**1. Frame source — how the legacy engine gets frames, and the decision.**
- The legacy `SamplingManager` is always constructed (`index.js:211`) and fed `config.dmx` on every config reload and
  Caspar connect (`index.js:257`, `index.js:381`). It runs on `settings.dmx.enabled` (`src/sampling/dmx-sampling.js:106`),
  NOT on the legacy flag: `legacyJsPixelmap` (`src/config/defaults-core.js:110`) has no server reader at all (only the
  WO-242 smoke pins it, `tools/smoke/smoke-wo242-pixelmap-screens.test.js:386`); it gated web UI entry points. On the
  box `config/dmx.json` has `enabled: false`, `fixtures: []` — the engine is idle.
- Frames reach it through an extra Caspar consumer per channel: default `ADD <ch> STREAM udp://…` (MPEG-TS, an encode in
  Caspar) decoded by a local ffmpeg to rgb24 scaled to 10–50 % of the channel (`dmx-sampling-ingress.js:92-121`,
  `:139-193`, scale `dmx-sampling.js:77-82`), or a FILE consumer on slot 721 into a FIFO (`dmx-sampling-ingress.js:19`,
  `:219-252`). Frames go to a worker thread (`dmx-sampling.js:304-326`, `sampling-worker.js:60-172`).
- Its output cannot serve the patch: `dmx-output.js:15-20` uses dmxnet, whose constructor binds a listener on :6454 —
  the box's own lighting input port (`src/fixtures/artdmx.js:5-6`); Art-Net universes are clamped to 0–15
  (`dmx-output.js:30`) while the MHP PixelLines sit on 13–18; the default destination is 255.255.255.255
  (`dmx-output.js:52`).
- A better frame source already exists: the WO-597 video-surface manager leases a Caspar **shm consumer** per channel
  (`src/system/video-surfaces.js:18-32`: role `chN` → consumer 800+N, `pgmN`/`prvN` → 741–748; declarative lease with a
  15 s TTL `:33`, `:147-160`), and `src/tracking/hshm-read.js:38-69` reads the newest frame (full resolution, BGRA
  premultiplied, seqlocked) with positional reads. The beam-spot finder already uses this path
  (`src/tracking/register.js:458-462`). No encode, no ffmpeg, no FIFO, no extra worker.
- **Decision: neither re-use nor move the legacy sampler.** Its ingress (STREAM + ffmpeg, or FIFO) and its output
  (dmxnet) are exactly the parts that do not fit, and its averaging is stride-capped (item 2). Phase 1 samples the
  shm surface directly (`src/fixtures/pixel-map-frame.js`, reading only the rows the regions need) and writes into the
  follow engine's universe buffers. `src/sampling/` stays untouched and deprecated; the legacy flag stays false.

**2. `averageRegion` accuracy and cost** (`src/sampling/fixture-transform.js:41-76`; measured with node on the box,
scratch bench, 2000 runs each):
- Stride `ceil(cellDim/8)` per axis (`:50-55`) = at most 8 × 8 = 64 samples. For a 100 × 200 region: stride 13 × 26,
  64 of 20 000 pixels. On a test pattern of 1-px red lines every 13 px (true mean R = 20.4) it returns **R = 0** at
  1080p and at 3840 × 1792 (aliasing). Its box is inclusive (`:45-48`, `Math.ceil(maxX)`): a w × h region covers
  (w+1) × (h+1). And it runs on a 10–50 % downscaled buffer, so real regions are averaged twice.
- Cost: legacy 0.6 µs (1080p) / 1.3 µs (3840 × 1792) per region — cheap because it reads 64 pixels. An **exact**
  average of all 20 000 pixels: 29.5 µs (rgb24, 1080p), 30.3 µs (BGRA, 3840 × 1792). The frame size does not matter,
  only the region area. 100 such regions ≈ 3 ms per frame.
- Decision: exact average (every pixel) up to 4 × 65 536 pixels per region; above that a uniform stride keeps between
  65 536 and 4 × 65 536 samples, centred in each stride cell (≤ ≈ 400 µs per region, worst case). `point` mode reads
  the centre pixel.

**3. The patch — what a PixelLine head carries** (`src/fixtures/follow-patch.js:59-89`, `:121-154`):
- Per head: `id`, `name`, `protocol` (artnet | sacn), `universe`, `address` (1–512), `dest`, `typeId` + `mode`
  (GDTF type in `projects/_gdtf/`, `gdtf-store.js:111`). `normalizePatch` resolves the mode and `applyType`
  (`gdtf-patch.js:35-38`) puts the break-1 channels with a DMX slot on `fx.gdtf.channels`: `{ name, geometry, offsets
  (1-based within the fixture), res, attribute, default, functions }`. Pixel fixtures place one template geometry by
  GeometryReference many times; `gdtf-dmx.js:309-317` instances the channels per reference, named after it. **There is
  no "pixel count" field**: pixels are the geometries that carry colour channels, in DMX order.
- MHP rig (project "mhp harder", `projects/mhp_harder.json`, read-only dump): **56 Pixel Line IP heads** (ACME, type `6ad826d14d1b`, mode
  `Mode11 70DMX`, footprint 70), Art-Net universes 13–18, addresses 1, 71, 141, 211, 281, 351, 421, dest
  255.255.255.255, no patch problems. Mode channels: Dimmer @1 (**default 0**), Shutter1/2 @2–3 (default 0), Frost @4,
  **16 RGB pixels** `Array 109`…`Array 124` @5–52 (`ColorAdd_R/G/B`, 8-bit, default 255, **stride 3**: pixel N →
  offsets 5+3(N−1) … 7+3(N−1)), **16 white segments** `Array 125`…`Array 140` @53–68 (`ColorAdd_W`), Color Fade @69–70.
  Example: Pixel Line IP 1042 (u18 @421), pixel 1 → absolute DMX 425/426/427.
- Other colour pixel types on the rig use `ColorAdd_*` (X-Dot also `ColorAdd_GY`, Robin LEDWash `ColorAdd_W`) or
  `ColorRGB_Red/Green/Blue` (MAC Aura PXL). Colour order therefore comes from the attributes, per pixel geometry.
- The MHP project has `fixtures.dmx = { enabled: false, universes: [], visualise: true }`: typed universes are never
  sent from this box (`follow-engine.js:165-170`). A mapping on this rig cannot move a light until the owner turns the
  DMX master on, lists the universe and turns the visualiser off.
- The dimmer default is 0: a mapped pixel stays dark until the programmer (`POST /api/fixtures/program`, e.g.
  `{"Dimmer": 1}`) or a look opens it. The pixel map writes colour channels only.

**4. Output path.** The follow engine owns every patched universe: "channels no fixture writes go out as 0"
(`follow-engine.js:12`); each 44 Hz tick writes every channel of each typed head (GDTF default or programmer value,
`:268-276`) and sends one packet per universe on change or 1 s refresh (`:278-291`), gated by the DMX master, the
universe list, the visualiser, the self-loop guard (`:84-89`, `follow-service.js:115-118`) and the WO-712 lighting
duty (`follow-service.js:111-113`). A second ArtDMX sender on the same universe would fight it (two sources, nodes
merge or flicker). **Decision:** the pixel map writes its colours into the engine's universe buffer right after the
head's own channels (a `pixelMap` hook on `FollowEngine`), so the packet the engine already sends carries them —
ArtDMX through `artdmx.js` (and sACN for free), every existing guard applies, and latency from a new shm frame to the
packet is ≤ one engine tick (22.7 ms).

**5. Where mappings live.** Not in `project.fixtures`: the Godot model rebuilds that slice from known keys only
(`godot/client/features/previs/tracking/follow_model.gd:129-145`), so any Godot edit would drop the mappings, and the
server must not write a client-owned slice (`src/engine/project-client-slices.js:11`, `calibrate-session.js:24`).
**Decision:** a new top-level project key `pixelMappings`, **server-owned**: written only by the API (persistProject +
project_sync broadcast, `project-scenes.js:229`, `routes-data-project-sync.js:35`); on client save / autosave the
stored copy always wins (`preserveClientOwnedSlices`), because the Godot autosave posts its whole `Store.project` and
retries a stale rev with the same content (`godot/client/core/project_sync.gd:126-139`) — a server write could
otherwise be reverted by a stale client copy. It travels with the project (save, load, Save As keep it).

**Box facts.** Caspar channels (AMCP INFO): 1 and 2 = 3840 × 1792, 3–5 = 1080p50, 6 = 720p50. No shm surface was
leased at the time of the investigation (`GET /api/video-surfaces`: all runtime roles inactive).

## Plan

Phase 1 (backend, one agent):
1. Mapping model: `pixelMappings: [{ id, fixtureId, pixel, channelNo, rect: {x, y, w, h}, mode: "average" | "point",
   colourOrder }]`. Validate: rect inside the channel raster, the fixture exists in the patch, the pixel index is
   inside the fixture's pixel count.
2. Sampler: for each mapped pixel, average the region from the channel frame each output tick; write the RGB into
   the fixture's DMX buffer at its address (pixel N × 3 or × 4 for RGBW); send ArtDMX at the output rate.
3. API: GET / PUT of the mappings, GET live values (for the UI), route order checked on the box with curl.
4. Tests: pure tests for the average and the address math; a loopback test to 127.0.0.1:6455 (not the broadcast
   address).

Phase 2 (Godot, separate WO after phase 1):
- A screen preview where the operator drags rectangles; a list of fixture pixels with a pick of region per pixel;
  live colour swatches from the API.

## Acceptance (phase 1)

- A 100 × 200 px region with a known colour (a test pattern on a known channel) → pixel 1 of a PixelLine on the
  patch → the ArtDMX packet carries that colour within one frame, checked on the loopback port.
- Averaging: a region with two colours → the mean, checked against a hand calculation.
- Offline suite green; line limit clean; no legacy flag set.

## Owner QA

- On the box: map one region to a PixelLine head and watch the head follow the region (only when the owner is ready
  for a fixture to move; the light state is live).

## What was done (phase 1, 29.10, Opus)

- `src/fixtures/pixel-map-frame.js` (new, 150): a row reader on the HASCGSHM v1 surface. It reads only the rows the
  regions sample, and only the spans they cover (merged when closer than 64 px). The seqlock is checked before and
  after, so a lapped frame is reported, never averaged. The average is exact up to 4 × 65 536 px per region; above
  that a uniform stride keeps 65 536 to 4 × 65 536 samples. `point` reads the centre pixel. Not the legacy sampler,
  for the reasons in the Investigation section: its ffmpeg ingress, its dmxnet broadcast output and its biased stride.
- `src/fixtures/pixel-map-model.js` (new, 183): pixels of a patched fixture, taken from the GDTF mode (each geometry
  that has colour channels, in DMX order), and their DMX slots. It also holds mapping normalise and validate, and
  colour → channel values (R/G/B, W, A, C/M/Y; 16-bit is written big-endian; other emitters are driven dark).
- `src/fixtures/pixel-map-service.js` (new, 257): it resolves mappings against the patch and the channel map, and
  leases the pgmN, prvN or chN surface (lease `wo807-pixelmap`, renewed every 5 s, released when the list is empty).
  `sample()` runs once per engine tick and reads only new frames. `write()` overlays each mapped pixel into the
  universe buffer, and drives it black when there has been no frame for 1 s. It also provides `live()` and
  `set()` (validate, then persist to the project).
- `src/fixtures/follow-engine.js` (+4) and `follow-service.js` (+5): the hook `engine.pixelMap`. The output still
  goes through the engine's universe buffer and packet path, so the DMX master, the universe list, visualise, the
  self-loop guard and the duty rules all apply to mapped pixels. No second sender is added.
- `src/engine/project-client-slices.js` (+7): `SERVER_OWNED_SLICES = ['pixelMappings']`. Client saves (web or Godot)
  keep the stored list, so a client that does not know the key cannot wipe it.
- `src/api/routes-pixel-map.js` (new, 54), registered on the existing router.js:489 line (router stays at 500 lines).
  The routes are GET/POST `/api/fixtures/pixelmap`, GET `…/live` and GET `…/pixels`. POST is used, not PUT, because
  the registry has no PUT verb.
- `src/tracking/hshm-read.js`: also exports the ABI constants and `readFully`. This is a one-line export change.
- `docs/wiki/api/contract/http.md` was regenerated (4 new routes).
- `tools/ci/offline-test-files-2.js`: the two new smokes were added.
- The legacy flag (`defaults-core.js:110`) is still false. The web inspector was not revived.

## Verified

- Offline: `smoke-wo807-pixel-map.test.js` passes 15/15. It covers the layout and address math (PixelLine @ 421 →
  pixel 1 at DMX 425/426/427), a hand-checked mean (two colours → (100,50,20)), lapped/missing frames, the stride,
  clipping, validation and the server-owned key. `smoke-wo807-pixel-map-loopback.test.js` passes 5/5 with real UDP
  on 127.0.0.1:6455. A known colour arrives on the first tick, the mean is correct, the next frame arrives on the
  next tick, the pixel goes black after 1 s, nothing is sent with the master off, and the lease is released.
  The full offline suite ran 3471 tests: 3469 pass, 0 fail, 2 skipped. Line limit, prettier and eslint are clean.
- On the box, after a node restart: the routes answer through the real router. A bad POST returns 400. `/pixels`
  lists 176 pixel fixtures (PixelLine 1042: 32 pixels). On ch2 (prv1) with real content, the server averages equal
  an independent full-frame average exactly. A real-frame harness (an engine copy of PixelLine 1042, sending to
  127.0.0.1:6455) received 1 packet 5.9 ms after the tick, on universe 18. DMX 425–427 matched the independent
  average.
- CPU, % of one core over 30 s windows. Node was about 4.7 with no mappings and about 6.2 with one 100 × 200 mapping
  on ch1. Caspar rose by about 6 for the pgm1 shm copy at 3840 × 1792. Sampling took about 0.27 ms per frame on
  average; with 4 mappings (one of 700 × 500) it took 0.75 ms.
- The test mappings were removed afterwards; the stored project has no `pixelMappings`, and the lease is released.
- NOT verified: real fixture movement on the rig. The MHP project has its DMX master off, an empty universe list and
  visualise on, so nothing goes on the wire. This is owner QA. Phase 2 (the Godot region editor) is not started.

## Phase 2 investigation (29.10, Opus)

**1. Preview surface for a channel.** The client draws a Caspar channel through the `VideoSurfaces` autoload
(`godot/client/video/video_surfaces.gd`): `texture(role)` (`:45`) is a stable Texture2D, `acquire(role, owner)` (`:50`)
holds and leases it, `release` / `release_all` (`:66`, `:70`) drop the hold (the server REMOVEs the consumer after the
15 s TTL). Leasable roles are `pgm1-4`, `prv1-4`, `inN` and **`chN` (any channel)** (`video/surface_holders.gd:40`). The
closest drawing pattern is the previs Camera view, `features/previs/tracking/tracking_view.gd`: hold only while shown
(`_hold` `:156`, `_exit_tree` `:169`), letterbox the picture into the control (`_scale` `:187`, `_origin` `:192`), map
view ↔ raster (`to_view` `:196`, `to_raster` `:200`), draw the texture or a "no picture" box (`_draw_back` `:205`). The
Live tab's preview (`features/live/live_preview.gd:32`, `:193-195`) uses the same acquire/release.
- The surface the client reads is the same shm surface the server samples (phase 1 `pixel-map-service.js` `roleFor`
  `:33-39`: pgmN / prvN when the channel is that bus, else chN). The editor uses the same mapping, so the editor and the
  sampler share one Caspar consumer.
- The channel raster: `Store.get_value("channelMap")` carries `programChannels`, `previewChannels` and
  `channelResolutionsByChannel` (read the same way in `features/live/compose_tile_math.gd:90`); on the box
  `{1: 3840×1792, 2: 3840×1792, 3–5: 1920×1080, 6: 1280×720}`, program [1, 3], preview [2, 4]. This is the map the
  server validates rects against (`pixel-map-service.js:25-30`), so snapping uses it, not the texture size.
  `GET /api/video-surfaces` announces pgm1=ch1, prv1=ch2, pgm2=ch3, prv2=ch4 (no width/height until leased).

**2. The fixture list.** `GET /api/fixtures/pixelmap/pixels` (`src/api/routes-pixel-map.js:23-32`) already gives
exactly what the list needs: per pixel fixture `{id, name, universe, address, problem, pixels: [{pixel, geometry,
order, slots}]}` (176 fixtures on the box, PixelLine heads 32 pixels). The client's own patch (`follow_model.gd`) has no
pixel layout (it lives in the server's GDTF parse), so the editor uses this route. The 3D view's selection
(`features/previs/fixtures/fixture_selection.gd:16-24`, `shared().ids`) preselects the fixture when a pixel head is
selected.

**3. Where the editor fits.** Previs tab → 3D mode Inspector → "Lighting" fold (`features/previs/previs_tab.gd:469-473`)
holds `fixtures_section.gd`, whose "DMX output" fold already opens a non-modal window, the DMX viewer
(`fixtures_section.gd:144-148`, `:395-401` → `dmx_monitor_window.gd`, an AcceptDialog that polls only while visible
`:87-92`). A region editor needs a large picture, which the Inspector column cannot give, and `previs_tab.gd` is at the
500-line limit. **Decision:** a "Pixel map…" button beside "DMX viewer…" opens `pixel_map_window.gd` (same pattern):
the picture with rectangles on the left, the pixel list on the right. No new top-level tab, no change to previs_tab.gd.

**4. Save and errors.** POST replaces the whole list (`routes-pixel-map.js:7`), so the editor sends the stored mappings
of other fixtures unchanged plus this fixture's rows. `Api.post_json` keeps the parsed body on a 400
(`core/net_util.gd:27-45`), so `errors[{index, id, error}]` maps back to rows by the posted index. Regions are a
client view: the stored list has one rect per mapping, so the editor groups equal (channel, rect) pairs into regions;
a drawn region with no pixel yet lives in the window until it is used (nothing to store server-side).

**5. Number fields.** RULES.md 1-2: `SpinBox.select_all_on_focus = true` (as `fixtures_section.gd:187`); Godot 4.7's
SpinBox evaluates `+ - * /` expressions on commit. The selected region's x / y / w / h are SpinBoxes.

## What was done (phase 2, 29.10, Opus)

All in `godot/client/features/previs/fixtures/`; no server or JS change; `previs_tab.gd` untouched.
- `pixel_map_model.gd` (new, 327, pure): channel raster and surface role from `channelMap` (`role_for` = the server's
  `roleFor`, so editor and sampler share one Caspar consumer); `snap_rect` / `clamp_rect` / `move_rect` / `resize_rect`
  (whole channel pixels, inside the raster, ≥ 1 × 1); `rect_problem` (the server's rect test); regions = the distinct
  (channel, rect) pairs of the stored list (`regions_from`, `hit`); `rows_for` (one row per fixture pixel);
  `build` (the working list after a row edit: other mappings unchanged and in place, new ones appended with unique ids);
  `move_region` / `drop_region` / `users` (a region is shared by every pixel on it, whichever fixture);
  `row_errors` (a 400's `errors[index]` → "fixtureId#pixel" via the posted list); `order_options` (auto + the
  orderings of the pixel's own letters); `live_by_id` (the live route → swatch colours).
- `pixel_map_view.gd` (new, 203): the channel's live surface (`VideoSurfaces.acquire` only while the window is open,
  `release_all` on close, like `tracking_view.gd`), letterboxed; drag on empty picture = draw, drag a region = move,
  the selected region's corner = resize, wheel = zoom at the pointer, right-drag = pan; each region labelled with its
  id and size in channel pixels, with a corner patch of its live colour.
- `pixel_map_rows.gd` (new, 133): a row per pixel: number (tooltip: geometry + order), region picker, average | point,
  colour order, live swatch (tooltip: RGB and whether it is on the wire), the server error under the row.
- `pixel_map_window.gd` (new, 402): a non-modal window (the DMX viewer pattern): channel and fixture pickers (a pixel
  head selected in the 3D view is preselected), Reload, the view, the selected region's x / y / w / h SpinBoxes
  (focus selects, maths on commit: RULES.md), Delete region, the rows, Save (POSTs the whole working list; 400 errors
  land on their rows, other fixtures' errors are counted in the note), and a 2 Hz poll of `/live` while visible only.
  Unsaved edits survive closing the window and are dropped by Reload.
- `fixtures_section.gd` (+10): "Pixel map…" beside "DMX viewer…" (DMX output fold); the two windows share
  `_open_window`.
- `godot/client/tests/test_pixel_map_model.gd` (new, 151): 67 assertions.

## Verified (phase 2)

- Godot suite: 22037 passed, 0 failed (the new file: 67 passed). Line limit: 0 files over 500. The two smokes that
  read `fixtures_section.gd` (WO-698, WO-700): 18/18.
- Headless probes in a scratch copy of the client (project renamed, so the owner's `user://` is not touched; a
  probe scene so the autoloads load) against the live server: the window lists 6 channels (ch1 = pgm1, 3840×1792)
  and 176 pixel fixtures (Pixel Line IP 1042: 32 rows); drawing the same rect twice selects the existing region;
  mapping pixels 1 and 2 to R1 builds 2 mappings; x = 50 moves both; w = 99999 is clamped to the raster; an invalid
  list POSTed to the real server got the 400 and the error appeared under pixel 2's row (nothing was stored). A valid
  Save of pixels 1 + 2 of PixelLine 1042 on a 100 × 200 region of ch1: "Saved 2 mapping(s)", status "channel 1
  (pgm1): live · 2 mapping(s) sampled", swatches RGB 1,26,78 (average) and 1,25,78 (point) equal to the `/live`
  values (slots 425–427, 428–430, on_wire false: the MHP DMX master is off). Then both were unmapped and saved: the
  list is empty again and the project has no `pixelMappings` key. The view's input: a drag at scale 0.25 drew
  400,200 100 × 200; move, corner resize, a click on empty (no region, deselects) and wheel zoom (the point under the
  pointer stays) behaved as written.
- NOT verified: the window's on-screen look and feel in the owner's GUI (not driven; no screenshots), the live picture
  in the view (headless has no shm texture upload to look at), and a real fixture following a region (DMX master off).

## E2E test (29.10, Opus)

The operator path as a WO-719 GUI end-to-end scenario: `godot/client/e2e/scenarios/07_pixel_map.gd`, run by the
existing runner in the **sandbox** (throwaway server on a free 127.0.0.1 port, own config and projects, `--no-caspar`,
`HIGHASCG_SANDBOX=1`; the real Godot client on a hidden Xvfb display with its own `user://`, `--video=feed`). Nothing
touches the live node (:4200), the live project, config/, the operator's :0 or the pointer.

**Run:**
```
node tools/e2e/run-gui-e2e.js --e2e=07_pixel_map --out=/tmp/pixelmap-e2e --keep   # ~1 min; exit code = failed steps
```
(`--e2e=all` includes it.) Output: `<out>/report.md` (✅/❌ per step + screenshot link), `results.json`, `shots/`,
`godot.log`, `sandbox/server.log`.

**Investigation (what the sandbox lacked):**
- The fixture engine lives in the tracking plugin (`src/tracking/register.js:450`), which the sandbox turned off
  (`HIGHASCG_TRACKING=0`) → `/api/fixtures/pixelmap` answered "fixture engine not running". Audited before turning it
  on: no detection / PTZ without project cameras (the MHP project has no `previs.tracking`), PSN only with
  `fixtures.output.enabled`, the console input (:6454) only with the visualiser or read-through, the auto store /
  audio desk / presenters already under the scratch HOME / root.
- **Isolation bug found:** `pixel-map-service.js` read `/dev/shm/highascg-<role>` hard-coded, so a sandbox would have
  sampled the LIVE Caspar's segment (the WO-719 shm fix covered `video-surfaces.js` and `video-feed.js` only).
- The simulated Caspar answers INFO CONFIG once, at connect; `channelResolutionsByChannel` (the raster the pixel map
  validates rects against) comes only from that answer, so a screen added at run time (as 03 does) has a channel
  number but no raster — POST mappings would be refused.
- **UI bug found (the e2e's first screenshot):** the Pixel map window opened 1560 × **2238** on a 1080p screen: Save
  and the lower half of the picture off-screen, and the drag ended outside the window (rect clipped to 112 × 92). Cause
  (measured on a second instance, frame 0): the hint Label (autowrap) is laid out at width 1 on the first pass →
  minimum height 2021 → the AcceptDialog (wrap_controls) grew to it and never shrank back.

**What was done:**
- `src/fixtures/pixel-map-service.js`: the default surface path is `video-surfaces.segmentFor(role).path` (the path the
  surface manager announces: `/dev/shm/…` on the box, `<root>/shm/…` in a sandbox); `segmentFor` exported. Pinned in
  `smoke-wo719-sandbox-guards` (4/4).
- `features/previs/fixtures/pixel_map_window.gd`: the hint label gets `custom_minimum_size.x = 560`;
  `popup_centered_clamped(1560 × 860, 0.94)` so it also fits a smaller operator screen. Window now 1560 × 860 at 180,110.
- `tools/e2e/sandbox-server.js`: option `tracking: true` (`HIGHASCG_TRACKING=1`); default unchanged (off).
- `tools/e2e/pixel-map-fixture.js` (new, 194): the sandbox side — (1) project `e2e_pixel_map` in the sandbox's
  projects dir = the MHP rig's `fixtures` slice (read from `projects/mhp_harder.json`, never written) with **every
  head's dest rewritten to 127.0.0.1:6455** (refuses otherwise), DMX master on for `artnet:18` only, visualiser off,
  PSN output off; the GDTF types it uses copied into the sandbox's `_gdtf`; (2) `sandboxConfig()`: one PGM/PRV screen
  (1080p50, ch1 = PGM 1, ch2 = PRV 1) seeded before boot; (3) a HASCGSHM v1 writer on `<root>/shm/highascg-pgm1`
  (10 frames/s, a known pattern: background (20,24,32); x 400–449 / 450–499, y 300–499 = (240,32,0) | (16,96,200);
  x 1200–1259, y 500–539 = (0,180,90) with a 6 × 6 (255,255,0) marker around 1229,519). The simulated Caspar draws
  nothing, so this stands in for the channel; the feed shows it to the client, the sampler reads it.
- `tools/e2e/run-gui-e2e.js`: when `07_pixel_map` (or `all`) is selected, the sandbox starts with `tracking` and the
  seeded screen, and the fixture runs until the sandbox stops.
- `godot/client/e2e/e2e_ui.gd` (+30): `press_drag(on, a, b)` (a hit-tested left drag inside one control's own input,
  not a GUI drag-and-drop) and `reveal(c)` (scroll the ScrollContainers above it, e.g. the Inspector column).
- `godot/client/e2e/scenarios/07_pixel_map.gd` (new, 390): the steps below. Controls are found by text / tooltip (the
  rows by the "Pixel N · …" tooltip of their number), every step asserts what the UI shows and what the server stored.

**Steps and assertions** (run 29.10 13:41, **9/9 passed**, 0 SCRIPT ERRORs, client quit normally; the full
`--e2e=all` run with the seeded screen and the tracking plugin on: **41/41 passed**, exit 0, no HANG, no Xvfb left):
1. Setup (not under test): channel 1 raster in `/api/settings`; POST `/api/project/load` `e2e_pixel_map`; `/pixels`
   lists Pixel Line IP 1042 (u18 @421, 32 pixels: 16 RGB + 16 W; pixel 1 slots 425–427); bind 127.0.0.1:6455.
2. Previs tab → 3D → Inspector → Lighting → DMX output → "Pixel map…" (scrolled into view, hit-tested click) → the
   window is visible, has the picture view and fits the screen.
3. Channel picker → "Channel 1 (Program 1) · 1920×1080": the view holds role pgm1 at 1920 × 1080, the pgm1 texture
   arrives over the feed (960 × 540) and matches the pattern at 4 probes (± 40 for JPEG).
4. Drag on the picture: R1 drawn as 393,294 112 × 211 (the dragged box, snapped to channel pixels, ± 4); typed x
   `800/2` (maths, RULES.md 2), y 300, w 100, h 200 → fields 400,300 100 × 200 and the title "R1 · 100 × 200 px at
   400, 300"; R2 drawn 1194,494 71 × 51 → typed 1200,500 60 × 40.
5. Fixture picker → "Pixel Line IP 1042 · U18.421 · 32 px": 32 pixel rows shown (= the head's pixels from `/pixels`).
6. Row 1: region "R1 · 100 × 200 px", average, rgb; row 2: "R2 · 60 × 40 px", point, rgb; row 3 stays "—"; "Save *".
7. Save → note "Saved 2 mapping(s).", button back to "Save"; GET `/api/fixtures/pixelmap` = the 2 mappings (fixture,
   pixel, channel 1, rects, modes, colour order rgb).
8. Live: `/live` both `on_wire: true`; **R1 average: hand calc (128,64,100) = `/live` rgb = the average recomputed in the
   scenario from the pgm1 segment file (all 20 000 px) = DMX 425/426/427 = 128/64/100 = the swatch = the ArtDMX packet
   (universe 18, data[424..426]) received on 127.0.0.1:6455; R2 point (centre 1229,519): (255,255,0) everywhere, DMX
   428/429/430 = 255/255/0.** Swatch tooltip says "on the wire". 41 ArtDMX packets received during the run.
9. Rows 1 and 2 → "—", Save → "Saved 0 mapping(s).", GET mappings empty, GET `/api/project` has `fixtures` and **no
   `pixelMappings` key**, `/live` has no mappings and no sampled channel (lease released). Then Close.

Screenshots (Xvfb, from the running sandbox client, after each step) in
`/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/pixelmap_e2e/shots/` (session
scratchpad, not kept): 04 the picture with R1 + R2 drawn and the fields, 06 the pixel list mapped, 08 the live swatches
(row 1 mauve 128,64,100, row 2 yellow) and "channel 1 (pgm1): live · 2 mapping(s) sampled".

Gates: line limit 0 files over 500; eslint clean on the changed JS; smokes wo719 sandbox guards 4/4, wo807 pixel map
15/15 + loopback 5/5. Live box: node PID unchanged (334887), no request to :4200, `projects/mhp_harder.json` only read.

**NOT verified:** the owner's live GUI (not driven); a real fixture following a region (the live MHP DMX master is
off; the sandbox sends to loopback only); real Caspar frames in the sandbox (the pattern writer stands in for the
channel; the live-frame average was checked in phase 1); the 400 error path in this e2e (the row error labels are
autowrap too and may show the same first-layout growth when they first appear — not exercised).

## Automatic edge proposal (29.10, Opus)

Owner 29.10: map every PixelLine to its closest LED-wall edge, ~50 px inside the picture (overlap fine); automate it —
when an MVR is loaded and its LED wall is patched to a screen destination, compute the mapping from the fixture's size
and pixel count and offer it (tooltip → modal with the proposition). This step = the server side + applying it to the
live project now; the Godot tooltip / modal is a later step by another agent (godot/client untouched here).

**Investigation (file:line):**
- **LED wall rect:** `project.previs.stage.objects[]` type `led_wall`; `source.role` (pgmN / prvN / chN) names the
  channel, `source.rect` the wall's part of that channel's raster (x right, y down). Geometry as the previs draws it:
  `godot/client/features/previs/stage_objects.gd` `pixels()` :82 (panels × panel px), `size_m()` :95 (panels ×
  panel_mm), `front_rect()` :214 — `position` is the **bottom centre** of the picture, yaw = `rotation[1]` about UP
  (local x = (cos, 0, −sin)), `_to_world_xz()` :229. Role → channel = `programChannels[N−1]` / `previewChannels[N−1]` /
  N; raster = `channelResolutionsByChannel` (the inverse of `pixel-map-service.js` roleFor).
- **Live rig:** 3 walls on pgm1 (ch1 3840 × 1792): led_wall_1 x0 w1024 (4 × 7 m, yaw 10.08), led_wall_2 x1024 w1792
  (7 × 7 m, yaw 0), led_wall_3 x2816 w1024 (4 × 7 m, yaw −9.96); panels 128 × 256 px at 500 × 1000 mm = 256 px/m.
  56 Pixel Line IP heads (`Mode11 70DMX`) in 8 vertical columns of 7 one-metre bars (z 0.66…6.66).
- **Fixture positions:** the patch pose (`follow-patch.js` normalizeFixture :79, PSN metres) → Godot (x, z, −y) as
  `camera_model.gd` psn_to_godot :33; orientation `gdtf-ik.js` poseXf :61 = `fixtures_3d_model.gd` pose_xform :34.
  Per pixel: the GDTF rig (`gdtf-store.js` visual :118 → `gdtf-rig.js` buildRig :39) — the PixelLine's RGB cells
  `Array 109…124` carry Beam children at local x −0.465…+0.465, **pitch 0.062 m**, body 1 m, pose = centre; roll −90
  → pixel 1 on top. `pixelsOf` gives 32 pixels (1–16 RGB, 17–32 W); only the colour-mixing ones (r,g,b or c,m,y) are
  proposed — the W cells sit on the same LEDs.
- **Threshold:** live distances head → nearest edge are 0.06–0.28 m; the gaps between walls are ≥ 1.2 m and a head
  3 m away is clearly not "at" the wall → default **1.5 m** (option `threshold_m`).

**The rule** (`src/fixtures/pixel-map-propose.js`, pure, 288 lines): per linear pixel fixture (≥ 4 mixing pixels on a
line within 10 % of the span, span ≥ 5 cm) the nearest edge over all bound walls (3-D distance to the edge segment, in
the wall's plane frame; pitch/roll/curve of the wall ignored and noted). Beyond the threshold → warning, not mapped.
- **Spacing 'gdtf':** cell = first→last pixel distance / (n−1) (0.062 m → 15.87 → **16 px**); cells centred on the
  projection of the fixture's centroid, in the real pixel order along the edge.
- **'corner' fallback** (no rig positions): foot → nearest corner length shared by the n cells.
- Rect per pixel: along the edge `round(cell × px/m)`, across **depth 40 px**, **inset 50 px** from the edge on the
  inside (`left x0+50`, `top y0+50`, `right x0+w−50−40`, `bottom y0+h−50−40`), clamped to the wall rect (off-edge
  counted). Mapping `{ id: auto-<fx>-<pixel>, enabled, fixtureId, pixel, channelNo, rect, mode: average, colourOrder: auto }`.
  Options: `inset_px`, `depth_px`, `threshold_m`, `mode`.

**What was done:**
- `src/fixtures/pixel-map-proposal.js` (new, 232): the service — inputs from the project + engine patch, signature
  (MVR id + bound walls + linear fixtures' positions), `check()` / `get()` / `accept()` / `dismiss()`; the pending
  proposal lives in memory and in the project under the **server-owned** key `pixelMappingProposal`
  (`{ state: pending | accepted | dismissed, sig, at, … }`). Content-based: the same inputs are never proposed twice,
  a restart neither misses nor repeats one; nothing is applied until accept.
- **Hook:** `src/fixtures/follow-service.js:171` creates it right after `onProjectChanged(apply)` (so it reads the
  patch the change just configured); it runs `check()` once at start and on every project change, debounced 500 ms
  (`pixel-map-proposal.js:130` check, :158 schedule) — not on polls. It needs an MVR (`previs.mvr`), a wall bound to a
  running channel with a known raster, and a linear pixel fixture.
- `src/api/routes-pixel-map.js`: `GET /api/fixtures/pixelmap/proposal` (pending one, else fresh; `?inset_px=…` /
  `fresh=1` recompute; no side effects), `POST …/proposal/accept` (`pixelMap.set` = the POST's validation; keeps other
  fixtures' mappings unless `replace: true`; records accepted in the same write), `POST …/proposal/dismiss`.
  API contract regenerated (523 routes).
- `src/fixtures/pixel-map-service.js`: `set(list, { extra })` (proposal state in the same project write),
  `liveChannelMap` exported. **CPU:** applying 896 mappings took node ~5 % → ~50 % (sampling ~7 ms/frame at 44 Hz).
  Now sampling idles while no mapped head is on the wire and `/live` was not read for 5 s (`idle_ticks` in /live; a
  head whose universe is not built yet counts as on the wire). `pixel-map-frame.js` MERGE_GAP_PX 64 → 1024: 10 675 →
  3 577 reads, 6.8 → 5.1 ms per frame when active. Node back to ~15–20 % (others' timeline scrubbing included).
- `src/engine/project-client-slices.js`: `SERVER_OWNED_SLICES = [pixelMappings, pixelMappingProposal]`; the stored copy
  now wins **including absence** (a client save cannot resurrect a key the server removed); Save As to a new name
  still keeps the client's copy.

**Verified:**
- Live (node 484293): proposal `walls 3, mapped 56, out_of_range 0, 896 mappings`, every fixture rule gdtf, 16 px
  cells, distances 0.064–0.276 m (wall 1 left ×14 / right ×7, wall 2 left ×7 / right ×7, wall 3 left ×7 / right ×14).
  `?inset_px=80&threshold_m=0.2` → 14 mapped / 42 out of range, x = 80. Accept with `threshold_m 0.01` → 400
  "nothing to accept…". **Accept `{}` → 200 `{ accepted: 896, kept: 0, fixtures: 56 }`**: GET /api/fixtures/pixelmap
  896, all `problem: null`, the two px-… test mappings of 1042 replaced; project rev 279 → 280. After the restart:
  proposal `pending: false, applied: true`, no spurious pending key. **DMX master off** (`fixtures.dmx.enabled false,
  universes []`), PSN output off.
- Rects in the pgm1 raster: six vertical 40-px strips 50 px inside each wall boundary — x 50–90, 934–974, 1074–1114,
  2726–2766, 2866–2906, 3750–3790 (seams at 1024 / 2816), full height in 16-px cells; e.g. 1042 → led_wall_3 left,
  0.265 m, x 2866 w40, y 1537…1775. The pgm1 frame with the rects drawn: averages follow the content (1042 pixel 1
  (26,60,173), pixel 16 (0,0,14)). Walls 1 and 3 each have two columns on the same edge → shared strips (owner: overlap OK).
- Sandbox hook e2e (WO-719 sandbox, 1080p ch1): before the MVR no proposal; autosave with `previs.mvr` + walls →
  `pending: true`, 56 / 896, key in the project file; a stale client autosave without the key keeps it; accept 200 →
  key `{ state: accepted }`; journal lines for propose and accept.
- Tests: `tools/smoke/smoke-wo807-pixel-map-propose.test.js` (new, 20 tests / 3 suites, in
  `tools/ci/offline-test-files-2.js`): top edge at 0.3 m (16 px, y 50, h 40), 3 m → not mapped, left / right / bottom /
  rotated wall / corner fallback / clamp / non-linear / nearest of two walls; pending + no repeat + restart + moved
  wall, dismissed / accepted not re-proposed, accept merge, debounced event hook, server-owned slice, sampling idle +
  merged spans. Full offline suite **3548 tests, 3546 pass, 0 fail, 2 skipped** (wo811 auth-clients 7/7). Line limit 0
  over 500; eslint clean; contract `--check` 0.

**NOT verified:** the look on the glass / owner GUI; a real fixture following its strip (DMX master stays off); the
Godot tooltip + modal (later step, another agent). Caveats: wall pitch / roll / curve ignored; the Caspar shm lease is
held while mappings exist (~6 % Caspar CPU, phase 1) even when sampling idles.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** Previs → DMX output fold → Pixel map.
- The window opens with the mappings (q807_pixmap.png). A test region was drawn (not saved) and deleted (q807_region.png).
- Auto proposal… opens the modal (q807_modal.png), and the proposal tooltip shows (q807_tooltip.png).
- Art-Net went to loopback only.
- Finding (not fixed): the region labels overlap in the pixel-map window.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).

## Follow-up 29.10 — overlapping region labels (fixed)

**Investigation.** In the e2e screenshot `q807_pixmap.png`, 896 mapped regions sit edge to edge along the wall
columns. `pixel_map_view.gd` `_draw()` drew a "R### 40 × 16 px" label for every one of them, so each column turned
into an unreadable yellow smear.

**Done.**
- `_draw()` collects the labels and places them through a cell grid (`P.label_cells`, 8 px cells, in
  `pixel_map_model.gd` so tests can load it). A label that would land on cells already taken is skipped.
- The selected region's label goes first and always shows; the region list still names every region.
- Outlines and colour swatches are unchanged.

**Verified.**
- New `test_label_cells_detect_overlap`. Godot suite: 22851 passed, 0 failed.
- Visual: a second client (private Xvfb, 1920×1080), Previs → DMX output → Pixel map… on channel 1 with the 896 live
  mappings. Each column now shows readable "R### 40 × 16 px" labels spaced down the wall; before, the columns were a
  solid smear (session scratchpad `pm4.png` vs `live-e2e/q807_pixmap.png`).
