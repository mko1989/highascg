**Status: OPEN (2026-10-17) — owner direction recorded + compatibility desk-check done; no build made. Do this as the next CasparCG build (it also carries the WO-594 `shm` module).**

# WO-613 — Next CasparCG build: base it on upstream **v2.5.1-stable**

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

## What was done / What was VERIFIED

Desk only: tag dates, changelog, header diffs, syntax check of the shm module against v2.5.1, `gpu-texture` presence.
No build, nothing on the box.
