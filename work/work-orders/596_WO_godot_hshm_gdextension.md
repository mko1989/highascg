# WO-596 — `hshm` GDExtension: shared-memory channel frames → Godot textures

**Area:** godot-client, caspar-build
**Status: IN PROGRESS (2026-10-17) — `HshmSource` GDExtension implemented, built (macOS x86_64) and verified on the dev Mac against the bridge; Linux build + box measurements pending. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: [WO-594](./594_WO_caspar_shm_frame_consumer.md) (`hshm_abi.h`). Needed by: WO-599/600 (operator canvas/atlas), WO-607 (previs PGM 3072×1728).**

## Investigation

Research: [`work/godot-port/inventory/godot-ecosystem-research.md`](../godot-port/inventory/godot-ecosystem-research.md) §2–3, risks 1/3/9.

- **No built-in shared memory in Godot** (headless ClassDB probe on 4.6.3: `SharedMemory` → NO) → native code required
  for the production path. GDScript `FileAccess` on `/dev/shm/...` works for the M0 spike only
  (1.46 ms / 7.77 ms per 1080p / 3072×1728 read on the dev Mac — WO-595).
- **Bindings:** godot-cpp **10.0.0-stable** (✔ `git ls-remote`, 2026-10-17) is now versioned independently
  of the engine and targets any engine ≥ 4.3 via `api_version`; SCons (CMake also supported).
  Extensions built for an older minor load on newer engines, not the reverse → build against the
  oldest engine we support (= the pinned one). godot-rust gdext 0.5.5 is pre-1.0 → not chosen.
- **Upload path (research §3):** `Texture2DRD` wrapping an RD texture created with
  `DATA_FORMAT_B8G8R8A8_UNORM` + `TEXTURE_USAGE_SAMPLING_BIT | CAN_UPDATE_BIT`, updated by
  `RenderingDevice.texture_update(rid, 0, PackedByteArray)` — the same pattern the godot-ndi addon
  uses for BGRA NDI frames. BGRA8 sampled images are mandatory in Vulkan → supported on NVIDIA.
  `Image` has no BGRA format (so not `ImageTexture`, unless swizzled in a shader).
  All pieces ✔ present in 4.6.3 (`texture_update(texture:RID, layer:int, data:PackedByteArray)`,
  `texture_create_from_extension(type, format, samples, usage_flags, image, width, height, depth, layers, mipmaps)`).
- ⚠️ **Cost (research risk 1, from reading 4.6 source, UNVERIFIED on hardware):** `texture_update` is
  synchronous on the render thread and copies twice on the CPU, uploading in 64 px tiles by default.
  At 3072×1728@50 = 1.06 GB/s. Knobs: `rendering/rendering_device/staging_buffer/block_size_kb`,
  `…/max_size_mb` (≥ 2–3 frames), `…/texture_upload_region_size_px`. Known slow-video-upload
  history: godotengine/godot#57147 (open).
- **Renderer lock-in:** the RD path does not exist in the Compatibility (OpenGL) renderer → the
  client commits to **Forward+ or Mobile** (benchmark both in WO-595).
- **CI:** RD-dependent code cannot run `--headless` → split the reader (pure C++, testable) from the
  uploader (needs a GPU; tested on the box / a GPU runner).

**Update 17.10:** the pure reader exists and is tested — [`caspar/modules/shm/hshm_reader.h`](../../caspar/modules/shm/hshm_reader.h)
(header-only, no Godot/Caspar deps; lap + generation + inode handling; seqlock test PASS). `hshm_reader`
below = that header. M0 lesson: **never read the segment through buffered file I/O** (stdio served
stale header bytes on macOS) — the extension `mmap`s once.

## Design

```
godot/addons/hshm/
  hshm.gdextension                 (entry, compatibility_minimum = pinned engine)
  src/hshm_reader.{h,cpp}          pure C++: open/mmap/seqlock/generation/heartbeat — NO Godot deps
  src/shm_frame_source.{h,cpp}     class ShmFrameSource : Node   (Godot-facing)
  src/register_types.cpp
  tests/reader_test.cpp            ctest: torn-frame/lap/generation/heartbeat cases vs a fake writer
  SConstruct                       godot-cpp 10.x, api_version = pinned engine minor
bin/libhshm.linux.x86_64.so        (built in CI + on the box; macOS build for dev = reader only)
```

`ShmFrameSource` (one per surface role; shared by every consumer of that role):

| Member | Meaning |
|--------|---------|
| `segment: String` | `/highascg-opgui` (from `GET /api/video-surfaces`, WO-597) |
| `texture: Texture2DRD` | stable object for the whole session; RD texture re-created on geometry change |
| `signal_lost: bool` + `signal_state_changed` | heartbeat > 500 ms, generation/inode change, segment absent |
| `frame_number`, `latency_ms`, `dropped_reader`, `gaps` | diagnostics for the HUD and logs |
| `upload_enabled: bool` | false when nothing visible uses it (no upload cost for hidden surfaces) |

Per rendered frame (`_process`, or `RenderingServer.frame_pre_draw` callback): `reader.poll()` →
if a new stable slot: copy into a reused `PackedByteArray` (one memcpy) → `texture_update` → re-check
seqlock; if lapped, keep the previous frame (no torn frame ever shown). Reopen loop every 500 ms
while lost.

**Plan B (if WO-595 M2 fails at 3072×1728):** zero-copy — allocate the RD texture's backing via
`texture_create_from_extension` on a `VkImage` bound to memory imported with
`VK_EXT_external_memory_host` from the mmap'd slot (GPU copies straight from shm; we own the Vulkan
sync). Plan C: a downscaled previs surface (Caspar-side, e.g. a half-res route channel) for previs only.

## Tasks

- [ ] T1 `hshm_reader` (pure C++) + ctest against a fake writer implementing WO-594's writer exactly.
- [ ] T2 `ShmFrameSource` node + `Texture2DRD` upload + signals; staging-buffer settings in `project.godot`.
- [ ] T3 HUD overlay (latency, gaps, upload ms) behind a debug key.
- [ ] T4 CI: build `.so` for the pinned engine (godot-cpp 10, `api_version`); reader tests run headless.
- [ ] T5 Benchmark on the box (feeds WO-595 M1/M2); decide Plan B only on numbers.

## Acceptance

- ch5 1920×1080@50: upload ≤ 2 ms render-thread time; no torn frame in a 1 h soak (pattern check).
- ch1 3072×1728@50: ≤ 3 ms with Plan A or B; otherwise Plan C for previs.

## What was done (2026-10-17)

| Path | What |
|------|------|
| `godot/extensions/hshm/src/hshm_source.{h,cpp}` | `HshmSource : RefCounted` — `open/close/poll/upload_to(rid)/get_frame` + stats getters; wraps `caspar/modules/shm/hshm_reader.h`; **double buffer + mutex**: `poll()` (main thread) memcpys mmap → back buffer and swaps; `upload_to()` (render thread) calls `RenderingDevice::texture_update` on the front buffer under the lock — safe in single- and multi-threaded render models; frame never crosses into GDScript (no copy-on-write per frame). Signal lost after 500 ms; reopen every 500 ms; reopen on generation change or replaced inode. |
| `godot/extensions/hshm/src/register_types.cpp` | entry `hshm_library_init`, scene-level registration |
| `godot/extensions/hshm/CMakeLists.txt` | godot-cpp **10.0.0-stable** via FetchContent (or `GODOTCPP_SOURCE_DIR`), **API 4.6** (loads on 4.6.x and 4.7.x), links `rt` on Linux |
| `godot/extensions/hshm/hshm.gdextension` | manifest, `compatibility_minimum = "4.6"`, linux x86_64 + macos x86_64/arm64 |
| `godot/extensions/hshm/build.sh` | builds for the host, installs into `godot/spikes/m0` (+ `godot/client` when present), registers in `.godot/extension_list.cfg` |
| `godot/spikes/m0/shm_native.gd` + `shm_texture.gd update_native()` + `main.gd --reader=native|gdscript` | spike uses the extension by default |

Finding: Godot loads extensions from `.godot/extension_list.cfg`, which only the editor import scan writes;
`godot --headless --import` on 4.6.3 then **crashes at exit** in `EditorHelp::_gen_extensions_docs`
(DocTools::generate during `Main::cleanup`, signal 11 — same project imports cleanly without the extension).
Workaround in `build.sh`/`run-spike.sh`: write the one-line `extension_list.cfg` directly (verified: loads, no crash).
Packaging (WO-609) must do the same or export the project (exports embed the list).

## What was VERIFIED (dev Mac, Godot 4.6.3, Iris Plus, bridge pattern)

| Surface | Reader | read p50/p95 ms | upload p50/p95 ms | render fps | frames / gaps (9 s) | latency p50 ms |
|---------|--------|-----------------|-------------------|-----------|---------------------|----------------|
| 1920×1080@50 | GDScript | 2.56 / 2.99 | 0.97 / 1.20 | 59.1 | 440 / 7 | 11.4 |
| 1920×1080@50 | **native** | **1.33 / 1.73** | 1.12 / 1.51 | 59.4 | 447 / 4 | 10.5 |
| 3072×1728@50 | GDScript | 6.19 / 8.49 | 2.40 / 4.08 | 56.8 | 426 / 22 | 15.3 |
| 3072×1728@50 | **native** | **2.48 / 3.44** | 2.58 / 3.40 | 58.9 | 439 / 8 | 10.8 |

Headless (no GPU) native: 298 frames / 6 s, 0 gaps, read 0.83 ms. Remaining "gaps" are display skips of a
50 fps writer on a 60 Hz panel (transport is lossless — WO-595). Upload cost is unchanged (it is the
driver's `texture_update`); plan B (zero-copy) only if the box misses budget.

**4.6-API build loads on Godot 4.7.2** (headless: reader=native, 250 frames / 5 s, read 0.88 ms) ✔.

Not verified: Linux build (box/CI), RTX/Vulkan numbers, threaded render model.

## Tests (2026-10-23)

- `godot/client/tests/test_shm_reader.gd` + `shm_fake_writer.gd` (a writer for ABI v1 into a regular file, as
  `open_path()` does). They cover `video/shm_reader.gd`: geometry, each frame read once, gaps, the writer's drop
  counter, mid-write and lapped slots, slot index ≥ 3, the writer re-initialising, a restart with a new
  generation and size, signal loss and segment sizes. The same segments then go to the native HshmSource
  (`shm_native.gd`). CI has no extension binary, so that part only checks that the adapter reports it
  unavailable. On the box it runs for real.
- The tests found that the GDScript reader accepted segments the native reader refuses: pixel format ≠ 1,
  slot count ≠ 3, or a file too short for its geometry. `_open` now refuses them too (`segment_size()` =
  `hshm_segment_size`).
- The C++ seqlock test (`caspar/modules/shm/tests`) and the Python bridge→probe round trip already ran in CI
  (`ci.yml`).

## Earlier notes

Nothing yet. API presence verified on 4.6.3 (probe); versions verified by `git ls-remote`.
