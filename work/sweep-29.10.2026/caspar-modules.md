# caspar/modules — sweep 29.10.2026 (batch 001)

Files: 11 · lines: 1173 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 2 RISK, 3 QUALITY

Context checked: the module is byte-identical to the build tree (`diff -rq /home/casparcg/caspar-build/src-v2/src/modules/shm caspar/modules/shm` → only `tests/` differs), so these findings are about the code that actually runs. `output.cpp` (caspar-build/src-v2/src/core/consumer/output.cpp:101) calls `consumer->initialize()` again on every live consumer when the channel video format changes, and `add()` (line 64) does `remove(index)` first, so an AMCP re-ADD never overlaps two consumers of the same name.

## caspar/modules/shm/consumer/shm_consumer.cpp
- (cross-reference, counted under hshm_writer.h) `initialize()` at :89 calls `writer_.open_shm()`; on the SECOND call (channel format change, output.cpp:101) that path unlinks the segment, see the BUG at `hshm_writer.h:134-137`. The consumer's own comment at :47 ("initialize() may remap while the worker publishes") shows re-initialize was an intended path.
- `QUALITY` caspar/modules/shm/consumer/shm_consumer.cpp:186,197 — `NAME` is not validated, while the producer (shm_producer.cpp:146) and the Godot sink (godot/extensions/hshm/src/sink/hshm_sink.cpp:16) reject names containing `/ \ .`. `ADD 1-741 SHM NAME my.cam` creates `/dev/shm/highascg-my.cam`, which `PLAY 1-10 SHM NAME my.cam` then refuses to read; a name with `/` fails inside `shm_open` in `initialize()` as a bare `std::runtime_error` (not a `caspar_exception`/`user_error`), so the AMCP client gets a generic error. Fix: apply the same plain-name check in `create_consumer` / `create_preconfigured_consumer`.

## caspar/modules/shm/consumer/shm_consumer.h
- `OK`

## caspar/modules/shm/hshm_abi.h
- `OK` — struct layout and the `HSHM_OFF_*` byte offsets add up (header 128 bytes, offsets 0..120 consistent with the struct, `static_assert`s match). The `HSHM_OFF_*` / `HSHM_SLOT_OFF_*` macros are not used by C++ on purpose (they are the contract for `tools/hshm-bridge/hshm_abi.py` and the GDScript reader), so not DEAD.

## caspar/modules/shm/hshm_reader.h
- `OK` — read protocol matches hshm_abi.h (acquire on `latest`, `seq == 2n` before and after the copy, generation/geometry check first). The reader-side exposure to the writer's shrink-before-invalidate order is described in the RISK under `hshm_writer.h:156` (the faulting access is `poll()` at :96-102).

## caspar/modules/shm/hshm_writer.h
- `BUG` caspar/modules/shm/hshm_writer.h:134-137 (with :99-116 and :39-46) — calling `open_shm()`/`open_path()` a second time on the same writer unlinks the segment it has just opened. `open_shm()` does `shm_open(name)` (gets the existing inode), then `attach()` starts with `close()`, and `close()` runs `shm_unlink(object_)` for the previous (same) name; the writer then keeps writing into an unlinked inode and `/dev/shm/highascg-<name>` no longer exists. Failing case: `ADD 1-741 SHM NAME pgm1` (segment present), then a channel video-mode change (`SET 1 MODE …`, or anything that makes `output::operator()` re-initialize consumers) → `shm_consumer::initialize()` → second `open_shm` → name gone. Every reader then sees `stat()` fail (`hshm::reader::replaced()` is true forever, reader.h:124-128), so the Godot operator client / `PLAY SHM` producer / `tools/hshm-bridge` lose the picture until the consumer is REMOVEd and re-ADDed. Proven in isolation: a 10-line program calling `open_shm("x",64,32,…)` then `open_shm("x",128,64,…)` prints `exists=1` after the first and `exists=0` after the second (run against the real header; temp segment cleaned up). The Godot sink avoids it by calling `close()` (unlink + recreate) before `open_shm` (hshm_sink.cpp:15), the Caspar consumer does not. Fix: in `attach()` close the old mapping/fd without unlinking when `obj == object_` (e.g. split `close()` into `unmap()` + `unlink()`), or unlink only when the new name differs. Add a same-writer re-open case to `tests/hshm_seqlock_test.cpp` (it only tests two writer objects).
- `RISK` caspar/modules/shm/hshm_writer.h:156-165 — the file is `ftruncate`d to the new size BEFORE `latest`/magic are invalidated (:164-165). If the new geometry is smaller (e.g. 1080p → 720p re-init, or a writer such as the Godot VJ engine restarting at a lower resolution), a reader that already passed its magic/generation check reads `slot_offset[slot]` (reader.h:96-102) from the old header and touches pages past the new EOF → SIGBUS. The reader in `shm_producer` runs inside CasparCG, so the window (a few µs between `ftruncate` and the magic clear, polled once per 20 ms tick, order of 1e-3 per re-init) is a Caspar crash on air, not just a dropped frame. No failing run was reproduced, hence RISK. Fix: clear `latest` and magic (release) first, then `ftruncate`; never shrink a mapped segment (grow only, or create a fresh inode and let `replaced()` do the switch); optionally have the reader re-`fstat` before touching slot memory.
- `RISK` caspar/modules/shm/hshm_writer.h:67-74 — seqlock writer ordering: `hshm_store_release(&sh->seq, 2*n-1)` is a release store, which orders what came BEFORE it, not the `memcpy` that follows. The standard seqlock needs a release fence (or a seq-cst store) after the odd store so the pixel stores cannot become visible before it; hshm_abi.h:17-19 documents the protocol without it. On x86-64 (the only production target) TSO plus GCC's atomic-store codegen makes this work in practice; on ARM (the header says macOS is used for the file-backed tests, i.e. possibly Apple Silicon) or under a more aggressive compiler a torn frame could pass the reader's `seq == 2n` check. `tests/hshm_seqlock_test.cpp` passes on x86 so this is untested elsewhere. Fix: `__atomic_thread_fence(__ATOMIC_RELEASE)` after the odd-seq store (and keep the reader's acquire fence at reader.h:114).

## caspar/modules/shm/producer/shm_producer.cpp
- `OK` — logic reviewed (re-open cadence, `geometry_changed` → close + immediate re-open, `lapped` keeps the previous frame, `is_ready() == true` so a missing writer never stalls the layer, name validation on `PLAY`). It is the in-process victim of the shrink race described under `hshm_writer.h:156`.

## caspar/modules/shm/producer/shm_producer.h
- `OK`

## caspar/modules/shm/shm.cpp
- `OK`

## caspar/modules/shm/shm.h
- `OK`

## caspar/modules/shm/tests/hshm_pattern.cpp
- `QUALITY` caspar/modules/shm/tests/hshm_pattern.cpp:56-58 — `read` mode indexes `px[(y*width + x)*4]` from `atoi(argv)` with no bounds check; `x >= width` or `y >= height` reads outside the vector (UB, garbage or crash) instead of reporting an error. Test tool only (used by tools/e2e/caspar-shm-producer.sh).

## caspar/modules/shm/tests/hshm_seqlock_test.cpp
- `QUALITY` caspar/modules/shm/tests/hshm_seqlock_test.cpp:80-91 — `generation_bumps_on_reinit` uses two separate `hshm::writer` objects on one file, which is not what the consumer does (one writer object, `open_*()` called twice). The same-writer re-open path is untested, which is why the unlink bug in hshm_writer.h:134-137 went unnoticed although this test is in CI (.github/workflows/ci.yml:75). Add a case: `wr.open_path(p,…); wr.open_path(p,…); assert(file exists && reader.poll() == geometry_changed)`.
