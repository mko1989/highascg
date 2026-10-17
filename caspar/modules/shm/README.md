# CasparCG `shm` frame consumer (WO-594)

Publishes every frame of a Caspar channel into POSIX shared memory (`/dev/shm/highascg-<name>`) so a
local native client (the Godot operator client, WO-593) can draw the channel inside its own scene.
The frame copy is one `memcpy` of the frame Caspar already reads back to CPU; the consumer never
blocks the channel (`send()` returns immediately, a worker copies, newest frame wins).

| File | What |
|------|------|
| `hshm_abi.h` | the shared-memory ABI v1 — single source of truth (C/C++; Python mirror in `tools/hshm-bridge/hshm_abi.py`, GDScript reader in `godot/spikes/m0/shm_reader.gd`) |
| `hshm_writer.h` / `hshm_reader.h` | header-only writer/reader, **no CasparCG dependency** (reader is reused by the WO-596 GDExtension) |
| `consumer/shm_consumer.{h,cpp}`, `shm.{h,cpp}`, `CMakeLists.txt` | the Caspar module (mirrors `modules/newtek`) |
| `tests/hshm_seqlock_test.cpp` | torn-frame / lap / generation test of writer + reader |

## Status (2026-10-17)

- `tests/hshm_seqlock_test.cpp`: **PASS** on the dev Mac (clang 16): 3 timing scenarios
  (incl. 1080p50 with a 0–40 ms-late reader) → 0 torn frames accepted; deterministic lap test
  (1–2 publishes during a copy accepted, 3rd rejected as lapped); generation bump on re-init.
- `consumer/shm_consumer.cpp` and `shm.cpp`: **syntax-checked** (`-fsyntax-only -std=c++20`) against
  upstream CasparCG headers at `fe19ac0` + Boost. **Not yet built or run inside Caspar** — that
  happens in the build kit on the box.

## Build into highascg-build-v1 (on the box, build kit `~/Downloads/caspar-build-kit/`)

1. Copy this folder to `<caspar-src>/src/modules/shm/`.
2. In `<caspar-src>/src/modules/CMakeLists.txt` add one line after `add_subdirectory(newtek)`:
   `add_subdirectory(shm)`. Nothing else: `casparcg_add_module_project(... INIT_FUNCTION "shm::init")`
   registers the module with the shell (`CASPARCG_MODULE_INIT_STATEMENTS`) and includes
   `modules/shm/shm.h` by default.
3. Build with the kit's script (bare-metal or docker) → `bin/casparcg.new`; swap in a maintenance
   window and keep `casparcg.prev` (house rule, `docs/CASPARCG_BUILD_PROVENANCE.md`); add provenance row 11.
4. Smoke (operator channel ch5 first — never start on an on-air channel):
   ```
   ADD 5-740 SHM NAME opgui            # AMCP (telnet 5250 or the logs modal raw box)
   ls -la /dev/shm/highascg-opgui
   python3 tools/hshm-bridge/hshm_probe.py --name opgui    # fps 50, gaps 0, latency p50/p95
   NO_BRIDGE=1 godot/spikes/m0/run-spike.sh canvas --fullscreen
   REMOVE 5-740
   ```
   Config form (after the smoke): `<consumers><shm><name>opgui</name></shm></consumers>`.

Consumer indices **740–749 are reserved for shm** (WO-594 §7). 8-bit channels only (same rule as NDI).

## Run the unit test anywhere

```
c++ -std=c++17 -O2 -pthread caspar/modules/shm/tests/hshm_seqlock_test.cpp -o /tmp/hshm_test && /tmp/hshm_test
```
