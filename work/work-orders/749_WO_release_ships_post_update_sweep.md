# WO-749 — Releases did not ship the post-update sweep: .4 ran a stale copy after every update

**Status: DONE (25.10.26 — smoke 1/1 (fails on the old member list: checked); .4 sweep with the shipped set: 27 pass / 2 warn / 0 fail; this box 25 pass / 4 warn / 0 fail. The next release carries the files; owner-QA: .4's automatic sweep after that update shows no DeckLink "module not loaded" warning.)**

Owner, 25.10: *"run checks on both machines"* (after the WO-748 "Phase: ?" update).

## Investigation

Full sweep (`node tools/sweep/run-sweep.js`, WO-730) on both boxes, 25.10 09:08:

- This box: 24 pass / 4 warn / **1 fail** — "kiosk running and connected — no godot process".
  - Not a fault. The kiosk was restarted at 09:08:30 (new process `godot --path …/godot/client --`, log
    `godot2026-10-25T09.08.30.log` rotated cleanly, no crash) while the sweep was checking. A rerun passes.
- .4: 25 pass / 4 warn / 0 fail, plus "DeckLink driver + cards — WARN: blackmagic module not loaded".
  - But `blackmagic_io` **is** loaded on .4 (`/proc/modules`, refcount 4; `/dev/blackmagic/io0..2`;
    DKMS built for 6.8.0-117 and 7.0.0-38).
  - WO-737 fixed exactly that false warning (`verify-decklink.sh` reads `/proc/modules`). .4's copy
    did not have the fix: `tools/startup/verify-decklink.sh` dated Oct 24 18:49, no `/proc/modules` line.
- Root cause: `scripts/lib/archive-common.sh` `archive_common_server_tar_members` shipped only `tools/runtime`
  from `tools/`. The release extract on .4 (`/var/cache/highascg/updates/extract-2026-10-25T080500Z/tools`)
  contains only `runtime/`.
  - Yet the server runs `tools/sweep/run-sweep.js` after every update (`src/system/sweep-after-update.js:74`).
  - So .4's sweep, its verifiers and their fixes stayed frozen at the copy from 24.10 18:49.
  - A box installed fresh from a release would have no sweep at all.
- What the sweep needs, traced from its requires and spawns:
  - `tools/sweep/*`;
  - `tools/startup/verify-*.sh` (`checks-system.js:42`);
  - `tools/e2e/sandbox-server.js` (`run-sweep.js:66`);
  - `tools/e2e/replication-check.js` (`checks-cluster.js:9`);
  - `tools/ci/check-require-integrity.js` (`checks-code.js:95`);
  - `tools/runtime/check-installed-helpers.js` (already shipped).
  - Those files need only Node built-ins and `src/`.
- Other warnings, both boxes (explained, no code change):
  - 11 Syncthing conflict copies, the same on both: `projects/untitled*.sync-conflict-202606*` and their
    autosaves, from June. `projects/` syncs, so deleting them on one box deletes them on both: **owner's call**.
  - "linked servers … same build": this box is the git checkout. Its `package.json` / `BUILD_STAMP`
    (2026.05.20 / 180504Z) are not bumped by commits, while .4 reports the release stamp. Expected on the dev box.
  - This box only:
    - `/usr/local/lib/highascg/{decklink-dkms-cache-lib.sh, highascg-apply-server-drop.sh}` differ from the repo;
      there is no sudo here (owner command below);
    - no DeckLink `.deb` cached on the exfat / bridge sticks (informational: install-from-stick only).
  - .4: `decklink-dkms-cache-lib.sh` differed only by the WO-721 test seam (`DECKLINK_DKMS_CACHE_MOUNTS`, same
    behaviour when unset).

## What was done

- `scripts/lib/archive-common.sh`: the server tarball members gain `tools/sweep`, `tools/startup`,
  `tools/e2e/sandbox-server.js`, `tools/e2e/replication-check.js` and `tools/ci/check-require-integrity.js`.
  - Named files, not all of `tools/e2e` or `tools/ci`: the sweep needs those five, and the rest is dev tooling.
  - The update's rsync excludes (`tools/eggs/`, `tools/release/`, `tools/smoke/`) don't touch them.
- `tools/smoke/smoke-wo749-release-ships-sweep.test.js` (in FILES):
  - extracts the shipped set with the real tar rules into a temp box;
  - checks that every verifier `checks-system.js` names is there;
  - requires every sweep module from that box alone;
  - runs the require check there.
- On .4 (owner authority):
  - `decklink-dkms-cache-lib.sh` reinstalled from the repo (`sudo install -m 0644`, old copy at
    `/tmp/decklink-dkms-cache-lib.sh.pre-wo749`);
  - the five sweep paths copied from this repo, which is what the next release delivers.

## What was VERIFIED

- Smoke 1/1. With `archive-common.sh` from HEAD (the old member list) it fails: "tarball members".
- .4 after the copy:
  - `node tools/runtime/check-installed-helpers.js` → 24 same, 0 differ;
  - full sweep: **27 pass / 2 warn / 0 fail** (left: the June conflict copies, the build-stamp comparison with
    the dev box);
  - the DeckLink check passes (kernel module loaded).
- This box, full sweep rerun: **25 pass / 4 warn / 0 fail**. The kiosk check passes; the warnings are the ones
  explained above.
- Owner, this box's helpers (no sudo here):
  `sudo install -m 0755 scripts/exfat/highascg-apply-server-drop.sh /usr/local/lib/highascg/` and
  `sudo install -m 0644 scripts/lib/decklink-dkms-cache-lib.sh /usr/local/lib/highascg/`.
