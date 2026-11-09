# WO-1022 — Server releases carry the hand-built Caspar (and point at its complete source)
**Area:** caspar-build, os-iso
**Status: IN PROGRESS (09.11, pipeline + installer built and tested offline on fakes; the real upload, the first CI release with Caspar and a live swap on a release box are not done yet)**

Owner, 09.11 (verbatim):
> i think server releases should include the hand built caspar server version.

Owner, 09.11, on the source (via the lead):
> definitly there should be source of caspar cg build as well as full highascg code. the project is fully opensourced

The owner then chose a public fork: https://github.com/mko1989/casparcg-server (branch `highascg-main` = 5c3373ec5, annotated
tag `highascg-5c3373ec5`, pushed by the lead).

## Investigation

**Where releases come from.**
- `.github/workflows/ci.yml` job `release` (WO-736) runs `tools/release/make-github-release-server.sh --no-godot-clients`.
  Every green push to main becomes a prerelease `highascg-server_<stamp>.tar.gz`.
- The tarball members are an explicit list (`scripts/lib/archive-common.sh` `archive_common_server_tar_members`). `bin/` and
  `lib/` are never members. The `--exclude="./bin"` style excludes (`archive-common.sh:56`) never match anyway, because members
  are passed without `./` (the WO-687 note says so too). So a `caspar/bin/` member is not excluded.
- `bin/` is git-ignored (`.gitignore:45`, unanchored, so it also covers `caspar/bin/`) and stignored (`.stignore:7`).
  So `caspar/bin/casparcg` never enters git or Syncthing.
- The GUI update picks the newest release that carries a `highascg-server_*.tar.gz` (`src/system/server-update.js:199`).
  The prune (`tools/release/prune-auto-releases.sh:14`) selects only releases with that asset. So a separate `caspar-<sha>`
  prerelease is neither installed as a server drop nor pruned. It is a prerelease, so it never becomes "Latest".

**How a box installs a release.**
- `POST /api/system/update/apply` → `/usr/local/lib/highascg/highascg-webui-server-update.sh` (root, detached into a transient
  unit, WO-501). It stops node, then runs `APPLY_SH` = the *installed* `/usr/local/lib/highascg/highascg-apply-server-drop.sh`
  (`highascg-webui-server-update.sh:32`). Only after that does it refresh the installed helpers from the new tree
  (`refresh_installed_helpers`, `:230`).
- The boot path is `highascg-exfat-server-update.service`. It is ordered `Before=casparcg-server.service`
  (`install-exfat-systemd-units-units.sh:298`) and calls the same apply script. At boot Caspar is not running yet.
- The apply merges into `~/highascg` without `--delete`. The rsync excludes (`config/server-update-rsync-excludes.txt:20-21`)
  are anchored `/bin/` and `/lib/`, so `caspar/bin/` passes. The apply refuses a git checkout (WO-737). So this dev box (a
  checkout) never takes a drop. 5867 (192.168.0.10) is NOGIT and takes drops.
- Consequence for the rollout: the helper that runs an update is always the one installed by the update *before* it.
  **The first release with this WO cannot swap Caspar. It installs the new helpers, and the next update swaps.** The sweep
  check names this case.

**Readiness without touching :5250.**
- Node asks `VERSION` on every connect and in its health check (`src/caspar/connection-manager.js:256`). It publishes the
  answer as `/api/state` → `caspar.versionLine`.
- Live: this box reports `"2.5.1 5c3373ec5 Stable"`, 5867 reports `"2.5.1 2476644c4 Stable"`.
- This is the probe the installer uses. It never opens a socket to Caspar itself, because of the WO-990 acceptor kill.
- `casparcg-server.service` has `Restart=on-failure` and `StartLimitBurst=8`/300 s. run.sh can hold Caspar behind the boot
  screen gate (WO-638) for up to 120 s. Because of both, the verify clock has to start when a `casparcg` process runs, not
  when the unit is active.

**Hazard found: `casparcg --version` is not a flag.**
- Caspar takes `--version` as the config file path. It printed the version, then `[fatal] Configuration file --version was
  not found` and exited.
- If a file of that name existed, it would start a second Caspar.
- So the publish script reads the version from the binary's `.rodata` (`strings | grep "^2.5.1 5c3373ec5 "`, exactly one
  hit) and never runs the binary.

**The binary and its libraries.**
- `~/highascg/bin/casparcg` = `~/caspar-build/build-wo1020/shell/casparcg` (md5 6372ec07…, sha256 `40115da4…7f2d`, 10 244 960
  bytes). RUNPATH is `$ORIGIN/../lib`.
- With `LD_LIBRARY_PATH=~/highascg/lib` everything resolves. libcef.so, libportaudio and libvulkan come from `lib/`.
  `lib/libcef.so` sha256 = `fa0993fab321ee4e35122f6104b1f2c2e3d22b2323f02682a206996e8904ed57` (CEF
  142.0.17+g60aac24+chromium-142.0.7444.176, the owner's no-root build, WO-234).
- **5867, read only:**
  - Ubuntu 26.04.1, same libcef sha256.
  - The binary was copied to /tmp there. `ldd` resolved all 228 libraries, both with `LD_LIBRARY_PATH` and through RUNPATH from
    a `bin/`+`lib/` layout.
  - The copy was removed afterwards.
- FFmpeg is the Ubuntu 26.04 system build (libavcodec62, `--enable-gpl`, links libx264/libx265), so that combination is GPL.
  The CMake cache uses `FFMPEG_LIBRARY_DIRS=/usr/lib/x86_64-linux-gnu`.
- CEF's `libcef_dll_wrapper` is static (BSD-3-Clause, `build-wo1020/cef-prefix/src/cef/LICENSE.txt`). CasparCG is
  GPL-3.0-or-later (`LICENSE` + "(at your option) any later version" in the source headers).

**Is `caspar/patches/` the complete source? No.** `git -C ~/caspar-build/src-v2 log v2.5.1-stable..highascg-main` has 67
commits on top of upstream `v2.5.1-stable` (ec38d944).
- **Covered by `caspar/patches/`:**
  - WO-1020 (5), WO-790, WO-847 (3), WO-867 (2), WO-869 (2), WO-990 (2), WO-991, WO-992, WO-993.
  - WO-800 and WO-820 are uncommitted-diff exports. `git patch-id --stable` shows they are identical to commits d6519d5d3 and
    dd7862fba.
- **Gaps: HighAsCG commits with no patch file:**
  - 62f68af8f and 10098e2e7 (WO-234 CEF pin, C++20 captures)
  - f0f16967c (WO-613 pixel subdir + WO-594 shm consumer)
  - 886998cc1 (OSC big-endian)
  - 1174120ce (WO-742 shm producer; its source is mirrored in `caspar/modules/shm/` but not as a patch)
  - 24db35cca (WO-753 Boost system)
  - 08de7a2e4 ("Local Build": FFmpeg stream consumer auto-reconnect)
- **Gaps: third-party commits with no patch file:**
  - Art-Net (Eliyah Sundström, 8)
  - CasparCG Enhanced (Gregory Meisel, 10)
  - pixel consumer #1751 (Dimitry Ishenko, 14)
  - MIXER BLUR/SHARPEN/GRAIN #1762 (C-alcaide, 4)
  - cffc63c0e, f7b08f396, f940e7026
- No patches were invented. The authoritative source is now the fork tag plus a `git archive` tarball of the exact commit
  (below). `caspar/patches/` stays the human-readable series.

## What was done

**`caspar/PINNED.json` (new, written by the publish script).**
- version, sha, shortSha, binarySha256/Size, releaseTag `caspar-5c3373ec5`, asset `casparcg-5c3373ec5-linux-x64.tar.zst` +
  assetSha256/Size, tarballPath, builtOn, cefVersion, libcefSha256, licence.
- `source: { base, commit, describe, repo, tag, treeUrl, sourceAsset, sourceAssetSha256, patches }`.
- Top-level strings are one per line so the root helper reads them with `sed` (no node or jq needed in that path).

**`tools/release/publish-caspar-build.sh <binary> [--dry-run]` (new, box-side).**
- **Checks, each fatal:**
  - The binary embeds `<x.y.z> <sha9> ` for the `--src` HEAD (default `~/caspar-build/src-v2`, `highascg-main`).
  - The source tree is clean.
  - `ldd` against `~/highascg/lib` resolves everything except libcef.
  - The fork has the commit on `highascg-main` and tag `highascg-<sha9>` pointing at it (`git ls-remote`). If not, it prints
    the exact `git tag`/`git push highascg …` commands and stops. It never pushes.
- **Packs (reproducibly: sorted, commit-time mtime, owner 0, fixed modes, `zstd -19 -T1` / `gzip -n`):**
  - `casparcg-<sha9>-linux-x64.tar.zst` with `casparcg`, `LICENSE` (the GPL text from the Caspar tree), `LICENSE-CEF.txt` and
    `SOURCE.txt`.
  - `casparcg-source-<sha9>.tar.gz`: `git archive` of the commit + the build script as `HIGHASCG-BUILD.sh`.
- Writes PINNED.json and the release notes (with the fork tree URL and the source asset).
- Without `--dry-run`, it creates or updates the `caspar-<sha9>` **prerelease** on mko1989/highascg.
- Two dry runs gave byte-identical assets, so a dry run writes the same PINNED.json the real run will.

**`tools/release/fetch-pinned-caspar.sh` (new, CI).**
- Downloads the pinned asset (`gh release download`, curl fallback).
- Checks the asset sha256, unpacks into `caspar/bin/`, and checks the binary sha256 and size.
- Any mismatch or a 404 → exit 1.

**`.github/workflows/ci.yml`.**
- The release job gets the step "Pinned Caspar build" (installs zstd if missing, runs the fetch), then
  `make-github-release-server.sh --no-godot-clients --require-caspar`.
- Only the release job fails on a missing asset. verify, godot and build-client do not touch it.

**`tools/release/make-github-release-server.sh`.**
- `add_pinned_caspar` adds `caspar/PINNED.json caspar/README.md caspar/patches caspar/bin` when `caspar/bin/casparcg` is
  there.
- It refuses a binary whose sha256 is not the pin. `--require-caspar` makes a missing one fatal.
- The release notes get a Caspar line: the version, the sha256, the install/rollback/hold behaviour, the GPL licence, and
  where the source is (tree URL + source asset).

**`scripts/exfat/highascg-caspar-swap.sh` (new).** Subcommands `plan | apply | verify | rollback`, with `--root` (tests use a
fake root).
- **apply** swaps only when `caspar/bin/casparcg` matches the pin and differs from `bin/casparcg`.
- **apply does not swap, and logs why + writes `bin/caspar-swap.state`, when:**
  - `~casparcg/.highascg/caspar-hold` exists (the owner's manual hold for hand-tested builds);
  - that build was rolled back before (no retry loop on live sticks until the state file is deleted);
  - `ldd` with the box's `lib/` has an unresolved library (run as the service user when root);
  - the box's `lib/libcef.so` is not the pinned CEF.
- **The swap itself:**
  - Hard links `bin/casparcg` → `bin/casparcg.pre-<stamp>` and `bin/casparcg.prev` (the old `.prev` becomes
    `.prev.old`; no extra disk).
  - `cp` to `bin/casparcg.new`, then `mv -f`.
  - Keeps the newest 3 `casparcg.pre-<stamp>`. Hand-made `pre-wo*` backups are never pruned.
  - Restarts `casparcg-server.service` only if it runs, and node only if it runs (OSC latch, WO-613).
- **verify** polls node `GET /api/state` → `caspar.versionLine`:
  - The pinned sha shows up → `verified`.
  - The clock starts when a `casparcg` process runs. If Caspar has run for 180 s, node answered and the sha never showed up →
    **automatic rollback** (restore the backup, `reset-failed`, restart Caspar + node).
  - Node never answered or Caspar never ran within 900 s → `unverified`, the new binary stays (no blind rollback).
- **Policy for a newer or unknown Caspar on the box:** the release wins, unless the hold file exists.

**`scripts/exfat/highascg-apply-server-drop.sh`.**
- After the merge, it runs the swap helper **from the drop it just merged** (`${dest}/scripts/exfat/…`, overridable).
  `/usr/local/lib/highascg` is refreshed only after the apply.
- Call: `apply --verify detach`. As root, the verify runs in its own transient unit (`highascg-caspar-verify-<stamp>`, log in
  `/var/log/highascg/caspar-swap-<stamp>.log`). So it outlives the web-UI helper and works at boot, where node and Caspar
  start later.
- A swap failure never fails the update. Executing a casparcg-owned script as root is the same trust the helper refresh
  already grants (it installs `${DST}/scripts/exfat/*` as root helpers).
- The web-UI helper needs no change: it stops node before the apply, so Caspar restarts without node and node starts after.

**`tools/sweep/check-caspar-pinned.js` (new, in the app group).** `caspar.pinned` compares the running VERSION with the pin:
- pass when it matches;
- warn with the reason when it does not (held / skipped / rolled back / dev checkout / no swap recorded yet = an updater
  older than this WO);
- skip without a pin or a Caspar connection.

**`THIRD_PARTY_NOTICES`.** A CasparCG Server (GPL-3.0-or-later) entry: the fork URL, the tag rule, the source asset, and
caspar/patches. CEF (BSD-3-Clause, static wrapper + libcef.so from lib/). FFmpeg (system packages, `--enable-gpl`).

**`caspar/README.md`.** A "Source" section at the top (fork URL, one tag per shipped build, the pin). "Publish" steps in the
deploy procedure: push the branch, tag and push it, publish with a dry run first, commit PINNED.json. The distribution
paragraph is updated, and the hold file is documented.

## What was verified

- **Publish dry run** (the real binary, `src-v2` @ 5c3373ec5, the real fork via `git ls-remote`):
  - All checks pass. Assets: 2 362 004 B binary tarball, 1 304 031 B source tarball (587 entries incl. `src/modules/shm/`,
    `LICENSE`, `HIGHASCG-BUILD.sh`).
  - Re-running produced byte-identical assets and an identical PINNED.json.
  - `--remote upstream` (no branch, no tag there) stopped with the two push commands and wrote no pin.
- **Fetch:**
  - From the dry-run asset: OK, 4 files in `caspar/bin/`.
  - A garbage asset fails on the asset sha256.
  - The real download 404s today (not uploaded yet), and that fails as intended.
- **Server release dry run in a scratch mini repo:**
  - `--require-caspar` fails without `caspar/bin`.
  - With it, the paths include `caspar/PINNED.json caspar/README.md caspar/patches caspar/bin`, and the notes carry the Caspar
    + source line.
  - A tampered binary fails.
  - A real `tar` with the archive-common excludes keeps `caspar/bin/*`.
- **Swap helper on a fake root** (`tools/smoke/smoke-wo1022-caspar-swap.test.js`, 8 tests: real ELF stand-ins, stub
  systemctl/probe):
  - swap + backups + restart only while running;
  - boot swap without restart;
  - the 4 skip reasons;
  - verified;
  - rollback (+ Caspar and node restarted, no retry);
  - unverified;
  - manual rollback + pruning;
  - the real `highascg-apply-server-drop.sh` running the swap from a fake drop.
- `tools/smoke/smoke-wo1022-release-carries-caspar.test.js`: 8 tests (pin shape, publish guards, CI wiring, fetch tamper,
  apply hook, sweep check, notices). 16/16 pass, together with WO-736/830c/499/501/728 (55/55). Full offline suite (`node tools/ci/run-offline-tests.js`, without the two new files registered): 5622 tests, 5615 pass, 0 fail, 4 skipped.
- The sweep check against the live `/api/state`: `pass — running the pinned 2.5.1 5c3373ec5 Stable`.
- **Gates:**
  - max-file-lines 0 over;
  - lint 0 errors;
  - format:check clean;
  - unwired exports: no new;
  - verify:script-paths OK;
  - shellcheck -S warning clean on the new and changed scripts.

**Not verified (open):**
- the real upload;
- the first CI release that carries Caspar (it will fail until the asset is uploaded, so upload **before** pushing
  PINNED.json);
- a real root swap + detached verify on a release box (5867). The first update there only installs the new helpers (see
  Investigation), and a second update swaps 2476644c4 → 5c3373ec5;
- the `systemd-run` detach path (root only, not exercised offline).

### Lead review + upload (09.11, ~14:40)

- **Review fix (`scripts/exfat/highascg-caspar-swap.sh`):** `verify` left a binary that dies at start in place. `pgrep`
  never sees it, so the result was "Caspar never started" → unverified, and the binary stayed. New `gate_released`
  (the WO-638 file `~/.highascg/run/caspar-screens-ready` holds this boot's id; hook `HIGHASCG_CASPAR_GATE_CMD`): once
  the gate is released, no casparcg process within `UP_SEC` while node answers → rollback. After a web-UI update the
  gate is already released, so this case is covered. At boot, a gate that is still closed keeps the old leniency.
  Two smokes were added (gate released + never runs → rollback; gate closed → unverified, binary stays). The fixture
  sets the gate hook to `false`, so tests never read the box's real gate file.
- **Tests:** `smoke-wo1022-*` + `smoke-eggs-exclude*` → 65/65 pass; `shellcheck -S warning` clean on the swap,
  release and drop-apply scripts.
- **Real upload:**
  - Command: `bash tools/release/publish-caspar-build.sh ~/caspar-build/build-wo1020/shell/casparcg --out-dir <scratch>`.
    It created the prerelease `caspar-5c3373ec5` on mko1989/highascg; `caspar/PINNED.json` is identical to the dry run.
  - Downloaded again: asset sha256 `0ffb8178…` and source `115730b2…` = the pin.
  - The package holds `LICENSE` (GPL v3), `LICENSE-CEF.txt`, `SOURCE.txt` (fork tag + source tarball) and `casparcg`,
    md5 6372ec07… = `~/highascg/bin/casparcg`.
  - The source tarball is `git archive` of 5c3373ec5.
- **Public source:** https://github.com/mko1989/casparcg-server, a GitHub fork of CasparCG/server created by the lead
  on 09.11 with the owner's choice "Fork as casparcg-server". Default branch `highascg-main`, tag `highascg-5c3373ec5`.

### 5867 never swapped (09.11, ~15:00) → WO-1023

- 5867 updated to release 133601 but kept f04acf2f. Every web-UI update there exits 1 at the unguarded `.applied-stamp`
  write: there is no drop-update volume, `~/exfat` is empty and root-owned.
- So the root helpers never refreshed and the swap step never ran. "A second update swaps" was also wrong, because a
  re-apply of the same release skipped the swap.
- Both are fixed in [WO-1023](1023_WO_update_apply_fails_without_drop_volume.md). The live swap on 5867 waits on its
  one-time sudo bootstrap.
