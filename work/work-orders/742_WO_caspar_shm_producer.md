# WO-742 — Caspar `shm` producer: play a shared-memory ring written by another process (WO-738 step 1)

**Status: IN PROGRESS (24.10.26) — producer built into a Caspar binary and proven end to end in a throwaway Caspar
instance (`tools/e2e/caspar-shm-producer.sh`: PASS). Not deployed to any box. Deploying it means swapping the
Caspar binary (a Caspar restart), which is the owner's call. Future development: **detachable** (see "How to
remove").**

Parent: [WO-738 §7](./738_WO_godot_vj_engine_relayed_to_caspar.md). Owner, 24.10: *"definitly shared memory. if it
needs to be built so be it. i think it will be useful for future window grabbing from virtual screens"*. Owner,
24.10 (/loop): *"include the future development but try to make those easily detachable if they fail and need to be
removed (decided by me at the end)"*.

## Investigation

- **The ring already exists.** `caspar/modules/shm/hshm_abi.h` (WO-594) is a 3-slot seqlock ring: BGRA8
  premultiplied, page-aligned slots, `generation` bumped on a geometry change. `hshm_writer.h` and `hshm_reader.h`
  are header-only and have no Caspar dependency. The consumer side (channel → ring) has run on this box since WO-613
  (`opgui`).
- **The source tree is there.** `~/caspar-build/src-v2` (branch `highascg-build-v2`, 2.5.1 + carried patches)
  built `~/caspar-build/build-v2/shell/casparcg`. Its md5 `d5dee499…` equals the deployed `bin/casparcg`, and the two
  are separate inodes, so rebuilding cannot touch the running binary.
- **Caspar producer API (2.5.1).**
  - `frame_producer::receive_impl` runs once per channel tick.
  - `frame_factory->create_frame(tag, pixel_format_desc(bgra) + plane)` gives a `mutable_frame` to fill;
    `modules/html/producer/html_producer.cpp:360` does exactly this from a CPU buffer.
  - Registration is `producer_registry->register_producer_factory` in the module's `init`, like the consumer's in
    `shm.cpp`.
- **The reader API gap.** `reader::poll()` copies into a destination it is given. A producer would have to allocate a
  frame on every tick just to learn there was nothing new. So I added `has_new()` (one atomic load) and
  `heartbeat_ns()` (for the signal state) to `hshm_reader.h`. These are additive, so the WO-596 GDExtension that
  includes the same header is unaffected.

## What was done

- `caspar/modules/shm/producer/shm_producer.{h,cpp}` (new): `PLAY <ch>-<layer> SHM NAME <name>` maps
  `/dev/shm/highascg-<name>`.
  - On each tick: if a frame is new, allocate a BGRA frame of the ring's size and poll straight into it (one copy);
    otherwise hand back the last frame. A lapped (torn) copy is discarded and the previous frame kept.
  - **Writer lifecycle.** It may start after PLAY: the layer stays empty, and `is_ready()` is always true, so PLAY
    never stalls. If it stops, the layer holds the last frame. If it restarts (new inode via `replaced()`, or a new
    size via `generation`), the producer re-opens about twice a second (every 25 ticks).
  - A frame of another size is scaled by the mixer like any producer's.
  - State: `shm/name`, `width`, `height`, `signal` (a publish within 500 ms, the ABI's lost rule), `frames`,
    `lapped`.
  - NAME is required and must be a plain name (no `/`, `\`, `.`), so a request cannot reach outside `/dev/shm`.
- `caspar/modules/shm/shm.cpp` registers it ("Shared Memory Producer"). `CMakeLists.txt` adds the two source files.
- `caspar/modules/shm/tests/hshm_pattern.cpp` (new): a test writer (left half one colour, right half transparent,
  50 fps) and a pixel reader.
- `tools/e2e/caspar-shm-producer.sh` (new), on its own Xvfb display, AMCP port and paths, with Caspar killed by PID:
  1. writer → PLAY;
  2. read the channel's shm consumer: the opaque half must be exact, the transparent half `00 00 00 00`;
  3. kill the writer: the frame is held;
  4. restart the writer at 320×180 in blue: it is picked up;
  5. `PLAY … SHM` without NAME must be refused.
- Caspar tree: the same files are on branch `wo742-shm-producer` in `~/caspar-build/src-v2`, off
  `highascg-build-v2`, built in `build-v2`.

**Why a separate producer folder, not the consumer file.** WO-742 must come out cleanly if the owner drops it, and
the consumer is in production (opgui).

## How to remove (owner decision at the end)

- Delete `caspar/modules/shm/producer/`, `caspar/modules/shm/tests/hshm_pattern.cpp` and
  `tools/e2e/caspar-shm-producer.sh`.
- Remove the lines marked `WO-742` in `shm.cpp` (2) and the two `producer/` lines plus the `source_group` line in
  `CMakeLists.txt`.
- `has_new()` / `heartbeat_ns()` in `hshm_reader.h` can stay; they are harmless and unused.
- In the Caspar tree, `git checkout highascg-build-v2` and rebuild. The deployed binary never had it.

## What was VERIFIED

- `ninja -C build-v2 casparcg`, niced: shm module + relink, 0 warnings in the new files.
- `tools/e2e/caspar-shm-producer.sh ~/caspar-build/build-v2/shell/casparcg` → **PASS**:
  - `PLAY 1-10 SHM NAME wo742-in-… → 202 PLAY OK`;
  - output 1280×720: (320,360) = `10 80 f0 ff`, the writer's orange stretched from 640×360; (960,360) =
    `00 00 00 00`, so transparency passes through the mixer;
  - writer killed → the last frame held;
  - writer restarted at 320×180, blue → `f0 20 10 ff`;
  - `PLAY 1-11 SHM` → `403 PLAY FAILED`;
  - the box's own Caspar (PID 1527509) kept running throughout; the test instance is gone afterwards.
- `hshm_seqlock_test` (WO-594) still PASSes with the added reader methods.
- Not done: running on a show channel or under real load. Deployment = a Caspar binary swap (the WO-613 maintenance
  window rule), which is the owner's call. The Godot writer (WO-738 step 2) and server glue (step 3) follow in their
  own WOs.
