# WO-807 — Region-to-fixture-pixel mapping: average a screen area into one pixel of a lighting fixture

**Status: IN PROGRESS — phase 1 (backend + patch link) DONE 29.10 (offline suite, live routes, a live average check, an ArtDMX loopback); phase 2 (Godot region editor) BUILT 29.10 (Godot suite + headless probes against the live server; the on-screen look is owner QA); rig movement is owner QA**

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
