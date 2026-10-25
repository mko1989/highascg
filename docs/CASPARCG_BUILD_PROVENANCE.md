# CasparCG highascg-build-v1 — provenance manifest

> **NEXT BUILD (owner, 17.10.2026): base it on upstream `v2.5.1-stable` (2026-09-16)** — released after
> this build and carries fixes we want (AMCP BATCH race, DeckLink A/V-sync recovery + keying check,
> audio multi-device/sync/delay, FFmpeg 8.1.2). Plan, compatibility checks and the carried-patch diff:
> [WO-613](../work/work-orders/613_WO_next_caspar_build_on_v2_5_1.md). The next build also adds the
> `shm` frame consumer ([WO-594](../work/work-orders/594_WO_caspar_shm_frame_consumer.md), `caspar/modules/shm/`).


Every component of the final binary, mapped to its source. Keep current through assembly/build.
(Exact commit hashes get filled by the assembly step — see SOURCES.txt in the build kit for the raw list.)

| # | Component | Source | What it provides | Why we carry it |
|---|-----------|--------|------------------|-----------------|
| 1 | **Base tree** | `firecraftgaming/caspar-server` branch `improved-artnet` = upstream **PR #1752** (tracks recent CasparCG/server master) | Core server close to current upstream; **improved Art-Net consumer**: per-fixture region config with native `sws_scale` box-averaging (fixes LED-wall rasterization) | Newest stable core + the artnet quality fix; base for everything below |
| 2 | **PortAudio/ASIO/JACK consumer** | `gmeisel01/CasparCG_Enhanced` differentiator commits | Low-latency system audio output paths | **Owner-critical audio** (the reason Enhanced was built) |
| 3 | **OAL video-scheduled audio** | CasparCG_Enhanced | OpenAL audio consumer scheduled against video clock | Enhanced audio stack; A/V sync behavior the rig relies on |
| 4 | **Screen consumer GL/aspect fixes** | CasparCG_Enhanced | Fixes GL scaling/aspect on screen consumers | Live PGM screen consumers on this rig |
| 5 | **DeckLink teardown fix** | upstream **PR #1763** | Use-after-free on DeckLink consumer teardown | Crash-class fix; DeckLink is the primary output |
| 6 | **CG payload escaping** | upstream **PR #1761** | Correct escaping of CG UPDATE payloads | We drive countdown/timer CG UPDATE constantly |
| 7 | **NDI memory-leak fix** | upstream **PR #1691** (rebased during assembly) | Bounded queue + clean shutdown in NDI consumer | NDI in production; leak kills long shows |
| 8 | **STREAM auto-reconnect** | upstream **PR #1727** | ffmpeg STREAM consumer reconnects after network drops | Owner streams; deployment note: keep STREAM off the primary DeckLink channel (disconnect thread-join latency) |
| 9 | **Pixel consumer** | upstream **PR #1751** — OWNER PICK | Generic full-frame pixel raster output over Art-Net (grid = video-mode resolution, config-file) | Media-server general tool: raw grid walls / external pixel processors; complements (not replaces) #1 for fixture mapping |
| 10 | **MIXER BLUR/SHARPEN/GRAIN** | upstream **PR #1762** | New mixer effects, off-by-default | Live-events look tools; zero cost when unused; applied LAST (touches mixer core) |

**Deliberately NOT included** (revisit later): #1758/#1765/#1766 color-grading series (all patch the same 6 files — manual-merge project, deferred); #1755/#1756 crash-hardening drafts (unreviewed, need owner soak); #1670 (stale); #1737/#1731 (large, orthogonal).

**CEF (PINNED, owner-mandated):** the EXACT owner build from https://github.com/mko1989/highascg/releases/tag/v.142 (`cef_build_minimal_no_root`), sha256 `2a03fa6b9da0e374fb318903d9502e098ac91ba2ec5be83e96ae076b5aa63cc9` — pinned by URL+hash in Bootstrap_Linux.cmake (branch commit 253c16c). The upstream mirror ships a DIFFERENT binary under the same filename; the hash pin makes any substitution fail the build. The tarball itself is included in the build kit for offline builds.
**Assembly hashes:** base `6b065c8` (improved-artnet), final HEAD `253c16c` (34 source commits + CEF pin); full per-commit provenance in the kit's SOURCES.txt.
**Build/deploy:** kit at ~/Downloads/caspar-build-kit/ (docker + bare-metal variants); binary lands as bin/casparcg.new; owner swaps in a maintenance window; previous binary kept as casparcg.prev.

---

## Build record (2026-07-15, built on the highascg dev box)

- Assembled branch `highascg-build-v1`, final source HEAD `b96e58d` (incl. the CEF pin commit `253c16c` and the C++20 lambda-capture fix for Enhanced's oal/portaudio consumers).
- Toolchain: system cmake 3.28.3 + ninja 1.11.1, gcc, Release, `-j28`; `USE_SYSTEM_CEF=OFF`; CEF pre-seeded from the pinned tarball (sha256 `2a03fa6b…`), which is byte-identical to the deployed `highascg/lib/libcef.so` — the runtime lib tree required no changes.
- Output: `bin/casparcg` (9.3 MB, reports `2.6.0 Dev Revision: 253c16c`), deployed 2026-07-15 (previous binary kept as `bin/casparcg.prev`).
- Rebuild recipe + full per-commit provenance: `~/Downloads/caspar-build-kit/` (`SOURCES.txt`, `build-baremetal.sh`, `build-docker.sh`, unshallowed git bundle, the exact CEF tarball) and `work/work-orders/234_WO_CASPAR_FINAL_BUILD.md`.
- Known post-swap integration work: WO-235 (2.6-dev OSC/INFO schema drift vs highascg parsers).

---

## Build record highascg-build-v2 (2026-10-17, built + running on the shop dev box)

- Base **upstream `v2.5.1-stable` (`ec38d94`)** + all v1 carried commits cherry-picked with `-x`
  (branch `highascg-build-v2`, final HEAD `886998c`). Per-item outcome and the OAL decision: [WO-613](../work/work-orders/613_WO_next_caspar_build_on_v2_5_1.md).
- Differences from v1 beyond the base: rows 1–10 carried; **row 3/4 keep Enhanced OAL/screen** (upstream #1714 OAL rewrite not taken);
  **row 7 newtek module = v1's** (master NDI v6 + #1691); **+ row 11 `shm` consumer** (WO-594);
  **+ `886998c` fix(osc): float/double args big-endian** (regression from carried `7e7c0b2`, the root cause of the "LE OSC floats" defect).
- Toolchain: system cmake + ninja, gcc, Release, `-j24`, `USE_SYSTEM_CEF=OFF`, CEF from v1's download cache (pinned sha256 `2a03fa6b…`).
- Output: `bin/casparcg` reports `2.5.1 886998cc1 Stable` (9.2 MB). Rollbacks on the box: `casparcg.253c16c` (v1), `casparcg.v1-shm`, `casparcg.prev`.
- Source: `~/caspar-build/src-v2` (worktree of `src-tree`), bundle `~/Downloads/caspar-build-kit/highascg-build-v2.bundle`.
- Later commits on branch `wo742-shm-producer` (same worktree, local, not pushed):
  - `1174120ce` — the `shm` producer, `PLAY <ch>-<layer> SHM NAME <name>` ([WO-742](../work/work-orders/742_WO_caspar_shm_producer.md)); the binary in
    `bin/casparcg` since 25.10 (md5 `b2bb40f5`; its version string still says `886998cc1`; previous
    kept as `casparcg.pre-wo742-20261025-001150`).
  - `24db35cca` — **needed to build on Ubuntu 26.04**: `CMakeModules/Bootstrap_Linux.cmake` no longer asks Boost for the
    `system` component (header-only since 1.69; Boost 1.89+ ships no `boost_system` config, so configure failed on
    26.04's Boost 1.90). The same tree still builds on 24.04 / Boost 1.83. On 26.04 the binary links ffmpeg 8, Boost
    1.90, SFML 3 and ICU 78 only; same pixels and CPU as the 24.04 build ([WO-753](../work/work-orders/753_WO_two_box_test_campaign_and_ubuntu_26_04_verdict.md) A8).

---

## Build record — native Ubuntu 26.04 (2026-10-25, dev box after its 24.04 → 26.04 upgrade)

- **Why a rebuild was needed:** the upgrade's "Remove obsolete packages?" step (`/var/log/dist-upgrade/main.log`, 15:51)
  purged the 24.04 libraries the deployed binary was linked against (`libavcodec60` … ffmpeg 6.1, SFML 2.6,
  `libboost-chrono1.83.0t64`), so `casparcg-server` failed with `libavcodec.so.60: cannot open shared object file`
  (exit 127). The same applies to every rollback binary. .4 kept these packages through its upgrade (WO-753 A2), so
  its 24.04 binary still runs; **a fresh 26.04 install has none of them.**
- **Stopgap (kept for the rollbacks):** the 71 noble `.so` files (ffmpeg 6 + codec deps, SFML 2.6, boost-chrono,
  ICU 74, libxml2 …) were extracted from 24.04 `.deb`s into `~/highascg/lib` (`run.sh`'s `LD_LIBRARY_PATH`;
  git- and Syncthing-ignored). List: `lib/NOBLE-COMPAT-MANIFEST.txt`; the debs: `~/highascg-noble-compat-debs/`.
  None shares a soname with a 26.04 system library. Delete them once no 24.04-built binary is kept as a rollback.
- **Source:** `~/caspar-build/src-v2`, branch `wo742-shm-producer`, HEAD `24db35cca`, unchanged. No SFML 3 or
  ffmpeg 8 porting was needed (Caspar's CMake already takes SFML 3; WO-753 A8).
- **Build deps the upgrade removed** (reinstall before building):
  `sudo apt install libboost-all-dev libicu-dev libatk1.0-dev libatspi2.0-dev libatk-bridge2.0-dev`.
  `libicu-dev` came in implicitly with Boost on 24.04; without it only the final link fails (`cannot find -licuuc`).
- **Toolchain:** gcc 15.2, cmake 4.2.3, ninja, Release, `USE_SYSTEM_CEF=OFF`, CEF from v1's download cache (pinned
  sha256 `2a03fa6b…`, unchanged; the built `libcef.so` is byte-identical to `highascg/lib/libcef.so`).
  Recipe: `~/caspar-build/build-26.sh` (checks the deps, builds into `~/caspar-build/build-26`, logs to
  `build-26.log`, prints unresolved libs). `build-v2` is left alone as the 24.04 build dir.
  gcc 15 adds ~65 warnings (mostly C++20 `[=]` implicit-`this` deprecations); none are errors.
- **Output:** `bin/casparcg` reports `2.5.1 24db35cca Stable` (9.9 MB, md5 `b5a82b9c`), deployed 2026-10-25 17:33
  (cp → `.new` → `mv -f` → AMCP `RESTART` → node restart). Links only 26.04 libraries: ffmpeg 8 (`libavcodec.so.62`),
  Boost 1.90, SFML 3.0, ICU 78. Previous binary kept as `bin/casparcg.pre-26build` (md5 `b2bb40f5`, the 24.04
  WO-742 build; it needs the noble libs above).
- **After the swap:** all 7 channels `PLAYING`, media restore `PLAY OK`. ffmpeg 8 logs "Changing video frame properties
  on the fly is not supported by all filters" on each open; cosmetic (WO-753 A8). `PLAY … DECKLINK` failed with
  `Check syntax` because of the desktopvideo 16.2a1 → 16.4a1 driver update done the same day, not because of this build:
  the cards report `PLEASE_UPDATE` (firmware 0x65, driver wants 0x66) until they are flashed with
  `BlackmagicFirmwareUpdater update <n>` and the box is power-cycled.
