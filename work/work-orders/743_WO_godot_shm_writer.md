# WO-743 — Godot shm writer: a SubViewport published into a ring Caspar plays (WO-738 step 2)

**Status: DONE (24.10.26) as future development, detachable (see "How to remove"). Proven end to end by
`tools/e2e/godot-shm-writer.sh` (PASS): a Godot viewport goes through the ring and the WO-742 Caspar producer to a
channel's output, with every pixel exact. Godot `--test` 21577/0. Not wired into the client: that is WO-738 step 3.
Running it on a show needs the WO-742 Caspar binary, which is the owner's call.**

Parent: [WO-738 §7](./738_WO_godot_vj_engine_relayed_to_caspar.md) build order step 2. Producer: [WO-742](./742_WO_caspar_shm_producer.md).
Owner, 24.10 (/loop): *"include the future development but try to make those easily detachable if they fail and need
to be removed (decided by me at the end)"*.

## Investigation

- **The extension already exists for reading.** `godot/extensions/hshm` (WO-596) builds `libhshm`, whose
  `HshmSource` the kiosk loads for video surfaces. Its binary is built per machine; `build.sh` copies it into
  `godot/client/addons/hshm/bin/`.
  - **Hazard found.** Copying over a `.so` that a running Godot has mapped can crash that process (`cp` truncates in
    place). The kiosk on this box has `libhshm` loaded.
  - So the writer must **not** go into `libhshm`. I made it a second library, `libhshm_sink`, in the same CMake
    project. It shares the already-compiled godot-cpp, and `libhshm` is never rebuilt for it: md5 `deef6c73…` is the
    same before and after, in `bin/` and in the client addon.
- **The writer side already exists too.** `caspar/modules/shm/hshm_writer.h` is header-only and has no Caspar
  dependency. `publish(src, stride, n)` copies one BGRA8 frame into the next free slot under the seqlock.
- **Godot readback.**
  - `RenderingServer.texture_get_rd_texture(viewport_texture_rid)` gives the RD texture.
  - `RenderingDevice.texture_get_data_async(rid, 0, callback)` delivers RGBA8 a frame later without stalling. It
    works on 4.7.2 (Forward+, Vulkan, NVIDIA), as measured below. This was one of WO-738's unverified claims.
  - Compatibility renderer: there is no RenderingDevice, so `get_texture().get_image()` (synchronous) is the
    fallback.
- **Alpha, measured.** A ColorRect of `Color8(240,128,16,128)` on a transparent SubViewport reads back as RGB =
  colour × alpha (`08 40 78 80` BGRA). Canvas items blend alpha with ONE / ONE_MINUS_SRC_ALPHA over the transparent
  clear, so viewport pixels are **already premultiplied**: the ring's format, so no conversion. Images loaded from
  files are straight, so `publish_image` premultiplies by default.
- **Rate, measured.** With one readback in flight, half the frames were skipped (`published 230 skipped 230` in 4 s),
  because the async result lands a frame later. With two in flight: `published 460 skipped 0`.

## What was done

- `godot/extensions/hshm/src/sink/` (new):
  - `hshm_sink.{h,cpp}` define `HshmSink` (RefCounted):
    - `open(name, w, h, fps)` requires a plain name, the same rule as Caspar's `PLAY … SHM NAME`, and a sane size;
    - `publish_rgba8(bytes, straight_alpha = true)` swizzles RGBA→BGRA, premultiplies when asked, then calls
      `writer.publish`;
    - `publish_image(image, straight_alpha = true)` converts any format to RGBA8 first;
    - `close()` unlinks the ring, so the Caspar layer holds its last frame;
    - getters: `is_open`, `get_name`, `get_error`, `get_width`, `get_height`, `get_published`.
  - `sink_register.cpp` is the entry point (`hshm_sink_library_init`). `hshm_sink.gdextension` names
    `res://addons/hshm_sink/bin/libhshm_sink.*`.
- `godot/extensions/hshm/CMakeLists.txt`: a marked `WO-743` block (option `HSHM_SINK`, default ON) adds the
  `hshm_sink` target. `build.sh` is unchanged; its `cmake --build` builds both into `bin/` but installs only `libhshm`.
- `godot/client/features/shm_out/viewport_publisher.gd` (new, a Node):
  - `start(subviewport, ring_name, fps)` returns `""` or a reason; `stop()`;
  - each frame it reads the viewport back (async, at most 2 in flight, a skip counter beyond that, never a queue);
  - on a viewport resize it re-opens at the new size, and Caspar's producer follows the generation bump;
  - `HshmSink` is reached only through `ClassDB`, so the file parses where the extension is missing (CI, the client
    today). Nothing in the client references it yet.
- `godot/client/tests/test_shm_out.gd` (new): without the extension, `start()` reports it and nothing else happens.
- `tools/e2e/godot-shm-writer.sh` + `tools/e2e/godot-shm-writer/main.gd` (new):
  - a scratch Godot project with only the sink, the publisher and a test scene: a 640×360 transparent SubViewport
    with the left half opaque orange, the top-right quarter the same orange at alpha 128 and the bottom-right empty;
  - it runs on its own Xvfb display;
  - first the ring is checked, then a throwaway Caspar (`PLAY 1-10 SHM NAME …`) and its 720p channel output.

**Why a GDScript publisher and a thin native sink, not readback in C++?** The readback is a few lines of
RenderingServer calls that differ by renderer. GDScript can switch between them, and the test can see them. The native
part is only what GDScript can't do quickly: the per-pixel swizzle and the seqlock publish.

## How to remove (owner decision at the end)

- Delete `godot/extensions/hshm/src/sink/`, `godot/client/features/shm_out/`, `godot/client/tests/test_shm_out.gd`,
  `tools/e2e/godot-shm-writer.sh` and `tools/e2e/godot-shm-writer/`.
- Delete the `WO-743` block at the end of `godot/extensions/hshm/CMakeLists.txt`, and
  `godot/extensions/hshm/bin/libhshm_sink.*` (built, not committed).
- Nothing else references it. The client never loaded it.

## What was VERIFIED

- Built: `cmake --build build/template_debug --target hshm_sink`, niced, 0 warnings. `libhshm` md5 unchanged
  (`deef6c73…`).
- `tools/e2e/godot-shm-writer.sh ~/caspar-build/build-v2/shell/casparcg` → **PASS** in 3.9 s:
  - the ring (640×360) through Forward+ / Vulkan on the box's NVIDIA:
    - (160,180) = `10 80 f0 ff` opaque orange;
    - (480,90) = `08 40 78 80` half alpha, premultiplied (240·128/255 = 0x78);
    - (480,270) = `00 00 00 00`;
  - `PLAY 1-10 SHM NAME wo743-in-… → 202 PLAY OK`;
  - the channel output (1280×720, scaled 2×) at (320,360), (960,180) and (960,540): the same three values exactly,
    so premultiplied alpha passes through the producer and the mixer unchanged;
  - the box's Caspar (PID 1527509) kept running; no `wo743` segment left in `/dev/shm`.
- Rate: 460 frames in 4 s, 0 skipped (uncapped under Xvfb).
- Godot `--test` 21577 passed / 0 failed (+3). `run-client.sh --check` boot OK.
- Not done:
  - the Compatibility-renderer fallback (`get_image`) was not run;
  - nothing ran on a show channel or under show load;
  - the live wiring (Live-tab source, lease, teardown) is WO-738 step 3.
