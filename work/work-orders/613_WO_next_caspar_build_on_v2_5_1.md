# WO-613 — Next CasparCG build: base it on upstream **v2.5.1-stable**

**Area:** caspar-build
**Status: IN PROGRESS (2026-10-17) — `highascg-build-v2` (v2.5.1-stable + every carried patch + WO-594 `shm` + OSC float-endian fix) assembled, built and RUNNING on the shop dev box (`2.5.1 886998cc1 Stable`), functional pass green (see Verified). Remaining: owner soak/QA on real shows (DeckLink A/V sync, audio), decide the OAL choice below, deploy to show machines.**

Owner, 17.10: "add a note for future caspar build to use v2.5.1 which is newer and adds some good fixes."

## Investigation (2026-10-17)

- Upstream tag **`v2.5.1-stable` = `ec38d94`, 2026-09-16** (`git ls-remote` + shallow fetch); `v2.5.0-stable`
  = `69e8ad5`, 2025-12-10.
- Today's deployed binary is `highascg-build-v1`, built **2026-07-15**, reporting `2.6.0 Dev Revision: 253c16c`
  — assembled on `firecraftgaming/caspar-server improved-artnet` (= PR #1752, tracking upstream *master*)
  plus carried PRs (`docs/CASPARCG_BUILD_PROVENANCE.md`). "2.6.0 Dev" is a higher version number, but
  2.5.1 was released two months **after** our build, so its fixes are only in our binary if they reached
  master before 2026-07-15 — not assumable.
- 2.5.1 changelog items that matter on this rig (from `CHANGELOG.md` at the tag):
  - Core: **AMCP: prevent race when executing BATCH** (HighAsCG sends AMCP batches constantly —
    PRV push, takes, multiview); FFmpeg 8.1.2; AVX2 no longer required (except v210 DeckLink out);
    Linux: SFML 3 support; channel-grid init fix.
  - Producers: FFmpeg graceful ENOMEM, reduced mutex contention, graph stopped before join.
  - Consumers: **DeckLink** recover A/V sync in extreme cases, check keying support before enabling,
    option to disable keying; **Audio** multiple devices, improved sync to other consumers,
    configurable delay, device-enumeration fixes; **Screen** configurable delay.
- Compatibility checks done here (desk, against the v2.5.1 tree):
  - **WO-594 `shm` consumer compiles syntax-clean against v2.5.1 headers** (`c++ -std=c++20
    -fsyntax-only`), as it does against master `fe19ac0`. The only consumer-API difference: v2.5.1's
    `frame_consumer` has no `call()` virtual (we do not override it). `frame.h`,
    `frame_consumer_registry.h` identical; `image_mixer` still reads every frame back (`copy_async`,
    `image_mixer.cpp:107`); `output.cpp:167` still waits on every consumer future → WO-594 §3 holds.
  - Screen consumer **`gpu-texture` exists in 2.5.1** (5 hits, same as master) → the WO-502
    forced `<gpu-texture>true</gpu-texture>` config stays valid.
  - `modules/artnet` exists in 2.5.1 (`artnet_consumer.cpp`).

## Plan

1. **Diff the carried patch set against v2.5.1:** for every row in `docs/CASPARCG_BUILD_PROVENANCE.md`
   (improved-artnet #1752, Enhanced PortAudio/ASIO/JACK + OAL scheduling + screen GL fixes, DeckLink
   teardown #1763, CG escaping #1761, NDI leak #1691, STREAM reconnect #1727, pixel consumer #1751,
   mixer BLUR/SHARPEN/GRAIN #1762, CEF pin): applies cleanly / already upstream / needs porting.
   PRs written against master may depend on post-2.5.1 master changes — record each.
2. **Decide the base** with that table: (a) v2.5.1 + carried patches (owner's preference), or (b) if
   too many carried PRs need master, current master + cherry-picked 2.5.1 fixes. Record the decision here.
3. Add `src/modules/shm` (WO-594; one `add_subdirectory(shm)` line).
4. Build with the kit (bare-metal or docker) → `bin/casparcg.new`; keep `casparcg.prev`; owner swaps
   in a maintenance window; new provenance section "highascg-build-v2".
5. Re-run on the box: WO-235-style OSC/INFO schema check (the last base change broke parsers),
   DeckLink keying + A/V sync, audio consumers (multi-device), AMCP batch-heavy flows (PRV push, takes),
   WO-594 acceptance table.

## Investigation — carried-patch diff (2026-10-17, on the shop dev box)

Source: `~/caspar-build/src-tree` (the v1 tree, remotes upstream/firecraft/enhanced + PR branches).
v1 = upstream master `d603ee9` (2026-05-20) + 8 improved-artnet commits + 36 carried commits. master vs
v2.5.1 differ mostly in decklink (SDK headers + VANC), `accelerator`, newtek (NDI v6), oal (#1714).
All 44 commits cherry-picked (`-x`) onto `v2.5.1-stable` (`ec38d94`) as branch `highascg-build-v2`:

| Carried item | Result on 2.5.1 |
|---|---|
| improved-artnet #1752 (8) | conflict = formatting only (re-wrapped signature); took patch side → `src/modules/artnet` **identical to v1** (CMake min version aside) |
| `cstdint` include #1697 | already in 2.5.1 → skipped |
| Enhanced OAL / screen / PortAudio (12) | **real collision with upstream #1714** (Dimitry's OAL + screen fixes, Aug 2026, in 2.5.1 only). Kept Enhanced: oal/screen/portaudio **identical to v1** → 2.5.1's OAL rewrite and new screen/OAL `delay` key are NOT in this build (see Decision) |
| DeckLink teardown #1763 | clean; fix present |
| CG escaping #1761 | 2.5.1 still had quote-only escaping; patch is a superset → patch side |
| NDI leak #1691 | 2.5.1 has the old NDIlib_v5 consumer; v1's was master's v6 + advertiser + fix → **whole `newtek` module taken from v1** (both load `libndi.so.6`) |
| STREAM reconnect #1727, endian chores, pixel #1751 (12), ogl uv + MIXER BLUR/SHARPEN/GRAIN #1762 | clean, except `src/modules/CMakeLists.txt` header: keeping 2.5.1's side **dropped `add_subdirectory(pixel)`** — restored in `f0f1696` |
| CEF pin + C++20 lambda fix | clean |

**Root cause of the months-old "OSC floats little-endian" defect found** (memory/WO-235/WO-562 family):
carried commit `7e7c0b2` ("chore(osc): use std::endian", pulled in with the pixel PR #1751 series — it is
NOT on upstream master) removed `#include "OscHostEndianness.h"` from `OscOutboundPacketStream.cpp`, but
`operator<<(float)` / `(double)` still branch on `#ifdef OSC_HOST_LITTLE_ENDIAN` → never defined → `#else`
raw native copy. Ints went through the new `caspar::big_endian()` and stayed correct, hence "floats LE,
ints BE". Raw capture on v2 before the fix: `file/time` = `cdcc0042 00007042` (= 32.2 / 60.0 read LE).

### Decision (default taken, owner may flip): Enhanced OAL over upstream #1714
Owner instruction "2.5.1 + all earlier added modules" + provenance row 3 ("A/V sync behaviour the rig
relies on") → v1's Enhanced OAL kept. #1714 is Dimitry's; Enhanced `6b664d3` "adopted dimitry's deferred
future sync approach" but the code still differs (~400 lines; 2.5.1 pre-queues silence, Enhanced removed
the pre-queue). Both read `<system-audio><device-name>`; only 2.5.1 knows `<delay>`. Flipping = drop
Enhanced commits 10–20 for `src/modules/oal` (+ screen if its `delay` is wanted) and rebuild.

## What was done (2026-10-17)

- `~/caspar-build/src-v2` (worktree, branch `highascg-build-v2`, 46 commits over `ec38d94`):
  44 carried picks + `f0f1696` (restore pixel subdir, add WO-594 `shm` from `caspar/modules/shm`) +
  `886998c` **fix(osc): write float/double args big-endian again** (restores the include and `#error`s if
  neither OSC_HOST_*_ENDIAN macro is defined, so it can never silently regress).
- Built in `~/caspar-build/build-v2` (Ninja, Release, `USE_SYSTEM_CEF=OFF`, CEF from the v1 download
  cache = pinned tarball) — 145 targets, first try. Bundle: `~/Downloads/caspar-build-kit/highascg-build-v2.bundle`.
- Deployed on the dev box: `bin/casparcg` = v2 (`2.5.1 886998cc1 Stable`); rollbacks `bin/casparcg.253c16c`
  (v1 prod), `bin/casparcg.v1-shm` (v1 + shm only), `bin/casparcg.prev` (June).
- Provenance: `docs/CASPARCG_BUILD_PROVENANCE.md` "Build record highascg-build-v2".

## What was VERIFIED (shop dev box, RTX PRO 4000, DeckLink 8K Pro, 1 channel 1080p50)

- Startup log: image, ffmpeg, oal, portaudio, decklink, screen, newtek (`libndi.so.6`), artnet, pixel,
  **shm**, html all "Initialized"; screen consumer + OSC up; no errors.
- DEPLOY.md checks: ELF ok, `ldd` no missing libs (portaudio linked), strings artnet/pixel/BLUR/SHARPEN/GRAIN/hshm present.
- AMCP on 1-900 with a real clip: PLAY ok; `MIXER BLUR 20 / SHARPEN 1.5 / GRAIN 0.4` set + read back;
  `BEGIN … COMMIT` batch (opacity applied, `COMMIT OK`); CG ADD/UPDATE (backslash + tab payload)/CLEAR 202;
  `ADD` NDI (send thread up), PORTAUDIO (ALSA default, stream started), DECKLINK 1 (8K Pro initialized),
  SHM — all 202 and removed cleanly.
- **OSC after the fix:** raw capture `file/time [3.5, 60.0]` decoded big-endian; HighAsCG journal
  "float byte order verified big-endian (spec-compliant)"; `/api/state` elapsed 10.58→13.62 over 3 s,
  remaining/progress sane.
- shm → Godot (WO-594/596) on 2.5.1: real clip with blur/grain visible in canvas + previs (screenshots in session).
- Offline suite unaffected by the binary (it is JS-only).

### Findings / follow-ups
- **HighAsCG float-endian latch is per process:** after a binary swap under a running node, the old `le`
  latch byte-swaps correct floats (elapsed 0.03 instead of 3.5) until node restarts. Fix candidate:
  re-arm detection on Caspar (re)connect in `src/osc/osc-float-endian.js`. Workaround: restart node after
  any Caspar binary swap.
- `ADD … AUDIO` (OAL) → "Failed to initialize audio device" on this box — **pre-existing** (same error in
  v1 logs on 09-17/21/28, 10-01); environment (device busy), not the build.
- DeckLink "Failed to enable external keyer" — **pre-existing** (~170× in v1 logs). 2.5.1's new
  `<keyer>disabled</keyer>` lets the config generator silence it where keying isn't wanted.
- OSC/INFO schema: HighAsCG parsed file name/path/fps/time/clip and channel INFO on 2.5.1 with no
  parser change (WO-235-style check passed for the addresses exercised; full show flows = owner QA).
- Not verified: multi-channel configs (box runs 1 channel), DeckLink A/V-sync recovery under load,
  long soak.
