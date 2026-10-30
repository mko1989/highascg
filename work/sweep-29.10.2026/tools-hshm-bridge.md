# tools/hshm-bridge — sweep 29.10.2026 (batch 116)

Files: 4 · lines: 712 · findings: 0 BUG-HIGH, 3 BUG, 0 DEAD, 2 RISK, 5 QUALITY

Scope notes: all four files read in full; `ast.parse` clean. Nothing executed. `OFF_*` / `SLOT_OFF_*` / `HEADER_SIZE` / `SLOTS` constants in hshm_abi.py were compared one by one with caspar/modules/shm/hshm_abi.h:35-69 and all match. Live consumers: .github/workflows/ci.yml:78-83 (bridge+probe), tools/tracking-detect/sidecar.py:34-37 (`hshm_abi.Reader`).

## tools/hshm-bridge/hshm_abi.py
- `RISK` tools/hshm-bridge/hshm_abi.py:146-153,166-176 — `Reader` maps `st_size` once and never re-checks it. `Writer.__init__` (line 82) `ftruncate`s the same path to the new size; a reader that is between the generation check (166) and the pixel copy (176) when a new-geometry writer shrinks the file touches pages beyond EOF → SIGBUS kills the Python process instead of returning `"geometry"`. The long-lived tracking sidecar uses this class. Also `slot = latest & 0xFF` (171) is not range-checked (IndexError on a corrupt header). Fix: catch/guard, or map the segment read-only through `os.pread`.
- `QUALITY` tools/hshm-bridge/hshm_abi.py:7 — comment says every reader re-validates `seq` so a torn frame is never accepted; true for `poll()` (173/183) but the copy at 176 is a plain slice, so the guarantee depends on the second check at 183 — keep them together.

## tools/hshm-bridge/hshm_bridge.py
- `QUALITY` tools/hshm-bridge/hshm_bridge.py:304-305,323 — SIGINT/SIGTERM only set a flag. In `--source stdin` the thread is blocked in `readinto` (PEP 475 retries after EINTR), so Ctrl-C/SIGTERM is ignored until the next frame or EOF; with a stalled ffmpeg the process (and the /dev/shm segment) never goes away. Fix: raise from the handler or read with a timeout.
- `QUALITY` tools/hshm-bridge/hshm_bridge.py:256 — `% (w - bar_w)` is a ZeroDivisionError for `--width <= 32`; `--fps 0` divides by zero at 309; `--fps` is int-only and `fps_den` is fixed at 1 (301), so 59.94/29.97 cannot be expressed.

## tools/hshm-bridge/hshm_probe.py
- `BUG` tools/hshm-bridge/hshm_probe.py:82-86 — on `"geometry"` the probe closes the reader and calls `hshm_abi.Reader(path)` without the `(FileNotFoundError, ValueError)` retry used for the first open (53-58). Failing case: restart `hshm_bridge.py` while the probe runs: `Writer.__init__` zeroes the magic first (hshm_abi.py:87) / the old process unlinks the file on exit, the reopen raises, traceback, no summary line. Fix: reuse the open-with-retry loop.
- `BUG` tools/hshm-bridge/hshm_probe.py:106 — exit status is `0 if torn == 0`, also when ZERO frames arrived. CI (ci.yml:78-83) runs `hshm_bridge.py &` then the probe with `--check-pattern --json` and a trailing `wait`; a bridge that creates the header but never commits a frame (or crashes after `Writer.__init__`) makes the probe report `frames: 0` and exit 0 → the "pixel-level torn check" step is green without checking a pixel. Fix: return non-zero when `total["frames"] == 0` (or below a minimum).
- `QUALITY` tools/hshm-bridge/hshm_probe.py:88 — periodic progress is suppressed with `--json`, so a 30 s `--json` run is silent until the end.

## tools/hshm-bridge/wo594_acceptance.py
- `BUG` tools/hshm-bridge/wo594_acceptance.py:233 — false PASS: `verdict = test[0] <= base[0] and test[1] <= base[1] and not issues`. If the OSC watcher receives nothing (wrong port, no OSC copy to :6250) both counts are 0 and the result is `PASS`. A malformed datagram also kills the watcher thread silently: `osc_messages` uses `b.index(b'\0')` (126,129) with no try/except inside `run()` (161-175), after which ticks stop and the verdict stays PASS. Fix: require `len(ticks) > 0` in baseline and test windows and catch parse errors per datagram.
- `RISK` tools/hshm-bridge/wo594_acceptance.py:207-208 — `fps = 50.0` hard-coded; on a 25 fps channel the normal 40 ms tick spacing exceeds `1.5 * period` (30 ms), so every tick is "late" in baseline and test and the comparison is meaningless. Fix: derive from the channel's `/framerate` OSC value or a `--fps` option.
- `QUALITY` tools/hshm-bridge/wo594_acceptance.py:199-201 — log window compares `time.localtime` strings with the Caspar log's own timestamps as text; correct only if both use the same timezone.
