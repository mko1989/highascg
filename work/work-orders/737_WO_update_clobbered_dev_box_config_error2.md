# WO-737 — An update meant for .4 landed on the master and reset its config; "error 2" across the GUI

**Status: IN PROGRESS (24.10.26) — config restored on the box and proven; fixes + tests done; .4 updated to
2026-10-24T183220Z with its config intact; part 2 (release lacks client/lib) fixed, .4's update to it pending.**

Owner, 24.10: *"on the .4 downloading extracting then error 2 (with something else in the error) check the whole gui
for that error as ive seen it in couple places."*

## Investigation

**Where the update went.** .4 still reports `buildStamp 2026-10-23_194203` and an empty update job. This box (the
master) reports `BUILD_STAMP 2026-10-24T180504Z`, and its journal shows `sudo … highascg-webui-server-update.sh
--detach --source /var/cache/highascg/updates/extract-2026-10-24T180504Z` followed by a service restart at 20:09:40.
.4's kiosk is the pre-WO-735 build, so its Settings → Updates still talks to the server it follows: the master. The
owner pressed Install on .4 and updated the master. (WO-735 already fixes that pane; .4 just doesn't run it yet.)

**What the update did to this box** (`/var/log/highascg/update-20261024T180934Z.log`):

1. `highascg-apply-server-drop.sh:195` merges the release into `~/highascg` with rsync. Its excludes
   (`config/server-update-rsync-excludes.txt`) protect only `config/casparcg.config`. The tarball carries the
   committed factory `config/*.json`, so every config file the box had changed was replaced by the factory copy:
   `screen_destinations.json`, `caspar_server.json`, `device_graph.json`, `osc.json`, `ui.json`, …
   - Damage, comparing the `Config:` dump the server logged at 19:14:14 with the one at 20:09:40: the destinations
     **PGM/PRV 1** (3072×1024, custom mode) and **PGM/PRV 2** were gone (only Operator GUI left); the device graph
     went from 11 connectors to 0 (DeckLink 1/2 inputs, destination inputs, GPU ports); `casparServer` lost
     `decklink_input_count 2`, the custom 3072×1024 screen mode, and the vsync / always-on-top / interactive flags.
     The live channel map showed 0 screens while Caspar still ran its old 5 channels. Caspar's generated
     `casparcg.config` is excluded, so Caspar itself was untouched.
   - 20:09:58: the kiosk's project save embedded the reset hardware into `projects/godot_test.json`. Reopening that
     project would have applied the reset again (`project-activate.js:196` → `applyHardwareConfigFromProject`).
2. `highascg-apply-server-drop.sh:225` ran `npm ci --omit=dev` in `~/highascg`. That removed the dev box's
   devDependencies: no eslint, prettier or vite, so `npm run lint` and `build:client` broke.
3. It wrote the release stamp into `package.json`'s `version`.
4. It staged the drop to `/home/casparcg/bridge/drop-update/` (retain mode), which the boot service re-applies when
   its stamp differs from `BUILD_STAMP` (`stamp_unchanged_skip`, `:148`). Both stamps are `2026-10-24T180504Z` now,
   so boot skips it.

Root cause: this box runs from a git checkout. A release drop is meant for an installed tree. Applied here, it lands
on the working tree, and nothing in the apply protects the box's own `config/*.json` on any box.

**"error 2".** `core/net_util.gd:17` turned every failed Godot `HTTPRequest` into `"transport error %d" % result`;
result 2 is `RESULT_CANT_CONNECT`. Every pane shows `res.error` verbatim, so a server that is restarting or down reads
"transport error 2" everywhere. That is the "couple places" the owner saw. In Settings → Updates: download → extract →
the apply hands off to a detached unit (`server-update.js`, phase `detached`, `done: true`). The pane stopped polling
and called `refresh(true)` at once, against a server that was already stopping. So "(version unavailable: transport
error 2)" and the check line showed the bare code, and the poll appended a new one every 1.5 s.
`Api.get_bytes` reported a transport failure as `HTTP 0`.

**Transitional catch.** `highascg-webui-server-update.sh:211` runs the *installed* apply script
(`/usr/local/lib/highascg/`) and refreshes it from the new tree only afterwards (`:233`). The first update that carries
this fix therefore still runs the old apply. On .4 the installed copy is replaced over SSH before the update. On this
box there is no sudo to replace it. The new Node guard keeps the GUI from starting an update here at all, and the boot
path skips while the stamps match.

## What was done

**On the box (restore).** The pre-update config was taken from the 19:14:14 journal `Config:` dump. The current files
were backed up to the scratchpad (`config-after-update/`), then the pre-update `casparServer`, `screenDestinations`,
`deviceGraph`, `ui` and `operatorTools` slices were posted through the server's own Settings save (`POST /api/settings`).
That path persists the files and doesn't restart Caspar. `projects/godot_test.json` was then re-saved through
`POST /api/project/save`, which re-embeds the restored hardware. The dev dependencies were reinstalled with
`npm install --no-save --include=dev --include=optional`, which removes nothing the running server uses.

**Fixes.**

- `scripts/exfat/highascg-apply-server-drop.sh`:
  - the merge excludes `/config/*.json`, and a second pass copies those files with `--ignore-existing`. A drop's
    factory config fills in a file the box lacks and never replaces one it has. Support files under `config/`
    (excludes lists, udev rules) still update. This is narrower than excluding `/config/` (which would freeze those),
    and anchored, so `src/config/` is unaffected (the WO-512 lesson).
  - it refuses to apply onto a git checkout (`dest/.git`). That covers the boot, USB and GUI paths alike.
- `src/system/server-update.js` `startApplyJob`: refuses on a git checkout before downloading, so the GUI says
  "This server runs from a git checkout — update it with git, not from a release." instead of half-updating.
- `godot/client/core/net_util.gd`: `transport_error(result)` gives words: "server not reachable (restarting or
  offline)", "server address not found", "server did not answer in time", otherwise "network error (HTTP request
  result N)". Every pane benefits through `parse_response`. `core/api.gd` `get_bytes` uses it too.
- `features/settings/updates_pane.gd` + `updates_model.gd` `restart_step`: after a `detached` hand-off the pane
  says "Waiting for the server to restart…", keeps polling through the gap, and refreshes once a server with no job
  answers (the new process). It gives up with a message after 180 s.

## What was VERIFIED

- Restore, live on this box: after the POST, the files match the 19:14 dump (destination ids, the 11 graph connector
  ids, every `casparServer` key except `screen_count`, which the server derives from the destinations: now 2, as the
  pre-update topology implies). `/api/state` channel map: screens `PGM/PRV 1`, `PGM/PRV 2`, pgm [1,3], prv [2,4].
  The re-saved project embeds 3 destinations, 11 connectors and `decklink_input_count 2`. Lint runs again (0 errors).
- Pre-existing mismatch, not caused by the update: PGM/PRV 2 was created at 17:52 today (its id's timestamp) and
  Caspar was never regenerated for it. `casparcg.config` dates from 22.10 and has one screen pair, so the server maps
  screen 2 onto channels 3/4 (Operator GUI shm and DeckLink 1). Apply the Caspar config (or drop PGM/PRV 2) before
  using screen 2.
- `tools/smoke/smoke-wo737-update-keeps-box-config.test.js` (in FILES), 3 tests:
  - box config kept, a new factory file arrives, support files and `src/config` update;
  - the apply refuses a git checkout and leaves it untouched;
  - `startApplyJob` refuses on a git checkout.
  The first test **fails without the apply change** ("the box config is kept") and passes with it.
  `smoke-server-update-retain` still passes.
- Godot `--check` boot OK; `--test` 21517 passed / 0 failed (+7 assertions: transport words, the restart wait).
- Gates on a clean export: repo integrity OK, 0 files over 500 lines, no new unwired exports, `--no-http` boot OK,
  Prettier clean, ESLint 0 errors / 214 warnings; `test:ci` result is recorded in the commit message.
- .4 prepared (24.10, over SSH): `/usr/local/lib/highascg/highascg-apply-server-drop.sh` replaced with the WO-737
  copy (`grep -c WO-737` = 2), so .4's first update keeps its own `config/*.json`. .4 has no `.git`, so the new
  refusal doesn't touch it.
- Not yet live on this box: `server-update.js`'s guard needs a server restart (left to the owner). Until then, Install
  pressed on .4's *old* kiosk would update this box again; update .4 from its own web UI (http://192.168.0.4:4200).
- Owner-QA: on .4, after its update, Settings → Updates shows "Waiting for the server to restart…" then "Server is
  back." instead of "transport error 2".

## Part 2 — comparing the two boxes after .4's Ubuntu 26.04 / kernel / NVIDIA upgrade (owner, 24.10: "compare the two servers to check if there are any regresions with updating ubuntu, nvidia, kernel etc.")

### Investigation

The same read-only snapshot on both boxes (`boxprobe.sh` in the session scratchpad), plus each box's post-update
self-check (`GET /api/system/update/sweep`).

| | this box (.23) | .4 |
|---|---|---|
| OS / kernel | Ubuntu 24.04.4, 6.8.0-117 | Ubuntu 26.04.1, 7.0.0-38 |
| GPU / driver | RTX PRO 4000 Blackwell, 595.71.05 open | RTX 2080 SUPER, 615.71.09 server-open |
| DeckLink | desktopvideo 16.2a1, `blackmagic_io` loaded | 16.4a1, loaded |
| Node / ffmpeg CLI | 24.18.0 / 6.1.1 | 24.22.1 / 8.0.1 |
| Caspar binary | md5 d5dee499…, no missing libs | same binary; `ldd` misses `libcef.so` (run.sh supplies `lib/`; Caspar runs) |
| Godot | 4.7.2 | 4.7.2 |
| Kernel log | exFAT dirty-volume notices, 2× `task sync blocked > 122 s` (USB stick sync), ACPI `_DSM` noise | UCSI i2c timeouts on the 2080's USB-C controller, nothing playout-related |
| Xorg | xkb option warnings | the same + `NVIDIA: Failed to request fliplock` (GeForce, no framelock: harmless) |

Findings:

1. **A regression, from packaging, not from the OS: releases don't ship `client/lib`.** 14 server code paths import
   `client/lib/*.js` at runtime (scene take payloads `scene-take-payload.js`, take-look transition presets, new layer,
   look presets, preview push, lower thirds, audio cross-screen, project assets/hardware checks, the shader live
   session). `archive-common.sh` excluded `client/`, and the update excludes listed `/client/`. .4 is installed from
   releases and has no `client/` at all. Its sweep shows `/api/scene/layer-options` and `/api/scene/effect-registry` →
   502 `Cannot find module …/client/lib/program-audio-layouts.js`. The take paths fail the same way when used. Their
   transitive closure is 33 files, all inside `client/lib` (1.6 MB).
2. **A false alarm on both boxes: "blackmagic module not loaded".** `tools/startup/verify-decklink.sh:78` ran
   `lsmod | grep -q blackmagic` under `set -o pipefail`. grep -q exits at the first match, lsmod then dies on SIGPIPE,
   and the pipeline counts as failed. `lsmod` shows `blackmagic_io` on both boxes.
3. Not regressions, recorded so nobody chases them:
   - .4's Caspar log has 5 boost::asio `remote_endpoint: Transport endpoint is not connected` exceptions, each right
     after an AMCP client disconnects mid-reply. Same binary as here; Caspar keeps running.
   - .4's watchdog killed a Caspar at 20:12 that had been held 2463 s by the start-up question (WO-645 `ask` mode).
     Expected.
   - This box: `PLAY 6-1 DECKLINK 1` / `PLAY 7-2 DECKLINK 2` → `COMMAND_UNKNOWN_DATA` since 17:56. PGM/PRV 2 was
     created at 17:52 and Caspar not regenerated, so the server's channel plan has the DeckLink inputs on 6/7 while
     Caspar runs 5 channels. Present before the update (818 occurrences 17:56–20:09).
   - The massive DeckLink A/V-sync drift warnings (≈16k/day) are on this box (the 8K Pro inputs), not on .4.
   - **The master role moved to .4** (epoch 4, auto failover at 20:12:04, "highascg7580 unseen 13 s"), while this box
     restarted for the update. Auto mode doesn't move it back. This box's kiosk now follows .4, and .4's kiosk
     correctly stays home. .4 has no destinations of its own.

### What was done

- `scripts/lib/archive-common.sh`: `client/lib` joins the server tarball members. The `--exclude=./client` never
  matches a member passed as `client/lib`, as the WO-687 comment explains for `config`.
- `scripts/exfat/highascg-apply-server-drop.sh`: its own rules come before the installed excludes:
  `--include=/client/ --include=/client/lib/*** --exclude=/client/*`. The installed
  `/etc/highascg/server-update-rsync-excludes.txt` is refreshed only by the install script, and every box still lists
  `/client/` there.
- `tools/startup/verify-decklink.sh`: reads `/proc/modules`.

### Verified

- `smoke-wo737-update-keeps-box-config.test.js`, now 5 tests:
  - the apply carries `client/lib`, not `client/assets`;
  - `client/lib` is a tarball member, the real tar rules keep every server-imported `client/lib` module, and their
    closure stays inside `client/lib`.
  Both of those fail without the change.
- `verify-decklink.sh` live on this box: `WARN: blackmagic module not loaded` before, `OK: kernel module loaded:
  blackmagic_io` after.
- rsync rule check: `client/lib/a.js` lands, `client/assets` doesn't, `src/client/` is unaffected.

### Live on .4, and a second gap: client/lib is ES modules

The fixed apply was installed on .4 first, its config was backed up (`~/config-backup-before-185006Z`), and .4 was
updated to release 2026-10-24T185006Z (CI run 40122198739: verify, build-client, godot and release all green).
- The config came through byte-identical (`diff -rq` against the backup: no difference; mtime still 20:12:23).
- `client/lib` arrived (238 files).
- The scene routes still answered 502, with a new error: `Cannot use import statement outside a module`. The files
  are ES modules, and Node only treats them as such because of `client/package.json` (`"type": "module"`). The root
  `package.json` says `commonjs`. The test had checked that the files were in the tarball, but never imported them.

Done:
- `client/package.json` joins the tarball members.
- The apply adds `--include=/client/package.json`.
- Test 4 now rebuilds what a release box has: the root package.json plus the client files from the real tar rules.
  It dynamically imports every module in the server's client/lib closure from there.

Verified: smoke 5/5. With the member removed, test 4 fails with .4's exact error.
