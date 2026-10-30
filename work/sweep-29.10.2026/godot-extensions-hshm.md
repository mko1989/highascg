# godot/extensions/hshm — sweep 29.10.2026 (batch 045)

Files: 10 · lines: 912 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 8 RISK, 6 QUALITY

ABI check: `src/hshm_source.cpp` wraps `caspar/modules/shm/hshm_reader.h`, which matches `hshm_abi.h` (offsets, 3 slots, seqlock `seq == 2n`, `latest = n<<8 | slot`, `static_assert` sizes). The extension adds no ABI constants of its own, so there is no drift. The sink side goes through `hshm_writer.h` the same way.

## godot/extensions/hshm/build.sh
- `RISK` godot/extensions/hshm/build.sh:22 — `cmake --build` has no `--target`, so every build also builds `hshm_sink` and `retrohost`. `retrohost` needs `libretro.h` from a `file(DOWNLOAD …)` at CMake configure time (CMakeLists.txt:72). Failing case: a fresh `build/` on a box with no internet → configure aborts → the live `libhshm` is not built either. The CMake comment says the live library "is never rebuilt for it", but the configure step is shared. Fix: pass `-DHSHM_RETRO=OFF` (and `-DHSHM_SINK=OFF`) by default in build.sh, or build `--target hshm`; `godot/retro/install.sh` builds the other two explicitly.
- `QUALITY` godot/extensions/hshm/build.sh:16 — `[[ … ]] && TARGETS+=…` inside `set -e` is safe (not the last command), but the `--release` flag is the only argument parsed; any other first argument is silently ignored.
- `QUALITY` godot/extensions/hshm/build.sh:34 — `cp "$HERE"/bin/libhshm.*` only matches `libhshm.<platform>…`, so `libhshm_sink.*` and `libretrohost.*` are deliberately not installed. That is correct, but nothing says so, and the header comment says nothing about the sink/retro libraries being built here and left in `bin/`. Only a comment is needed.

## godot/extensions/hshm/src/hshm_source.cpp
- `BUG` godot/extensions/hshm/src/hshm_source.cpp:69-73 — `close()` does not clear `path_utf8_`, so the next `poll()` reopens the segment (line 79 only checks `path_utf8_.empty()`). Failing case: GDScript calls `src.close()` and then keeps calling `poll()` every frame → the source reopens after ≤500 ms and `reopens` increments, so a closed source does not stay closed. Nothing calls `close()` from GDScript today (grep `"close"` / `.close()` in `godot/client/video/*.gd` → none), so it is latent. Fix: clear `path_utf8_` and `path_` in `close()`, or add a flag.
- `RISK` godot/extensions/hshm/src/hshm_source.cpp:97,140-144 — `poll()` holds no lock while it fills `buffers_[back]`, which is correct. But `upload_to()` holds `mutex_` for the whole `texture_update` (lines 140-144), so `poll()`'s swap blocks the main thread for the length of a 4K upload (the spike measured about 2.7 ms for 3K). No failing case, only a stall of up to one upload per frame. A try-lock would let `poll()` skip the swap.
- `RISK` godot/extensions/hshm/src/hshm_source.cpp:144 — `texture_update` returns an `Error` that is dropped. After a geometry change the GDScript side must recreate the texture before the next `upload_to`; if it does not, `texture_update` fails every frame with a size mismatch and nothing is reported to GDScript. `shm_texture.gd update_native` does recreate on `w != width`, so no live failure.
- `RISK` godot/extensions/hshm/src/hshm_source.cpp:75 via `caspar/modules/shm/hshm_reader.h:64,101-105` — the reader does not check `stride >= width*4` or that `slot_offset[i] + slot_size <= size_` against the real file size; it only checks `hshm_segment_size(stride, height) <= size_`. A corrupt or half-written header with a larger `slot_offset` makes `poll()` memcpy beyond the mapping → SIGSEGV of the whole Godot client. The writer is trusted and sets the magic last, so only a stale or foreign file triggers it.
- `RISK` godot/extensions/hshm/src/hshm_source.cpp:75 via `caspar/modules/shm/hshm_writer.h:156` — the writer's `attach()` calls `ftruncate` on an existing segment. If a leftover segment from a crashed Caspar is reused with a smaller geometry while a reader still has the old, larger file mapped, pages past the new EOF raise SIGBUS in the reader's `memcpy`. Normal restarts unlink first (`close()` → `shm_unlink`), so this needs an unclean exit followed by a smaller mode.
- `QUALITY` godot/extensions/hshm/src/hshm_source.cpp:50-66 — `try_open()` ignores `reader_.width() == 0 || height() == 0`. A zero-size header (the writer validates this, a stray file does not) gives 0-byte buffers and a successful "open" that never shows a frame. Low value.

## godot/extensions/hshm/src/hshm_source.h
- `OK` (members `signal_lost_`, `upload_ms_` and `pending_upload_` are read without the mutex across threads; these are benign single-word reads)

## godot/extensions/hshm/src/register_types.cpp
- `OK`

## godot/extensions/hshm/src/retro/retro_host.cpp
- `RISK` godot/extensions/hshm/src/retro/retro_host.cpp:225-229 — `RETRO_ENVIRONMENT_SET_GEOMETRY` sets `width_`/`height_` but not `frame_`. `get_image()` (line 187) builds `Image::create_from_data(width_, height_, …, frame_)`, so if a core changes geometry and then passes a NULL (dupe) frame, `frame_.size()` is still the old size and `create_from_data` fails with an engine error. Failing case: a core that resizes via SET_GEOMETRY and dupes the next frame → `get_image()` returns null → `retro_window.gd:_show_and_publish` calls `_tex.update(null)`. Fix: resize `frame_` in SET_GEOMETRY, or compute `get_image()` from `frame_.size()`.
- `RISK` godot/extensions/hshm/src/retro/retro_host.cpp:120-139 — `load_game()` may be called twice on one core without an `unload_game()`: `game_loaded_` is overwritten and the first game is never unloaded. `retro_window.gd` calls it once.
- `QUALITY` godot/extensions/hshm/src/retro/retro_host.cpp:120-146 — `load_game` does not reset `frames_`, `audio_` or `buttons_`, so a second load keeps stale input and queued audio. Not reachable with the current window.
- `QUALITY` godot/extensions/hshm/src/retro/retro_host.cpp:230 — `RETRO_ENVIRONMENT_GET_VARIABLE`, `SET_VARIABLES`, `GET_CORE_OPTIONS_VERSION` and `SET_INPUT_DESCRIPTORS` all return false (`default:`). Cores that rely on `GET_VARIABLE` return true from nothing and fall back to their defaults. This is documented in the comment, so only informational.

## godot/extensions/hshm/src/retro/retro_host.h
- `OK`

## godot/extensions/hshm/src/retro/retro_register.cpp
- `OK`

## godot/extensions/hshm/src/sink/hshm_sink.cpp
- `RISK` godot/extensions/hshm/src/sink/hshm_sink.cpp:25 — `open_shm` uses `O_CREAT|O_RDWR` without an exclusive lock. Failing case: two `HshmSink`s (or two retro windows with the same `--ring`) → the second `attach()` zeroes the header and generation-bumps a segment the first is still publishing into → both publish into one ring and the first sink's `close()` unlinks the second's segment. Fix: `flock(LOCK_EX|LOCK_NB)` on the shm fd, or refuse if `producer_pid` is alive.
- `QUALITY` godot/extensions/hshm/src/sink/hshm_sink.cpp:46-49,67-69 — `publish_rgba8` / `publish_image` return false on a size mismatch or a closed sink without setting `error_`, so `get_error()` stays empty and the caller cannot tell why nothing arrived. Fix: set `error_` on each early return.

## godot/extensions/hshm/src/sink/hshm_sink.h
- `OK`

## godot/extensions/hshm/src/sink/sink_register.cpp
- `OK`
