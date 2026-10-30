# WO-869 — Mapping node slices: cut a screen destination's output into slices and place them freely on an output canvas (Resolume-style)

**Area:** devices-config, amcp, godot-client
**Status: IN PROGRESS (30.10) — P1 model/planner/API, P2 Godot editor and P3 path (b) built; slices verified on the real Dioda head (gpu-texture on, config baseline, live APPLY, Caspar-restart re-apply; §5.1) after two WO-868 interaction fixes; caps probe done (§7); open: path (a) route-slices (§6)**

Owner 30.10: "need also a way inside mapping node to slice the output of a screen destination and position it freely on a set canvas output. similar to how resolume works with slices. i have a round around way of doing this with rendering the canvas then playing its sliced up routes on the output, but there must be an easier way to do this. doesnt caspar has something built in for these purposes? if not there needs to be a pull request that has something similar."

Related: [WO-18](./18_WO_OUTPUT_SLICER.md) (the original pixel-mapping node; its Phase 3/4 "slice positioning" and "MIXER CROP/FILL route generation" tasks were never built), [WO-253](./253_WO_MAPPING_NODE_UNDEPRECATE.md) (mapping node = canvas splitter), [WO-437](./437_WO_mapping_dims_stale_and_gl_sync_mapping_rig.md), [WO-390](./390_WO_CROP_NOT_APPLYING_ON_CASPAR_OUTPUT.md) (CROP verified on route layers), [WO-502](./502_WO_SEVEN_CHANNELS_EXCEED_THE_SINGLE_GL_THREAD.md) (what an extra channel costs), [WO-867](./867_WO_caspar_pr1762_effects_fixes.md) (the Caspar fork's patch workflow).

---

## 1. Investigation

### 1.0 Short answers

- **Is there anything built in?** No. Nothing in CasparCG (our fork or upstream master) takes several source rectangles and places each one on a destination quad inside one consumer. What exists is (i) the DeckLink `<subregion>`, a single 1:1 rectangle per port, set in the XML only; (ii) `route://` plus `MIXER CROP/FILL/PERSPECTIVE` on an output channel; (iii) a screen consumer that draws the whole channel as one quad. What I told the owner earlier holds, with the corrections in 1.4.
- **There is a hook upstream that our fork lacks and that the PR needs:** `APPLY <ch>-<consumer> ...` (upstream PR #1638, merged 2025-06-18) calls `frame_consumer::call()`. It is 61 added lines in 5 files. The fork has no `APPLY` and no `frame_consumer::call` (`grep 'L"APPLY"'` in the fork's `protocol/amcp/AMCPCommandsImpl.cpp` finds nothing). So the live-edit half of path (b) costs a cherry-pick, not a design.
- **Upstream has asked for exactly this and not built it:** issue #1587 (open) "subregions for non-decklink consumer" asks for multiple subregions per DeckLink and says "Currently, to achieve this, I have to use several routing channels and transform properties". The maintainer reply in #870 (closed) and the text of PR #1433 say the intended answer for scaling/rotation is "a dedicated channel and route". A screen-consumer slice stage is new, additive ground.

### 1.1 How mapping nodes work today (HighAsCG)

A mapping node is a device-graph device with `role: 'pixel_mapping'`, one `pixel_map_in` connector and N `pixel_map_out` connectors (`src/api/device-view-crud-mapping.js:19-47`; default is two 1080p5000 outputs). Settings are `settings.outputs[]` (`{id, mode, label, width?, height?, fps?}`) and `settings.mappings[]` (`{outputId, type:'video_slice', rect:{x,y,w,h}, rotation, targetPos}`), i.e. **at most one source rectangle per output, and the output is that rectangle 1:1**.

- **Data entry.** The Godot Inspector page lists per output: label, mode/custom size, "Src X / Src Y / Width / Height" (`godot/client/features/devices/mapping_page_model.gd:121-169`; save path `mapping_flow.gd:145`). The note at the top of `mapping_controls.gd:7` says "Show Mapping Preview" (the web pixel-map editor) was **not ported**. The web has a canvas editor (`client/components/pixel-map-editor.js`, `pixel-map-editor-canvas.js`, state in `client/lib/mapping-state.js`) with drag/resize/rotate handles; `rotation` is written at `mapping-state.js:70,125`.
- **`rotation` and `targetPos` are dead data.** `rg 'targetPos|\.rotation' src` finds no consumer in the config generator or any apply code for mapping slices. WO-18's Phase 3.4 ("allow positioning the content on the output frame") and Phase 4 ("generate MIXER CROP/FILL") were never implemented; the WO is still IN PROGRESS.
- **SDI outputs (DeckLink).** `src/config/pixel-mapping-config.js:60-133` builds one `tiles[]` entry per DeckLink-cabled output: `srcX/srcY` = the rect, **`destX: 0, destY: 0` hard-coded (`:110-111`)**, `width/height` = rect size. `src/config/config-generator-consumer-attach-screen.js:43-60,106-141` writes it as one `<decklink>` consumer on the program channel: primary port plus synced `<ports>`, each with a `<subregion>` (`:53`). Applying it is a **config regenerate + Caspar restart**. `src/config/routing-setup.js:360-364` (`setupMappingChannels`) is an empty function whose comment says "no extra mapping channels or AMCP mirrors".
- **GPU heads.** `src/utils/mapping-gpu-os-layout.js:140-231` (`buildMappingGpuLayoutArtifacts`) turns each `pixel_map_out → gpu_out` edge into an xrandr row. Position `x,y` is the slice rect's `x,y` (`:188-189`), mode is `w×h` (or the whole canvas union with `osXrandrHeadMode: 'canvas'`, `:193-205`). The program channel's screen consumer is one window spanning the heads. So **a head shows the part of the canvas where its rect sits: destination position equals source position.** Free placement is not expressible.
- **What the owner can't do today:** put a source rect anywhere other than its own position, put several rects on one output, scale/rotate/keystone a rect, or cut from more than one source.
- **Channel cost today is zero:** the program channel is the canvas (custom video-mode from the destination) and the outputs are views onto it.
- **Precedents for an auxiliary channel with routed layers** that the slice backend (a) can copy: the operator GUI channel (`src/system/operator-gui-channel.js:136-200`: `PLAY ch-layer route://…` only when the route changed, `MIXER FILL` every apply, STOP+CLEAR hygiene, one COMMIT, per-channel promise chain), the multiview apply (`src/engine/multiview-apply.js`, same conventions), and the native pixel-map screen channel (WO-242, `src/config/config-generator-consumer-attach-misc-channels.js:64+` `buildPixelmapChannel`: a dedicated channel with a custom video-mode). `src/caspar/amcp-mixer.js:163-214` already has `mixerFill/mixerCrop/mixerPerspective/mixerRotation`.

### 1.2 CasparCG internals (our fork `~/caspar-build/src-v2/src`, HEAD `a09a40f12`, read-only; paths below are relative to `src/`)

**Screen consumer — `modules/screen/consumer/screen_consumer.cpp` (1175 lines).** It is already a tiny GL renderer, and it already has the stage a slice list needs:

- `configuration` (`:80-109`): window `x,y,width,height`, `stretch`, `aspect_ratio`, `sbs_key`, `key_only`, `gpu_texture`, `colour_space`. No geometry list.
- `std::vector<core::frame_geometry::coord> draw_coords_` (`:190`) is the vertex list: `calculate_aspect()` (`:672-721`) fills it with **6 vertices = one quad** (`{x, y, u, v}` in NDC and texture space), or 12 for `sbs_key` (two quads, fill then key, `:690-713`). `draw()` (`:617-650`) uploads `draw_coords_` to a VBO and does `glDrawArrays(GL_TRIANGLES, 0, draw_coords_.size())`; for `sbs_key` it draws the two halves with a `key_only` uniform. **It already draws N quads from a list; only the list is fixed to 1 or 2.**
- The vertex attribute `TexCoordIn` is a `vec4` fed from `coord{texture_x, texture_y, texture_r, texture_q}` (`draw()` reads 4 doubles from offset 2). `screen.frag` samples `texture(background, TexCoord.xy)` and ignores `.w` (q). The image mixer's own shader does divide: `uv = TexCoord.st / TexCoord.q` (`accelerator/ogl/image/shader.frag:684`), with `fill_texture_q_for_quad` (`accelerator/ogl/util/transforms.cpp:256`) computing q per corner for perspective-correct quads. Per-slice perspective in the screen consumer is therefore a 1-line shader change plus q values, not a new technique.
- Both display strategies bind the channel's full frame as one texture before `draw()`: `gpu_strategy::do_tick` (`:918-990`, `in_frame.texture()->bind(0)`) and `host_strategy` (`:860-915`, PBO upload). Multiple quads sampling sub-rectangles of that one texture add one extra draw call and one bilinear sample per covered pixel. Negligible against the mixer.
- `gpu-texture` is forced on in HighAsCG (WO-502 §5d), so slices would run on the GPU path.
- **There is no live control path into a consumer in the fork.** `set_visibility`/`toggle_visibility` (`:578-579,758-766`) are called from nowhere outside the file. `frame_consumer` (`core/consumer/frame_consumer.h`) has no `call()`; `output` (`core/consumer/output.cpp:51-52`) holds `std::map<int, spl::shared_ptr<frame_consumer>> consumers_` under `consumers_mutex_`. AMCP `ADD`/`REMOVE` address a consumer as `<ch>-<index>` (`protocol/amcp/AMCPCommandsImpl.cpp:476-517`); for the screen consumer `index() = 600 + (key_only?10:0) + screen_index` (`:1022`). Re-ADDing a consumer to change slices would recreate the window (flicker on air), so it's not an option.
- **Upstream master has the missing hook:** `frame_consumer::call(params) -> std::future<bool>` (default returns false), `output::call(index, params)` and AMCP `APPLY` (`register_channel_command(L"Basic Commands", L"APPLY", apply_command, 1)`), PR #1638, commit `f7dcc0322`, +61/−8 over `frame_consumer.h`, `frame_consumer_registry.cpp`, `output.h/.cpp`, `AMCPCommandsImpl.cpp`. PR text: "Could be used in any consumer to allow clients to on the fly update parameters." No in-tree consumer implements it yet. (Fetched upstream master files into the scratchpad `…/scratchpad/wo869/up/`.)
- The consumer parser is `create_preconfigured_consumer` (`:1091`, XML) and `create_consumer` (AMCP `ADD n SCREEN …`, `:1049+`). AMCP gives `x/y/width/height` (upstream #1284), not slices.

**DeckLink consumer — `modules/decklink/consumer/`.**

- `config.h:38-47` `port_configuration`: `src_x, src_y, dest_x, dest_y, region_w, region_h` — **one subregion per port**. `config.cpp:50-58` parses `<subregion>` in `parse_output_config` (XML) only. `parse_amcp_config` has no subregion parameters (it handles `INTERNAL_KEY`, `LOW_LATENCY`, `KEY_ONLY`, …), so it can't be changed over AMCP.
- `sdr_bgra_strategy.cpp:107-172` does the copy: a **CPU row-by-row `memcpy`** of the host frame (`frame.image_data(0)`) into the DeckLink buffer, black-filling the rest. 1:1 pixels only, no scaling, no rotation. `dest_x/dest_y` do work (the code places the rect anywhere in the SDI frame) — HighAsCG just always writes 0 (`pixel-mapping-config.js:110-111`). The v210 path has an equivalent (`v210_strategies.cpp:326-366`).
- Consequence: a GPU-side slice stage in the screen consumer cannot feed SDI. SDI outputs that need scaling/rotation/warp need a real channel (path a) or, for pure 1:1 placement of several rects, multi-subregion support (upstream #1587).
- Cosmetic bug seen on the way: `monitor.cpp:43` writes `subregion/src-x` twice (second should be `dest-x`).

**Image mixer per-layer transforms (what path (a) relies on).**

- `MIXER CROP l t r b` / `CLIP` / `PERSPECTIVE` are *geometric*, not scissor: `accelerator/ogl/util/transforms.cpp:106-128` (`combine_transform`) pushes crop regions and a perspective step; `transform_coords` (`:300-420`) clips the quad polygon against each region. They apply only when `enable_geometry_modifiers` is set (`core/frame/frame_transform.h:106`), which the stage sets for every layer (`core/producer/stage.cpp:178,190`). WO-390 §2.1 verified live that `CROP` renders correctly on a **route** layer.
- Order of effect for one layer: CROP is applied in the layer's own unit square, PERSPECTIVE warps that square (bilinear corner displacement `apply_perspective_to_vertex` `:131-151`, then q-correction), then the layer's FILL matrix places the result. So to put a source *sub-rectangle* on a destination quad you crop to the sub-rectangle and give FILL/PERSPECTIVE values computed for the **whole** content square (the sub-rect's mapping extended to the unit square). The math is in §2.2; it must be proven against the box with a pixel probe before it is trusted (Spike S1).
- **Known upstream bug in our fork:** `transforms.cpp:185-191` compares the *unnormalised* cross product to `epsilon = 0.001`, so the real tolerance is `0.001 / edge_length`. Small crop regions leak (36 px wide clip leaked ~58 px). Reported as #1813, fixed by #1814 (merged 2026-09-30, commit `4a0eaf00`, one file, +16/−16). **Slices are exactly small crop regions on a large canvas** — a 200 px slice on a 3840 canvas has edge length 0.052, tolerance ≈ 77 px. Path (a) must not ship without that patch in the fork.
- The effects from #1762 in the fork (`MIXER BLUR/SHARPEN/GRAIN`, commits `530542a16..a09a40f12`) are per-layer, so on a route slice layer they work per slice for free (Resolume-style per-slice colour/blur). Edge blending is not among them.

**Cost of `route://` (path a).**

- `core/producer/route/route_producer.cpp:140-149,178-200`: the route holds a bounded queue (1 same-channel, 2 cross-channel) pushed at the source's tick and popped at the destination's tick. Latency to the aux channel is one to two frames. It also drops frames when the destination is slower than the source (memory "route fps mismatch chops audio"): the slice channel **must run at the source fps**.
- What is routed is the source's **draw_frame tree**, not a rasterised image: `core/video_channel.cpp:80-95` and `core/producer/stage.cpp:198-217` signal the layer/channel frame trees; the destination mixer re-renders them. Good for quality (full source resolution is kept, as the maintainer notes in #870), bad for cost: **N slices of one source re-render the entire source tree N times** (every source layer × every slice, clipped by the crop polygon but still one draw each).
- Routed frames carry audio. N route layers into one channel sum the same audio N times (the `fix_stream_tag` code in the producer only distinguishes it from the source's). Slice layers need `MIXER VOLUME 0`, or only one carries audio.
- A new channel costs a whole 50 fps compositor on the single GL thread: WO-502 §3 (`device.cpp` has ONE `io_context` thread; seven channels at 50 fps exceeded it by ~7 %). WO-502 §5b's forced `gpu-texture` regained the headroom on the seven-channel production layout, so an eighth channel (the slice canvas) is the thing that would spend it again. Upstream's own commit adding `needs_host_frame` (`7dd328722`) states the OpenGL mixer "always reads back", i.e. the aux channel also pays a GPU→host readback of its canvas raster every frame (3840×1080×4 B ≈ 16.6 MB/frame, ~830 MB/s at 50p), even though its screen consumer is `gpu-texture`.
- Adding a channel is a **config-time** act: first use (or any change of the slice channel's raster/fps) = regenerate `casparcg.config` + Caspar restart. After that, edits are plain AMCP, no restart. The dev box has one Caspar channel (memory) so (a) can only be verified there after an apply+restart.

### 1.3 Upstream search (`gh`, `CasparCG/server`)

| Item | State | Relevance |
|---|---|---|
| #1587 "subregions for non-decklink consumer" | open | Asks for several subregions per DeckLink and subregions for NDI; says the user currently uses "several routing channels and transform properties". Direct demand for the PR. |
| #870 "Route only a portion of channel / layer" | closed | Maintainer: layer routes are pre-compositing, so route then scale+crop on the destination layer keeps resolution; "not worth doing as a route portion". Confirms (a) is the intended workaround. |
| #1433 "custom channel resolutions & subregion copy" (merged) | merged | Introduced the DeckLink subregion. Body: "No scaling/rotation support, for that use a dedicated channel and route." |
| #1493 "decklink consumer secondary ports" (merged) | merged | The `<ports>` mechanism HighAsCG already uses. |
| #1700, #1689 DeckLink v210 subregions | merged | Subregion code is actively maintained upstream. |
| #1718 "Screen consumer enhancements: flexible aspect ratio, mipmaps, multi-display spanning" | closed (author withdrew, reviewer pushed back on duplicating mixer functions) | Same file, same use case (LED walls spanning heads). Lesson: do not add per-consumer features that duplicate MIXER commands; slices are not a duplicate. Our fork already carries its refactor (`2004764a0`). |
| #1714 "OAL + screen consumer fixes" | merged | Screen consumer is touched regularly; a slice PR will be rebased on it. |
| #1638 "amcp: add APPLY command" | merged 2025-06-18 | The live-control hook. |
| #1813/#1814 clip/crop leak | fixed 2026-09-30 | Needed in the fork for (a). |
| #1677 Vulkan | merged 2026-05 | The accelerator is now pluggable; a slice stage in the *consumer* is accelerator-independent (the screen consumer has its own GL context). |
| searches for "keystone", "warp", "projection mapping", "edge blend" | no PR/issue | Nobody has proposed warp or blend. |

No existing PR or branch implements slices, quads or an output-mapping stage.

### 1.4 Corrections to what the owner was told

1. "DeckLink `<subregion>` only at config time and needs a restart" — correct. Add: one rect per port, CPU copy at 1:1, and its `dest-x/y` is unused by HighAsCG (hard-coded 0), so *placement* of a 1:1 rect on an SDI frame needs no Caspar work at all, only generator/UI work. Several rects on one port need C++ (#1587).
2. "route:// plus MIXER CROP/FILL/PERSPECTIVE; costs an extra channel" — correct, with three costs the summary left out: N× source-tree re-render, audio duplication (VOLUME 0), and a missing upstream fix (#1814) in the fork.
3. "A Caspar fork PR adding multi-slice to the screen consumer, no extra channel" — correct for **screen consumers (GPU heads)**; it does **not** serve SDI. DeckLink gets frames on the host, and the cheapest honest improvement there is multi-subregion (1:1, no scale/rotate).
4. New: the live-update mechanism the PR needs is already upstream (`APPLY`, #1638).
5. New: the project's own `rotation`/`targetPos` slice fields never reached any backend; the slice feature is partly a UI/model exercise that WO-18 started and abandoned.

---

## 2. Proposed design

### 2.0 One data model, two backends

The editor and the stored model must not depend on which backend draws it. Resolume's terms map directly: **mapping-node outputs = Resolume Screens; slices = Resolume Slices** (input rectangle → output placement, optional warp).

New `node.settings.slices[]` (supersedes `settings.mappings[]`; the migration is in Phase 1):

```jsonc
{
  "id": "slice_ab12",
  "name": "Left wing",
  "outputId": "out_2",               // which output (screen) it is drawn on
  "enabled": true,
  "source": { "kind": "feed" },       // v1: always the node's input feed. Later: { "kind":"route", "value":"route://3-10" }
  "src":  { "x": 0, "y": 0, "w": 1536, "h": 1024 },        // px of the input feed raster
  "dst":  { "rect": { "x": 100, "y": 40, "w": 960, "h": 640 },   // px of the OUTPUT raster
            "rotation": 0, "flipH": false, "flipV": false,       // rotation about the rect centre, degrees
            "warp": [[0,0],[0,0],[0,0],[0,0]] },                 // corner offsets in dst px (ul, ur, lr, ll); keystone/perspective
  "opacity": 1.0,
  "feather": { "l": 0, "t": 0, "r": 0, "b": 0 },            // dst px; (b) only in phase B3, (a) via mask image later
  "z": 0
}
```

The compiled form each backend consumes is **the quad**: `sliceQuad(slice) → { src:{x,y,w,h}, dst:[ul,ur,lr,ll] in output px, opacity, feather }`. User fields (rect, rotation, flip, warp) are UI conveniences; one pure function turns them into four corners.

`settings.outputs[i]` stays the physical sink description (mode, label), plus `pos:{x,y}` for GPU heads (their position on the window canvas, today inferred from the legacy rect). Legacy `mappings[]` migrates to one slice per output: `src = rect`, `dst.rect = {0,0,w,h}` (for GPU heads `pos = rect.x,y`), `rotation` ignored (it never did anything; log how many nonzero values were dropped).

**Backend planner (pure function, per output):**

| Output slice set | Backend |
|---|---|
| exactly one slice, `dst` size == `src` size, no rotation/flip/warp/feather, sink = DeckLink or GPU head | **direct** — today's `<subregion>` / xrandr path, unchanged, no extra channel (all existing projects land here, zero regression) |
| several 1:1 rects, sink = DeckLink | **multi-subregion** (B5, needs C++/#1587) or fall back to (a) |
| anything else, sink = GPU head | **screen-slices** (b) when the running Caspar advertises it, else (a) |
| anything else, sink = DeckLink/NDI/other | **route-slices** (a) |
| per-slice `source` other than the feed | (a) only |

### 2.1 Open design constraint worth stating once

Under (a) and (b) the *source* of every slice is the program channel's composited raster (`route://<ch>` or its texture). A slice cut from the **channel** sees whatever the channel shows; a slice cut from a **layer** (`route://ch-layer`) is possible only in (a).

### 2.2 Path (a) — server-side slice editor on existing AMCP primitives (ships with the current binary + one patch)

**New code (all under the 500-line limit, split like this):**

- `src/config/mapping-slices-model.js` — normalise, migrate legacy `mappings[]`, `sliceQuad()`.
- `src/config/mapping-slices-geometry.js` — pure math: homography from the src rect corners to the dst quad, the extension to the full content square, normalised CROP/FILL/PERSPECTIVE values.
- `src/config/mapping-slices-plan.js` — the planner table above; groups slices per output; decides which outputs need a slice channel and what its video-mode is (output raster, **source fps**).
- `src/config/config-generator-slice-channel.js` — emits the slice channel (custom video-mode from the output size, one consumer per sink: `<screen>` for a GPU head with `gpu-texture` forced on, `<decklink>` full-frame for SDI), modeled on `buildPixelmapChannel` (WO-242). Channel allocation goes through `src/config/routing-map.js` like the other utility channels.
- `src/engine/mapping-slices-apply.js` — the AMCP side, modeled on `operator-gui-channel.js:136-200`: per slice layer `PLAY C-L route://S` (only if the route changed), `MIXER C-L VOLUME 0`, `CROP`, `FILL`, `PERSPECTIVE` (only when warp/rotation is non-trivial), `OPACITY`, all with `DEFER`, then **one** `MIXER C COMMIT` so every slice changes in the same frame; STOP+CLEAR hygiene for layers beyond the current count; serialised per channel; re-applied on Caspar connect (same hook as multiview re-apply, `src/engine/multiview-reapply.js`, WO-156).
- API: `POST /api/device-view` with `{ updateMappingSlices: { nodeId, slices } }` next to the other mapping handlers in `src/api/routes-device-view.js:161-164` (router order and raw-JSON-body rules from memory apply: `parseBody` the string, curl the new route on the box). The handler persists, then applies live; it answers `casparRestartNeeded: true` **only** when the planner's channel set or a channel raster changed. Slice edits themselves must not enter `config-reload-signature.js` (that would recycle the AMCP connection on every drag; its own comment explains why `deviceGraph` is excluded).

**The per-slice math (S1 must prove it).** Source raster `Win×Hin`, output raster `Wout×Hout`, slice `src = (sx,sy,sw,sh)`, destination quad corners `D0..D3` (ul, ur, lr, ll) in output px.

1. `CROP sx/Win  sy/Hin  (sx+sw)/Win  (sy+sh)/Hin` (normalised to the source content square; route layers fill the unit square regardless of the destination raster).
2. Axis-aligned, unrotated slice (the 90 % case): `FILL fx fy kx ky` with `kx = (dw/Wout) / (sw/Win)`, `ky = (dh/Hout) / (sh/Hin)`, `fx = dx/Wout − (sx/Win)·kx`, `fy = dy/Hout − (sy/Hin)·ky`. No PERSPECTIVE.
3. Rotated, flipped or warped: compute the homography `H` mapping the src rect's corners onto `D0..D3`, apply `H` to the four corners of the **whole** content square, normalise by `Wout,Hout`, and send these as `PERSPECTIVE` (with `FILL 0 0 1 1`); CROP stays step 1. 90° rotations and flips are exact corner permutations; other angles and keystone use the general case.
4. Z-order = layer order; the slice's `z` sorts the layer numbers.

Caveat to resolve in S1: `PERSPECTIVE` is a bilinear vertex displacement plus per-quad q-correction (transforms.cpp:131-151, 256). For a *convex* quad the q-corrected result is the exact projective map; for strongly concave warp quads it is not. Restrict `warp` to convex quads in the editor.

**Quality/latency/cost (a):** crisp (the source tree is re-rendered at its own resolution); +1 to 2 frames of route latency (20–40 ms at 50p, to be measured with a flash probe, S3); one extra 50p channel plus N× source-tree re-render plus a canvas-sized readback; audio must be muted per slice layer; first use needs a Caspar restart; per-slice colour/blur effects free; per-slice different sources free; feather needs a gradient mask image on a key layer (2 layers per feathered slice; the keyer direction must be verified on the box) — defer.

### 2.3 Path (b) — Caspar fork change: slices in the screen consumer, live over `APPLY`

**Goal.** One `<screen>` consumer draws N (src rect → dst quad) slices of the channel's frame into a window canvas of its own size. No extra channel, no extra mixer pass, no route latency, live-editable, per-slice perspective and (later) feather. GPU heads only.

**Touch points (fork paths; the same files exist in upstream master with the same names, verified):**

| # | File | Change |
|---|---|---|
| 0 | `core/consumer/frame_consumer.h`, `frame_consumer_registry.cpp`, `core/consumer/output.h/.cpp`, `protocol/amcp/AMCPCommandsImpl.cpp` | **Cherry-pick upstream `f7dcc0322` (#1638)**: `frame_consumer::call()` default, `output::call(index, params)`, `APPLY`. +61/−8. Applies cleanly or with trivial fuzz; do first, it is useful alone. |
| 1 | `modules/screen/consumer/screen_consumer.cpp` `configuration` (`:80`) | `struct slice { double src[4]; double dst[8]; float opacity; float feather[4]; }`, `std::vector<slice> slices;`. Reject combination with `sbs_key`, `key_only`, datavideo `colour_space` (they rely on the fixed quad) at parse time with a clear log line. |
| 2 | same, `create_preconfigured_consumer` (`:1091-1170`) | Parse `<slices><slice><src>x y w h</src><dst>ulx uly urx ury lrx lry llx lly</dst><opacity/><feather>l t r b</feather></slice>…</slices>`; log what was read (the consumer logs every option today). Config is the restart-safe baseline. |
| 3 | same, `class screen_consumer` (`:175-`) | `std::mutex slices_mutex_; std::vector<slice> pending_slices_; std::atomic<bool> slices_dirty_{false};` and `bool set_slices(std::vector<slice>)` validating (finite numbers, ≤ 64 slices, convex quads, src inside the channel raster after clamping). |
| 4 | same, `calculate_aspect()` (`:672`) → new `build_slice_coords()` | When `slices` is non-empty fill `draw_coords_` with 6 vertices per slice: NDC position from dst px over the canvas (`screen_width_/height_` configured size, so a resized window still maps correctly), texture `{u,v}` from src px over the channel `format_desc_` size, `texture_q` from the corner weights (same formula as `fill_texture_q_for_quad`). Stretch/aspect logic is bypassed in this mode. The slice vector swap happens on the render thread at the top of `do_tick` when `slices_dirty_` (no GL calls from the AMCP thread). |
| 5 | same, `draw()` (`:617`) | Already generic over `draw_coords_.size()`. Add `glEnable(GL_BLEND)` + opacity uniform (or per-vertex alpha) when any slice has `opacity<1` or feather. Clear stays `glClear` so uncovered canvas is black (Resolume behaviour). |
| 6 | `modules/screen/consumer/screen.frag` | `texture(background, TexCoord.xy / TexCoord.w)` (q-divide; identical to the old result when q = 1). Phase B3: feather from a second varying (quad-local `lu,lv`, needs a custom vertex struct instead of `frame_geometry::coord`): `alpha = clamp(min(lu·W, (1−lu)·W, lv·H, (1−lv)·H) / feather, 0, 1)` per edge, with a gamma exponent for blend overlap. |
| 7 | same, `screen_consumer_proxy` (`:992-1040`) | Override `call(params)` (from #1638): parse `SLICES SET <n> <16 numbers per slice>` and `SLICES CLEAR`; call `consumer_->set_slices`; return true/false (APPLY maps it to 202/403). Add `state["screen/slices"] = count` and one entry per slice to `state()` so `INFO` and OSC show the live set. |
| 8 | `shell/casparcg.config` | Document `<slices>` in the `<screen>` reference block. |

AMCP surface (all numbers, so AMCP escaping is a non-issue; one atomic call):
`APPLY 1-600 SLICES SET 2  0 0 1536 1024  0 0 960 0 960 640 0 640  1 0 0 0 0   1536 0 1536 1024  100 40 …` (per slice: `srcX srcY srcW srcH ulX ulY urX urY lrX lrY llX llY opacity featL featT featR featB`). `APPLY 1-600 SLICES CLEAR` returns to stretch/fill. (`1-600` = channel 1, screen device 1: `600 + screen_index`.)

**Size estimate:** C++ ≈ 350–450 changed lines (≈ 250 for rows 1–7 without feather, ≈ 100 for feather, ≈ 60 docs/state) + the 69-line cherry-pick. One day to write, one to two days of build/test cycles (the fork build is incremental `cmake --build ~/caspar-build/build-v2 -j24`, then the swap + node restart procedure in memory *caspar-build-v2-location*; the live tree is the 26.04 `build-26.sh` build, keep `casparcg.prev`). HighAsCG side: generator emits `<slices>` into the program `<screen>` (config baseline), apply code sends `APPLY … SLICES SET` live and again after every Caspar (re)connect, planner gate "does this Caspar accept `APPLY`?" (probe once with a harmless `APPLY 1-600 SLICES SET 0` on connect and cache) — about 1.5 days.

**Upstream-ability.** Three small, independently useful PRs, each rebased on master (`screen_consumer.cpp` there is 914 lines and structurally the same as ours, `draw_coords_` at `:155`):

1. *Screen consumer: `<slices>` config* (rows 1, 2, 4, 5, 6 without feather, 8). Pitch: generalises `sbs_key`'s two-quad draw to N quads; solves LED-wall / multi-projector layouts without an extra channel — the use case in #1587, #1718, #1284, #870. Does not duplicate any MIXER command (the objection that sank #1718's brightness/saturation).
2. *Screen consumer: live `APPLY … SLICES`* (rows 3, 7) on top of #1638 — which is the stated purpose of that PR.
3. *Feather/blend* and *DeckLink multiple subregions* (#1587) as separate follow-ups.

Risks: upstream may prefer a Vulkan-aware screen consumer later (the `needs_host_frame` seam), so keep the slice geometry in a small header (`slice_geometry.h`) independent of GL calls; reviewers will ask for config examples and a note on interaction with `stretch`. Maintainer stance to expect (from #870/#1433): "use a route channel for scaling" — answer: that costs a channel and a frame per #1587.

**Quality/latency/cost (b):** one bilinear resample of the already-composited canvas (identical to 1:1 when sizes match; slightly softer than (a) when scaling because (a) re-renders from source layers); zero added latency and no extra channel; GPU cost ≈ N quads; live edit without restart or flicker; keystone/perspective per slice via q; feather cheap; per-slice colour only via extra uniforms (no blur); slices see only that channel's frame; GPU heads only.

### 2.4 Path (c) — Godot slice editor (Resolume Advanced Output)

Follows WO-608 R1–R5 (memory *godot-ui-layout-rules*): properties live in the **shared right Inspector**; the two large canvases cannot fit in it, so they take the Devices tab centre when a mapping node is selected and "Edit slices" is pressed (same pattern as the multiview editor owning the tab). Open question Q1 below.

- **Input canvas (left):** the live picture of the node's feed (`VideoSurfaces.acquire("ch<N>")`, as `features/multiview/mv_canvas.gd:41-60` leases the multiview channel) with every slice's `src` rect drawn on it; draw a new rect by dragging on empty space; move/resize with edge/corner handles; snap to 8 px (`features/live/compose_tile_math.gd` has the snap/clamp rules) and to other rects; numeric entry through the existing math inputs.
- **Output canvas (right):** a tab per output (screen) showing its raster (SDI mode or head size), slices as textured quads (the feed picture sampled by src, drawn as a `Polygon2D`/`MeshInstance` so the user sees the result), drag to move, handles to scale, a rotate handle, corner handles for warp (convex-clamped), flip buttons.
- **Inspector page** (extends `mapping_page_model.gd` / `mapping_controls.gd`): slice list, per slice: name, output, enabled, Src X/Y/W/H, Dst X/Y/W/H, rotation, flip, 4 warp corners, opacity, (later) feather, z up/down, duplicate, delete. A "backend" read-out per output (direct / multi-subregion / screen-slices / route-slices, and "needs Caspar restart" when the planner says so).
- **Files (each under 500 lines):** `features/devices/slice_model.gd` (pure: list ops, `sliceQuad` port, goldens against the JS implementation for the same fixtures), `slice_canvas_src.gd`, `slice_canvas_dst.gd`, `slice_flow.gd` (API calls + confirm of restart), additions to `mapping_page_model.gd` (split first; it is 170 lines but `mapping_controls.gd` is 219). Tests in `godot/client/tests/` with goldens like `tests/golden/devices_mapping.json`. A render probe (`--probe-*` flag) for the canvases (memory: probes need the real client).
- Web client: not planned. The Godot GUI is primary; the web mapping editor stays as is (Q4).
- Estimate: model + inspector 1.5 d, source canvas 1.5 d, output canvas with warp 2.5 d, flow/API/goldens 1 d ≈ 6–7 d.

### 2.5 Phases

| Phase | Scope | Backend binary | Est. |
|---|---|---|---|
| **P0 Quick wins + spikes** | (i) cherry-pick **#1814** (crop leak) into the fork, rebuild, deploy per the build memory. (ii) S1: prove the CROP/FILL/PERSPECTIVE math with a pixel probe on a 3-slice test pattern on a spare channel (box is a dev machine; disruptive tests OK). (iii) S2: stop hard-coding `destX/destY: 0` — DeckLink 1:1 *placement* works today; expose `dst.x/y` for a single slice per SDI output behind the new model. | fork + #1814 | 1.5 d |
| **P1 Model + planner + path (a)** | `mapping-slices-*` modules, migration of `mappings[]`, API `updateMappingSlices`, slice-channel generator, live apply, reconnect re-apply, hygiene, offline tests, smoke guards, restart-needed signalling. Works on any output type. | fork + #1814 | 3–4 d |
| **P2 Godot slice editor (c)** | Section 2.4, backend-agnostic (talks to the P1 API). Can start in parallel with P1 once the model is frozen. | none | 6–7 d |
| **P3 Path (b) in the fork** | Row 0 cherry-pick (#1638) then rows 1–8, feather last; planner switches GPU-head outputs to screen-slices when `APPLY` is accepted; (a) stays for SDI and per-slice sources. | new fork build | 4–5 d incl. build cycles and box verification |
| **P4 Upstream PRs** | PR 1 (config), PR 2 (APPLY slices), follow-ups; DeckLink multi-subregion (#1587) as a separate item (≈ 1.5 d C++ for both SDR and v210 strategies) — decide with the owner whether SDI 1:1 multi-rect is worth it before (a) covers it. | n/a | 2 d prep + review latency |

### 2.6 Recommendation and order

1. **P0 now** (a crop fix the fork lacks is a latent bug for every CROP user, independent of this feature; S1 gives the facts the estimate depends on).
2. **P1 (a) + P2 (c) next.** (a) automates exactly the owner's workaround on the binary he has, and the model/UI are shared with (b). Ship the model so that the *planner* decides the backend; the user never chooses.
3. **P3 (b) in parallel once P1's model is frozen** — it is the "no extra channel" answer the owner asked for and the only one that keeps the 7-channel GL budget (WO-502) intact. It serves the GPU-head case, which is the multi-monitor/LED-processor-over-HDMI case that motivates this.
4. **P4 upstream** after (b) has run on the box for a while.

Why not (b) only: it cannot serve SDI and cannot take per-slice sources, and the editor/model work (P1/P2) is needed either way. Why not (a) only: the owner explicitly wants no extra channel and a PR; (a) spends a channel's GL-thread share and a readback and costs 1–2 frames.

### 2.7 Test plan

**Offline (CI, add files to the curated list `tools/ci/offline-test-files.js`):**
- Geometry: for random src/dst pairs the CROP/FILL values map the src rect corners onto the dst corners to 1e-9; 90° rotations and flips are exact corner permutations; homography round-trip; convexity check rejects bow-ties.
- Planner: legacy single-rect outputs stay on the direct path with byte-identical `screen_N_decklink_tiles` and `mappingGpuOutputs` (golden of the generated XML before/after for the existing fixtures: `src/config` generator tests and `godot/client/tests/golden/devices_mapping.json`); mixed outputs; per-slice source forces (a); no `APPLY` support forces (a).
- Migration: legacy `mappings[]` → slices and back-compat read; `rotation` ignored and counted.
- AMCP line snapshots for 1, 3 and 8 slices (PLAY only on route change, `VOLUME 0`, DEFER + one COMMIT, hygiene STOP/CLEAR); XML snapshot for `<slices>`.
- Router/handler: new route reached through the real router (memory: router matches in order; handler-only smokes miss it); body passed as `JSON.stringify` (memory: handlers get a raw string).
- Source-text smokes follow the repo convention (`readFileSync` + regex): no `destX: 0` literal left in `pixel-mapping-config.js`; slice edits not in `config-reload-signature.js`. 500-line check `node tools/ci/check-max-file-lines.js`.
- Godot: golden tests for `slice_model.gd` vs the JS fixtures; headless `GUT`-style tests like `tests/test_devices_mapping.gd`.

**On the box (record each as a numbered line in the WO when it runs):**
- S1 (math): 3-slice test pattern (distinct solid colours with a 1-px white border and a corner marker per slice), slice channel at the output raster, `PRINT` the slice channel and probe the expected regions. **Calibrate the probe first** (memory *calibrate-pixel-probes*): confirm it separates a known-good from a known-bad frame, check the alpha plane, view the frame; ffmpeg crop clamps when X+W exceeds the frame width.
- Crop-leak regression: a 40×40 px slice cut from a 3840-wide canvas shows exactly 40×40 px (before/after #1814).
- S3 (cost): `tools/dev/measure-playback-rate.js` tick rates with and without the slice channel; N = 1, 4, 8 slices; flash-probe latency of (a) vs the direct path.
- (b): windowed `ADD 1 SCREEN … ` with `<slices>`, `APPLY 1-600 SLICES SET …` during playback: no window recreation, no dropped-frame tag, `INFO` shows the slices; screenshot (`import`/`xwd -id`, no pointer automation) and compare per-slice regions with the same probe; `SLICES CLEAR` restores fill; Caspar restart re-applies from XML; kill-and-reapply after node restart.
- GL thread budget: the same measurement on the seven-channel production layout with (a) enabled vs (b), to put numbers into WO-502's table.
- Restart-needed signalling: first slice on a SDI output reports `casparRestartNeeded`; later edits do not.

**Owner QA (kept to the minimum):** one pass of the editor against a real two-head wall or LED processor after P2/P3.

---

## 3. Open questions for the owner

1. **Where does the editor live?** WO-608 says properties go in the shared right Inspector. The two canvases (input picture with src rects, output canvas with dst quads) need the width of the centre area. Proposal: the Inspector holds the slice list and numeric fields; the canvases open in the Devices tab centre via "Edit slices". Is that acceptable, or do you want it as a popup over the tab?
2. **SDI outputs:** is free placement of 1:1 rects on an SDI frame enough (cheap: placement now, multi-rect later via upstream #1587), or do you need scaling/rotation/keystone on SDI too (that means path (a), one extra channel per mapped output group, and about 1–2 frames more latency)?
3. **Channel budget:** the production layout runs seven channels (WO-502). Is one more channel acceptable when a mapping node needs path (a), or should the planner refuse (a) and tell you to use GPU heads when the budget is exceeded?
4. **Web client:** the web mapping editor still exists and writes `mappings[]`/`rotation`. Should it be kept working via the migration (read-only slices) or can it be left untouched?
5. **Slice sources:** is "cut from this node's feed" enough for v1, or do you want a slice to take any source (another PGM, a live input, a layer) like Resolume's per-slice input selection? That makes (a) the only backend for those slices.
6. **Edge blend and soft edges:** is feather per slice enough, or do you need projector-style edge blending with gamma across overlapping slices (still cheap in (b), a mask-image workaround in (a))? Masks (non-rectangular) are not in this WO.
7. **Warp quality:** are 4-corner keystone slices (convex) enough, or do you want grid warp (Bezier/mesh)? Grid warp changes the C++ design from one quad to a tessellated mesh per slice (more vertices, same shader) and is a separate WO.
8. **Which monitors/heads?** For (b) the window canvas becomes independent of the channel raster (the channel can stay at the destination size while the window spans the head union). Do you want one window per mapping node or the current single program window carrying all slices? Two nodes on one feed need two screen consumers.
9. **Fork policy:** (a) needs #1814 and (b) needs #1638 plus new code in a fork that is 2.5.1 plus patches. OK to keep carrying both as commits on `wo742-shm-producer` (the WO-867 pattern) and open the upstream PRs from a clean branch off master?
10. **Legacy `rotation` values** in existing mapping nodes never took effect. The migration drops them; confirm that is fine (no project depends on them).

---

## 4. What was done (30.10)

Backend = path (b) for GPU heads (the planner's default case). SDI = placement only (Q2). Path (a) is planned but not built.

**Model, migration, planner (pure, `src/config/`)**
- `mapping-slices-model.js`: the `settings.slices[]` model from §2.0 and its normaliser. It migrates legacy `mappings[]` to one 1:1 slice per output (legacy `rotation` dropped and counted, Q10). It writes the legacy `mappings[]` mirror back, and `foldLegacyEdit` takes web-editor edits of that mirror back into slices, so the web editor keeps working (Q4).
- `mapping-slices-geometry.js`: `dstQuad`, which returns the screen corners (rect, then rotate about the centre, then warp per corner, then the flip permutation) in SOURCE corner order. Also `isConvexQuad`, `isOneToOne` and the homography.
- `mapping-slices-plan.js`: the backend for each output: direct, screen-slices, route-slices (planned only), refused or idle.
  - Over the channel budget, route-slices is refused (Q3).
  - Feather is stored as screen sides. `quadFeather` swaps it for flips, because the fork feathers along the quad edges.
  - One window per node (Q8): when a node has a slice window, its other GPU heads that show a slice join it, so no PGM window has to cover the same heads.
- `mapping-slices-windows.js`: `sliceWindowsFromConfig` gives device 41+k, which is consumer index 640+k. It also holds the 21-number `SLICES SET` contract (`slicesSetParams`, `sliceNumbers`), `slicesXml` and `planConfigSignature`, which decides restart vs live edit.
- `pixel-mapping-config.js`: DeckLink tiles take `src`/`destX`/`destY` from the plan, so a single SDI slice can be placed anywhere (the hard-coded `destX: 0` is gone). `utils/mapping-gpu-os-layout.js` `sliceHeadRects`: a screen-slices head sits at its output `pos`.

**API and engine**
- `api/device-view-crud-mapping.js`: `updateMappingSlices` (and `outputPos`) answer `casparRestartNeeded` when the config signature changes; otherwise they apply live. `api/routes-device-view.js`: GET returns migrated slices plus `mappingSlicePlans`.
- `engine/mapping-slices-apply.js`: `APPLY <pgm ch>-<640+k> SLICES SET …`. The set is sent whole, serialised per node. A refusal is reported, never thrown. `config/routing-setup.js` calls `reapplyAllMappingSlices(self)` on every (re)connect.

**Generator (P3, new `config-generator-slice-windows.js` plus two one-line hooks)**
- `applySliceWindowsToScreens` (called from `build-caspar-generator-config.js` after `reconcileDecklinkScreenConsumerFlags`) writes `screen_N_slice_windows`. It turns the PGM `<screen>` off when every GPU head that screen reaches is in a slice window.
- `sliceWindowScreensXml` (hook in `config-generator-consumer-attach-screen.js`, PGM `<consumers>`) writes one `<screen>` per window on the feed's PGM channel:
  - `<device>41+k</device>`;
  - x/y = the window's bounding box of heads, which are the same numbers xrandr gets;
  - window-sized, stretch none;
  - vsync/gpu-texture policy;
  - the `<slices>` baseline.
- Legacy direct-only nodes generate byte-for-byte what they did before.

**Godot editor (P2, `godot/client/features/devices/`)**
- `slice_model.gd` (port of the JS model and geometry, pinned by goldens), `slice_page_model.gd`, `slice_flow.gd` (coalesced saves, restart vs live status), `slice_inspector.gd` (slice list and RULES.md number fields in the Inspector, Q1), `slice_canvas_math.gd`, `slice_canvas_src.gd` (live feed picture via `VideoSurfaces` `pgm<N>`, draw/move/resize, 8 px snap, Alt for no snap), `slice_canvas_dst.gd` (textured quads through the homography; move, scale, rotate knob with Shift for 15°, convex-clamped warp corners) and `slice_editor.gd` (both canvases in the Devices tab centre: output tabs, Transform/Warp, Flip H/V, Reset warp, Done).
- Edited: `mapping_controls.gd` (slice section; Src X/Y/W/H fields removed from the Godot page), `mapping_page_model.gd`, `mapping_graph.gd` (remove/duplicate output carry slices) and `devices_tab.gd` (hosts the editor).

**Caspar fork (`~/caspar-build/src-v2`, branch `wo742-shm-producer`, on top of `e8d457ec6`; `e4e1e7ef3`/`2747aaa47`/`e8d457ec6` kept, the 19 uncommitted WO-820/800 entries untouched)**
- `ce7132e50`: cherry-pick of upstream #1638 (`APPLY`, `frame_consumer::call`).
- `deac375bb`: screen consumer slices. These are N src rects onto perspective-correct dst quads, with opacity, feather along the quad edges, a per-slice clip and the `<slices>` XML. `APPLY … SLICES SET n <21 nums>` / `SLICES CLEAR` answer 202/403, the old binary answers 400, and `INFO` shows `screen/slices`.
- Patch: `caspar/patches/wo869-screen-slices-apply.patch`. Build: `~/caspar-build/build-26/shell/casparcg`, md5 `ab668967e2ba73b8f67956a9356b92a7`. Not deployed: the live `bin/casparcg` is still `fb955e76` (WO-847).

## 5. What was VERIFIED

- **Node smokes** (all in `tools/ci/offline-test-files-3.js`): wo869 model 16/16, plan 17/17, api 5/5, slice-golden 1/1, slice-windows-generator 5/5 = **44/44**.
  - The api smoke goes through the real `handlePost`/`handleGet` with JSON.stringify bodies.
  - The generator smoke pins the exact `<screen>` block, PGM-window-off and -kept cases, no window without a feed, no stale keys, and the hook source text.
- **Curated offline suite** `node tools/ci/run-offline-tests.js`: 4881 tests, 4876 pass, **0 fail**. `node tools/ci/check-max-file-lines.js`: 0 files over 500 lines.
- **Godot suite** `run_tests.gd`: **23885 passed, 0 failed**, including `tests/test_devices_mapping_slices.gd`, which compares against the golden `tests/golden/devices_mapping_slices.json` written by the JS smoke.
- **GUI e2e** `16_wo869_mapping_slices` (real drags in the sandbox, pixel-map fixture picture): **11/11**.
  - Run 30.10 twice; the final run is after the P3 planner change.
  - A combined run with 02_outputs, 10_cable_pull and 11_wo843_sweep: 30 passed, 0 failed.
  - Screenshots: `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo869/e2e2/shots/01…11_*.png`, plus `…/wo869/e2e4/shots/` from the final run.
- **Fork on a scratch Caspar** (Xvfb :169, AMCP 5264, killed by PID; evidence in `…/scratchpad/wo869/fork/`):
  1. with no slices the picture is pixel-identical to before;
  2. 5 config slices: the projective probe finds 0 bad points;
  3. live APPLY answers 202 and the window is not recreated;
  4. 17 invalid inputs answer 403;
  5. CLEAR and SET 0 restore the full frame;
  6. the opacity/feather ramp is exact;
  7. per-window APPLY `1-601` works;
  8. no measurable fps cost.
- **HighAsCG generator → scratch Caspar end to end** (`…/scratchpad/wo869/gen/run.sh`, binary md5 `ab668967…`):
  - The config is built by the real `buildCasparGeneratorFlatConfig` + `buildConfigXml` from a 2-output GPU node with 4 slices (scale, flipV, keystone, 90° rotation). The PGM channel carries only the device-41 slice window (PGM window off). For the probe, gpu-texture was switched to false and audio removed.
  - Probe of the 3840×1080 window: covered ok=47193, **bad=0**; black ok=35636, bad=0.
  - A live edit through the real `updateMappingSlices` handler gave `casparRestartNeeded:false` and one `APPLY 1-640 SLICES SET 4 …`. The scratch Caspar answered `202 APPLY OK`, and `INFO 1` shows 4 slices.
  - Probe after the edit: covered ok=45192, **bad=0**. The old expectation against the new picture gives bad=4585, so the probe tells the two apart. There was one screen-consumer window before and after.
  - Screenshots: `…/wo869/gen/g1-config.png`, `g2-apply.png`.
- Not touched: the live device graph and project, Apply on the box, the highascg service, display :0.

### 5.1 Real heads on the box (30.10, after the WO-868 switch)

Rig: Dioda PGM (ch 2, 3840x1792) → test node `mapping_mvv97x1j_1` → `out_1` (custom 3840x1792) → DP-0. Slices:
- `sA`: src left half → dst right half;
- `sB`: src right half → dst left half, `flipH`.

The probe image was 3840x1792 quadrants with a white marker top-left and a cyan marker top-right (`PLAY 2-200`). Evidence is
in `scratchpad/wo869live/`.

**Two defects found before the first Apply, fixed:**
1. **The mapping canvas took the left edge.** `/api/caspar-config/generate` put the slice window at x=0. The journal
   layout had `operator_gui_1 DP-4 pos=3840,0` and `mapping→GPU DP-0 pos=0,0`. Applying would have undone "Operator GUI
   first", which the owner wants on always.
   - WO-868 only refused this combination at switch time (`mapping_gpu_outputs`); a node added afterwards was not
     covered.
   - Fix, `os-layout-calculator.js` `operatorFirstLead`: with operator-first the operator GUI heads keep x=0, and the
     mapping rows (and so their bbox) shift right by the heads' width.
   - `os-layout-calculator-offset.js`: with a lead, the operator GUI is not shifted, and the others move by the canvas
     span (`maxX - lead`), because their cumulative x already holds the lead.
   - `build-caspar-generator-layout-sync.js` shifts every `screen_N_slice_windows` entry by `layout.mappingCanvasOffsetX`.
     The key is only set when non-zero, so the WO-868 OFF/ON layout goldens stay byte-identical.
   - The WO-868 refusal is removed (`operator-first-plan.js`).
2. **The PGM window stayed on.** `applySliceWindowsToScreens` took the first destination with
   `mainScreenIndex+1 === n`. That was the Operator GUI destination (also index 0), and its own DP-4 cable counted as
   "another GPU head" of Dioda.
   - Fix: operator_gui / multiview / stream / host_channel destinations are skipped (`NOT_PROGRAM`).
- Smoke: `tools/smoke/smoke-wo869-operator-first-slices.test.js` (3/3; box rig in miniature, operator-first and legacy order).
  It is in `tools/ci/offline-test-files-3.js`.
- Related smokes (wo868*, wo869*, os-layout offset, operator-gui 4k rect, wo242/437/439 mapping, xrandr verify, wo515):
  130/130.
- `smoke-mapping-gpu-os-layout-2.js` and `smoke-device-graph-output-mapping.js` fail identically at HEAD. They are not
  in the curated list, and this change does not affect them.

**Real-head results** (node restarted onto the fix, then `POST /api/caspar-config/apply`):
- **Generated config vs live:** the only diff is the Dioda PGM `<screen>` (device 1) replaced by the slice window
  (device 41) at `<x>1920</x>` 3840x1792 with the two `<slices>`.
- **Apply:** `ok`, `restartSent`, `reconnected`, `layoutApplied`. xrandr stays DP-4 `+0+0`, DP-0 `+1920+0`. `INFO 2` shows
  `port_640` (screen consumer, gpu_texture true) with both slices.
- **Config baseline on the head:** x11grab of DP-0 (1920,0 3840x1792) against the expected mapping of `caspar print 2`
  (halves swapped, right half mirrored): **107520 points, bad=0**.
  - Control: the unsliced print gives bad=107520.
  - The cyan marker moved from x 3440 to x 100 (`dp0-slices1.png`).
- **Live edit:** `updateMappingSlices` with `sA` squashed into the top half → `casparRestartNeeded:false`,
  `APPLY 2-640 SLICES SET 2 …` → `202 APPLY OK`.
  - Same Caspar PID, same X window id (no recreation).
  - Probe: bad=277 of 107520, all on colour edges (rows 200/448, bilinear boundary samples; 0 off-edge).
  - Control against the pre-edit picture: bad=41467 (`dp0-slices2.png`).
- **Caspar restart re-apply** (AMCP `RESTART`, the XML still holding the old slices): node logged
  `[mapping-slices] re-applied 1/1 slice window(s)` with the live set.
  - Head after re-PLAY vs the live-edited picture: **bad=0**. Against the config baseline: bad=41467
    (`dp0-after-restart.png`).
- **Stacking:** one screen consumer on ch 2 (PGM window off), so the two-windows-per-channel SEGV case does not arise.
  The operator GUI on DP-4 is unaffected and shows the node in Devices (`dp4-gui.png`).
- **Restored:** `removeMappingNode`, the Dioda → DP-0 cable re-added, Apply again.
  - The graph (devices + edges) equals the pre-test snapshot.
  - The live `casparcg.config` is byte-identical to the pre-test copy.
  - ch 2 back to `port_600`; channels [2,4]/[3,5]; 0 journal errors; probe media deleted.

## 6. What remains

- **Binary swap: DONE 30.10 17:32** (dev box). `bin/casparcg` = md5 `ab668967…` (the build above); rollback `bin/casparcg.pre-wo869` (`fb955e76…`, the 16:37 build of `e8d457ec6` + the same uncommitted WO-820/800 tree, so the swap adds only `ce7132e50` + `deac375bb`). AMCP `RESTART` → run.sh relaunched it (`/proc/<pid>/exe` md5 checked), then node restarted (Apply check 0). After: the node re-staged the PRV look on ch2, `/api/system/operator-first` + the WO-857 listener (UDP 6290) answer, 0 `[error]` lines in the journal, :0 shows the GUI on DP-4 and the (empty-PGM) Dioda window on DP-0. The live project has no slices yet, so the slice path on real heads is still the open check below.
- ~~Caps probe~~ — done 30.10 (§7).
- **Path (a) route-slices** (SDI scaling/rotation and per-slice sources): the planner models it and the budget refusal (Q3), but there is no generator or apply code. It also needs #1814 (crop leak) in the fork.
- ~~Real GPU check~~ — done on the box 30.10 (§5.1): gpu-texture on, real DP-0 head, xrandr layout, stacking.
- **Fork caveat:** an intermittent startup SEGV with two screen windows on one channel on Xvfb, seen with both the old and the new binary (not caused by this change). Watch for it on the box, where the PGM window plus a slice window means two windows when another GPU cable keeps the PGM window on.
- **Not tested:** a channel format change while a window is live. (Re-apply after a real Caspar restart: done, §5.1.)
- **Planner edge:** a node with a slice window plus an empty GPU output (no slice) keeps that output `direct`, so the PGM window stays on and may overlap the slice window.
- **Owner QA:** one pass of the editor against a real two-head wall or LED processor.

## 7. Caps probe (30.10)

**Investigation**
- The planner took `caps.screenSlices !== false` as "has slices" (`mapping-slices-plan.js:162`), and no caller ever passed caps (`routes-device-view.js:117`, `config-generator-slice-windows.js:56`, `mapping-slices-apply.js`, `pixel-mapping-config.js:64`, `mapping-gpu-os-layout.js:81`). On a rollback binary (`bin/casparcg.pre-wo869`, the 24.04 ones) a sliced node would get a device-41 window that draws the whole frame, the PGM window off, and every live edit refused.
- The probe this WO proposed, `APPLY <ch>-640 SLICES SET 0`, is unsafe: on a live slice window it clears the slices (the fork accepts it, `screen_consumer.cpp` `call()` → `set_slices`).
- A malformed `APPLY … SLICES` cannot tell builds apart either: the fork answers 403, and so would any upstream build with #1638 but no slices (`output.cpp:85` returns false for an unknown index or a consumer whose `call()` declines).
- A read-only signal exists: the fork's screen consumer `state()` always writes `screen/slices` (the count, 0 when unsliced). Live `INFO 2` on the box shows `<slices>0</slices>` under `port_600`; the stock consumer has no such element.
- Reply shapes, measured with a second `ConnectionManager` on the live Caspar (scratchpad `wo869caps/shape.js`):
  - the bare `INFO` list comes back as `["1 1080p5000 PLAYING", …]`;
  - an unknown command rejects with `COMMAND_UNKNOWN_DATA: …`, not "400";
  - `APPLY 2-65535 SLICES CLEAR` on the fork gives `403 APPLY FAILED` plus a Caspar warning "No consumer found for index 65535". Nothing changes.

**What was done**
- `src/config/caspar-caps.js` (new): one process-wide `{ screenSlices: true|false|null, source, at }`, plus `screenSlicesFromInfoXml`. One record, because the generator, the os-layout, the API and the live apply all plan the same node and must agree. `null` = not probed = the old behaviour.
- `src/engine/caspar-caps-probe.js` (new) `probeCasparCaps`:
  1. bare `INFO`, then `INFO <ch>` until a channel has a screen consumer, whose block answers;
  2. if no channel has one: `APPLY <first ch>-65535 SLICES CLEAR` (an index that cannot exist). Unknown command → false; 403 → stays null.
  It never sends `SLICES SET`.
- `routing-setup.js` `setupMappingChannels` runs the probe before `reapplyAllMappingSlices`, on every (re)connect.
- `mapping-slices-plan.js`: `caps` defaults to `getCasparCaps()`; explicit caps still win.
  With `false`, GPU outputs go `refused` with `REASONS.NO_SCREEN_SLICES`, and the first slice is still placed the legacy way. The generator then writes no slice window and keeps the PGM window.
- `mapping-slices-apply.js`: a live APPLY refused as an unknown command (a rollback swapped in after connect) sets the caps to false (`apply-refused`). A 403 (bad set) leaves them alone.
- `routes-device-view.js` GET returns `casparCaps` next to `mappingSlicePlans`.

**Verified**
- `tools/smoke/smoke-wo869-caspar-caps.test.js` (curated, `offline-test-files-3.js`) **13/13**:
  - the INFO reader on the box's real screen block;
  - the error shapes;
  - fork, stock and no-screen probes (INFO only; the 65535 APPLY);
  - the planner, generator (`screen_1_slice_windows` gone) and re-apply follow the caps;
  - a 403 does not flip them.
- WO-868/869 smokes **80/80**.
- **Real binaries**, via `probeCasparCaps` over a real `ConnectionManager`:
  - live fork (:5250): `supported (INFO 2)`;
  - scratch Caspar on Xvfb :169 / 5264, `bin/casparcg.pre-wo869`, plain config: `NOT supported (INFO 1)`;
  - same binary, no screen consumers: `NOT supported (no APPLY command)`, `apply:400`;
  - the WO-869 build (`bin/casparcg`), no screen consumers: `null`, `no-screen-consumer`.
  Evidence: `scratchpad/wo869caps/old-binary.out`, `noscreen.out`.
- **Live node** (owner restarted highascg 21:06; it had been stopped since 18:53 by the `pre-produce-preflight.sh` dry run): the journal shows `[caspar-caps] screen slices supported (INFO 2)`, and GET `/api/device-view` returns `casparCaps: {screenSlices: true, source: "info:2"}`. The line appears twice per connect because `setupMappingChannels` runs twice on boot; the probe is read-only, so that is harmless.

## Owner decisions (30.10)

- **Q1 editor:** the Inspector holds the slice list and the numeric fields; "Edit slices" opens both canvases in the
  Devices tab centre.
- Not answered, so the recommended defaults apply:
  - Q2 SDI: placement only for v1;
  - Q3: the planner refuses path (a) over the channel budget and says to use GPU heads;
  - Q4: the web editor stays working through the migration (read-only slices);
  - Q5: v1 slices cut from the node's own feed;
  - Q6: feather per slice;
  - Q7: 4-corner keystone (grid warp is a separate WO);
  - Q8: one window per mapping node;
  - Q9: fork commits on `wo742-shm-producer` (the WO-867 pattern);
  - Q10: legacy `rotation` values are dropped.
