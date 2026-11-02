# WO-926 — The 01.11 ISO's server never started (jszip only via an optional dependency); ISO build now boots the pruned server

**Area:** os-iso, process
**Status: DONE (02.11.26 — reproduced on an ISO-pruned worktree, fixed + build gate; smokes; the next eggs build proves it)**

Owner, 02.11.26, second machine 192.168.0.31 after emptying the stale stick drop (WO-925) and rebooting: "the node didnt
come up at all now". Then: "dont focus on fixing the .31 but rather check whats broke and fix it for next iso eggs build."

## Investigation

- `highascg.service` on .31 restarted 261 times: `Error: Cannot find module 'jszip'`, require stack
  `src/fixtures/gdtf-library.js:26` ← `routes-gdtf-library.js` ← `routes-gdtf-share.js` ← `src/api/router.js` ← `index.js`.
- `jszip` was **not declared** in package.json. It came in only through `exceljs`, which is an `optionalDependencies`
  entry. `install-iso-defaults.sh` prunes with `npm prune --omit=dev --omit=optional`, so the ISO squashfs had no
  `exceljs` and no `jszip` (checked in the .31 lower layer: `exceljs NO`, `jszip NO`). WO-825 (30.10, GDTF library)
  added the top-level `require('jszip')`. **Every ISO built since 30.10 has a server that exits at boot.** On .31's first
  boot the 25.10 stick drop (WO-925) hid this, because that older code has no GDTF library.
- Scan of `src/` + `index.js`: `jszip` was the only package required but not declared. `naudiodon` (optional) is
  required inside a try/catch (`src/audio/audio-devices.js:335`).
- Reproduced off the box with a clean worktree, `npm ci --omit=dev --omit=optional`, `src/previs` removed as the eggs
  exclude list does, and the e2e sandbox server (hermetic: scratch HOME, `--no-caspar`, no X):
  - `00a2b9d8`: 90 modules, no jszip. Server exit 1, `Cannot find module 'jszip'`.
  - after the fix: 95 modules. Server `UP`, and no `[warn]`/`[error]` lines in its log.
- A second fault seen on .31: node came up later than run.sh's 240 s gate timeout, so **Caspar started on the config already
  on disk** (a 1-channel `casparcg.config` from the earlier session). The launcher answer then logged
  `destination cables moved: none — nothing changed` and only re-laid X out. In `resolve` (boot-screen-assignment.js),
  `held` is false as soon as Caspar answers AMCP, and the full apply ran only on `changed`. So Caspar kept a config node
  never wrote, and node's AMCP calls failed with `403 PLAY FAILED` (`route://4`, `route://5` on a 1-channel server).
- Not changed, recorded:
  - **DeckLink install time.** The WO-704 cache works: the 2nd boot logged `restored … (no compile)`, and the two
    postinst build steps took ~15 s. The remaining ~48 s of the 63 s is `dpkg -i` unpacking the vendor debs from the
    stick. That is the cost of WO-430 (no DeckLink payload in the ISO). Node is ordered after it on purpose (it probes
    DeckLink at start).
  - **The server's `src/previs` is excluded from ISOs** (owner directive 19.07, `penguins-eggs-exclude-highascg-*.list`).
    The Godot Previs tab (WO-607) fetches `/api/previs/models`, so on an ISO its model list and loading fail
    (`[modules] skipped "previs"`). This is an owner decision.

## What was done

- `package.json` / lock: `jszip ^3.10.1` in `dependencies`. The lock stays at the 3.10.1 it already had (npm offered
  3.10.2, published 09.2026; not taken here).
- `tools/smoke/smoke-wo926-runtime-deps-declared.test.js` (curated, `offline-test-files-3.js`) checks three things:
  - every bare `require` in `src/` and `index.js` is a builtin or in `dependencies` (allow-list: `naudiodon`, guarded);
  - jszip is direct;
  - the build runs the boot gate after the prune.
- `tools/eggs/live-usb/verify-production-boot.js` + `install-iso-defaults.sh`: after the prune, the build starts the
  server from the pruned tree in the sandbox and **stops the build** if it does not answer.
- `src/system/boot-screen-assignment.js` `resolve`: `stale = Caspar up && this boot's gate never opened` (the run.sh
  timeout). That case now gets the full apply (config write + Caspar restart) even when nothing moved.
  Smoke in `smoke-wo638-boot-screen-assignment.test.js`.

## What was verified

- The gate script on ISO-pruned worktrees: `00a2b9d8` → `FAILED` (exit 1), `20e63401` → `OK` (exit 0).
- `smoke-wo926` 3/3. It fails with the old package.json, naming `src/fixtures/gdtf-library.js: jszip`.
- `smoke-wo638` 21/21. The new case fails 20/1 with the `stale` term removed.
- Full offline suite, lint (my files), format:check, line limit, script paths: see the commit.
- On .31: jszip + 4 deps copied into its live node_modules by hand, and node came up. That is only a stopgap for this
  session; the fix lands with the next eggs build. On that build, expect the `verify-production-boot: OK` line in the
  build output.
