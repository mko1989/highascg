# HighAsCG's CasparCG build

HighAsCG runs its own CasparCG Server build: upstream **v2.5.1-stable**, plus community PRs, the Enhanced fork's audio and
LED work, and HighAsCG's own additions. **Every Caspar binary that ships (box, ISO, release) must be built from the
`highascg-main` branch.** That branch is where everything below is committed. Add new work there as new commits. Don't
start a fresh branch off upstream: the binary would silently lose these features.

- **Source:** `~/caspar-build/src-v2`, branch `highascg-main` (a git worktree of `~/caspar-build/src-tree`). It was
  named `wo742-shm-producer` until 07.11.26.
- **Build:** `~/caspar-build/build-26.sh`. This is the native Ubuntu 26.04 toolchain, writing to `build-26/`, with
  RUNPATH `$ORIGIN/../lib`. Log: `~/caspar-build/build-26.log`.
- **Deploy:**
  1. Copy the build to `bin/casparcg.pre-<wo>` first, as a rollback. Keep `casparcg.prev` as well.
  2. Copy `build-26/shell/casparcg` to `bin/casparcg.new`, then `mv -f` it to `bin/casparcg`.
  3. Run `sudo -n systemctl restart casparcg-server.service`.
  4. Restart node, because the OSC receiver latches per process.
  5. Check `VERSION`, which reports the commit (for example `2.5.1 cd177d369`).
- **Distribution:** `bin/` is git-ignored and stignored. ISOs are clones of a box, so a box carries whatever is in
  its `bin/`. Other boxes (for example highascg5867) need a copy with the same swap steps.
- **Patches:** `patches/` holds `git format-patch` exports of HighAsCG's own commits, so the repo records them even
  without the build tree. These exports are documentation. The branch is the source of truth.

## What the build carries (beyond upstream v2.5.1)

| Commit(s) | What | HighAsCG WO / origin |
|---|---|---|
| 791998893…52493fbd3 | Art-Net consumer: fixture positioning, multi-universe, grids, flux compensation, rotation/mirroring, per-fixture networking, brightness | Eliyah Sundström (`improved-artnet`) |
| 15ef28f16…1ac377d52 | Enhanced: video-scheduled audio, multi-channel audio, high-bit-depth screen, decimal aspect/spanning/mipmaps, PortAudio host-API selection, OAL sync fixes | Gregory Meisel (Enhanced fork) |
| cffc63c0e | DeckLink teardown use-after-free fix | upstream PR |
| f7b08f396 | HTML CG update payload escaping | upstream PR |
| f940e7026 | NDI consumer bounded frame buffer (memory leak) | upstream PR |
| 08de7a2e4 | FFmpeg stream consumers auto-reconnect | local |
| 471549bd4, cb099a503, d980f73ad…5fea4d0cb | Pixel consumer (LED pixel mapping, gamma/colour correction, RGBX), endian modernisation | Dimitry Ishenko (#1751) |
| 530542a16…7aa818c12 | MIXER BLUR / SHARPEN / GRAIN | C-alcaide (#1762) |
| 62f68af8f, 10098e2e7 | CEF pinned to the owner build v.142; C++20 lambda captures | WO-234 |
| f0f16967c | `pixel` subdirectory restored; shm consumer | WO-613, WO-594 |
| 886998cc1 | OSC float/double args big-endian again (the receiver depends on it) | WO-613 follow-up |
| 1174120ce | shm producer (`PLAY ch-layer SHM NAME …`); the source is also in `modules/shm` | WO-742 |
| 24db35cca | Build without Boost `system` (Boost 1.90 / Ubuntu 26.04) | WO-753 |
| 4eab31c06 | FFmpeg producer: skip bwdif for progressive-only streams | WO-790 |
| 5f99d1fcb, a09a40f12 | #1762 effects: grain R/B luma, LENS blur on BGR, bounded combine | WO-867 |
| e4e1e7ef3, 2747aaa47, e8d457ec6 | OAL SwrContext init; #1718 screen aspect "auto"; OAL one device+context per output | WO-847 |
| ce7132e50, deac375bb | AMCP APPLY (#1638); screen slices (perspective quads, live over APPLY) | WO-869 |
| d6519d5d3 | Per-layer audio meters over OSC | WO-800 |
| dd7862fba | Native NotchLC: CPU unpack, GPU shader decode (`ffmpeg.producer.notchlc-gpu`) | WO-820 |
| cd177d369, 379d81917 | AMCP accept loop survives a connect+reset (a port scan used to lock out every new client) | WO-990 |
| e8bbf87f3 | FFmpeg producer: plain plane copies (no per-row TBB tasks), fps duplicates reuse the made frame + its textures, thread names cut to 15 bytes (4K ProRes loop 260 → 166 % CPU) | WO-991 |
| 4838ab393 | No TBB hand-off per frame: `make_frame` copies video then audio inline; FFmpeg consumers only `parallel_invoke` with both streams (the "AMCPCommandQueue" 16 → 1.7 % pool spin) | WO-992 |
| 2476644c4 | Native DXV (Resolume DXV2/DXV3): CPU unpack to BC blocks, GPU shader decode; DXV3 HQ in correct colours (`ffmpeg.producer.dxv-gpu`) | WO-993 |
| 3c15fbe7a, 9e243d9b4, 2f168f91f, d8e02f9ef | Runtime CHANNEL ADD/REMOVE (tombstoned slots, COW channel list, generation-checked commands, lazy per-channel AMCP queues), VIDEO-MODE ADD, route format refresh on SET MODE + source_removed (black/silent instead of frozen loop), LOCK callback UAF fix, INFO CONFIG lists live channels — branch `wo1020-dynamic-channels`, not deployed until its live test | WO-1020 |
| 5c3373ec5 | ADD ch[-idx] XML <consumer element> (quoted or base64; every XML consumer option live) — same branch | WO-1020 (WO-1016 P-a/P-b) |

Run `git -C ~/caspar-build/src-v2 log --oneline v2.5.1-stable..highascg-main` for the live list. Update this table
when you add a commit.
