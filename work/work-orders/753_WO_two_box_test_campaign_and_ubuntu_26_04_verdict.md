# WO-753 — Two-box test campaign (standalone / linked / each master / refusals / failover) + is Ubuntu 26.04 / NVIDIA 615 safe for the dev box

**Status: IN PROGRESS (25.10.26)**

Owner, 25.10: *"i want you to run all sorts of tests on both these machines. both when they are connected, or
standalone, one is master than the other, what happens on refusal etc etc. i also want you to run more comperative
tests so i know the latest versions of ubuntu nvidia etc are running completly fine and its safe to update the main
dev machine too and the whole project."*

Earlier rounds this builds on: WO-724 (two-box interop + timing, mixed versions), WO-725 (cluster e2e harness),
WO-735 (suite on .4 after the 26.04 upgrade), WO-737 part 2 (first OS comparison), WO-746 (shared show, off).

## Test matrix

| # | area | how | disturbs |
|---|---|---|---|
| A1 | versions side by side | `boxprobe.sh` (read-only) on both | nothing |
| A2 | Caspar's libraries on 26.04 | `/proc/<pid>/maps`, `dpkg -S`, apt simulations | nothing |
| A3 | offline suite on 26.04 | HEAD copy on .4 (`~/wo753-suite`), `npm ci`, `test:ci` | .4 CPU |
| A4 | Godot client tests + boot on 26.04 | headless `run_tests.gd` / `--check` on .4 | nothing |
| A5 | post-update sweep, both | `run-sweep.js --peers` | nothing |
| A6 | GPU / Caspar render health | Caspar profiler / log, `nvidia-smi`, a load run | .4 only |
| A7 | DeckLink on kernel 7 | driver, devices, Caspar consumer/producer | nothing |
| A8 | can the dev box still BUILD Caspar after 26.04 | build the fork on .4, A/B against the release binary | .4 CPU |
| A10 | every project's screen-destination setup, server + real Caspar | `tools/e2e/project-matrix.js` on both boxes, both binaries on .4 | nothing (sandbox + headless Caspar) |
| A9 | cold boot on 26.04 | reboot .4 (owner gave full authority on .4) | .4 |
| B1 | each server alone (unlinked): API timing | `run-cluster-e2e --live` step 1 | unlink |
| B2 | link / invite accepted / link refusals | `--live` | link |
| B3 | master on each in turn, epoch fencing | `--live` | master role |
| B4 | signed calls (look take, allow-list) | `--live` | — |
| B5 | sender choice, Auto = master | `--live` (restored) | senders |
| B6 | unlink both sides | `--live` | link |
| B7 | refusals: accept_remote off, declined invite, stale epoch | by hand, live | — |
| B8 | real failover .4 → .23 and back (server stopped > 12 s) | `systemctl stop` on .4 | master role |
| B9 | follower restart / master restart (< 12 s, no failover) | server restarts | — |
| B10 | split network (both claim), heal → epoch fencing | iptables on .4 with a timed undo | link |
| B11 | media send between boxes | cluster media | — |
| B12 | WO-746 shared show between the real boxes | backups first, then on → edits → off | projects (backed up) |

## Investigation

### A1 — versions (25.10 10:02, `boxprobe.sh`)

| | .23 (dev box) | .4 |
|---|---|---|
| OS / kernel | Ubuntu 24.04.4, 6.8.0-117 | Ubuntu 26.04.1, 7.0.0-38 (6.8.0-117 kept on hold as a fallback) |
| GPU / driver | RTX PRO 4000 Blackwell, 595.71.05 open (gcc 13) | RTX 2080 SUPER, 615.71.09 server-open (gcc 15) |
| DeckLink | desktopvideo 16.2a1, `blackmagic_io`, io0–3 | 16.4a1, `blackmagic_io`, io0–3 |
| Node / ffmpeg CLI | 24.18.0 / 6.1.1 | 24.22.1 / 8.0.1 |
| Caspar binary | `b2bb40f5` (WO-742 shm build, 25.10 00:11) | `d5dee499` (17.10 build) |
| Godot | 4.7.2 | 4.7.2 |
| Xorg / WM | 21.1.11, openbox | 21.1.22 (vendor 12101022), openbox |
| NTP | synchronized | synchronized (WO-724's "NTP off, 17 s apart" is gone) |
| Services | highascg, scanner, companion, exfat-boot, bridge-boot active | same, all active |

Logs, last hour / this boot: the same boost::asio `remote_endpoint` exceptions on both (an AMCP client leaving
mid-reply, WO-737); .4's kernel log has only the 2080's USB-C UCSI i2c timeouts; Xorg on .4 adds
`NVIDIA: Failed to request fliplock` (GeForce, no framelock). Nothing playout-related on either.

### A2 — Caspar on 26.04 runs on libraries 26.04 no longer ships

The running Caspar on .4 (PID 39155) maps `libavcodec.so.60` / `libavformat.so.60` (ffmpeg 6.1), boost 1.83,
SFML 2.6, ICU 74, all from the 24.04 build it was linked against. 26.04 ships ffmpeg 8 (`libavcodec62`), boost 1.90,
SFML 3.0, ICU 78. `apt list --installed` marks **26 of Caspar's dependency packages `[installed,local]`** (no 26.04
source): `libavcodec60 libavdevice60 libavfilter9 libavformat60 libavutil58 libpostproc57 libswresample4 libswscale7
libsfml-graphics2.6 libsfml-system2.6 libsfml-window2.6 libicu74 libxml2 libx264-164 libx265-199 libvpx9 …`. They
survived `do-release-upgrade` (24.10 18:48) and the `apt autoremove` after it.

Will they stay? Checked on .4:
- `apt-get -s autoremove` → removes nothing; none of them is marked auto (`apt-mark showauto` ∩ = 0).
- `apt-get -s full-upgrade` → 0 to remove.
- So an upgraded box keeps a working Caspar. **A fresh 26.04 install would not have them**, and a later 26.04
  package that conflicts with one (e.g. a libxml2 transition) could still take one away. The Caspar binary needs a
  26.04 build for that (see A8).

### A3 / A4 — the test suites on 26.04 (HEAD ba02b109, a clean `git archive` on each box)

- Godot client: **21639 passed / 0 failed on both** (`run_tests.gd` on the same export; the 21656 in earlier WOs counts
  the working tree). `run-client.sh --check` boot OK on .4.
- Offline suite on .4 (`npm ci` OK, node 24.22.1): **3239 tests, 3229 pass, 3 fail, 7 skipped**.
  - `smoke-wo498` — export-only (no `.git`), as on every clean export.
  - `smoke-wo573` ×2 (`'DP-3' !== 'DP-6'`) — **not an OS regression, a test that read the host's GPU.**
    `os-layout-calculator-place.js:216` → `resolveSysIdToXrandrOutput` checks each port name against live xrandr
    (`hardware-info-xrandr.js:273`, `DISPLAY=:0` forced). .23's Blackwell has a DP-6; .4's RTX 2080 has none, so the
    resolver moved the head to a port .4 does have (DP-3) — the intended rename-survival behaviour.
- Found on both: **every suite run left 28 temp dirs** (`/tmp/wo702-*`, `wo704-*`, `wo708-*`, `wo709-*`):
  1497 on .23 (64 MB), 56 on .4 (two runs; `/tmp` is RAM there).

### A5 — sweep on .23 (`run-sweep.js --peers`, 10:10): 25 pass / 4 warn / 1 fail

- The FAIL — "kiosk 6 error lines since it started" (JSON parse, PNG decode, `get_node()` outside the tree) — were
  **my own headless Godot test run**, not the kiosk. The backtraces are `res://tests/*`.
  - Godot's test runner and `run-client.sh --check` use the same user dir as the kiosk
    (`~/.local/share/godot/app_userdata/HighAsCG Operator`, same project name).
  - At start Godot copies `godot.log` to a dated file, then truncates and rewrites it. The running kiosk (PID 3132075)
    still holds fd 3 on that same `godot.log` inode. So its live log was truncated under it, and the sweep then read
    the tests' errors as the kiosk's.
  - `--check` boots the real app, which saves `ui.cfg`: on .4, my 10:05 boot check rewrote the kiosk's `ui.cfg`
    (mtime 10:05:38). Its content still reads right (servers .4 + .23, origin home).
  - The sweep's own client check was already isolated (`XDG_DATA_HOME`, `checks-app.js:213`); the documented manual
    commands were not.
- WARNs, all known: no DeckLink .deb on the sticks; build stamps differ (dev box vs release); the two sudo helpers.
- Cluster: the signed call to .4 took 18 ms; media copy to and from .4 passed 5/5; .4's clock is +74 ms.

### A5 — sweep on .4 (`run-sweep.js --peers`, 10:13): 27 pass / 2 warn / 1 fail

- Every system/app/sandbox check passes on 26.04: services, GPU driver answers (615.71.09), ports, sudoers, Caspar
  autostart, **DeckLink driver + cards 8 ok**, 16 live routes in 146 ms, Caspar 2.5.1 with 1 channel aligned, no
  errors in the server, Caspar or kiosk logs, kiosk connected, client compiles, 94 sandbox routes, 56 projects load.
- WARNs: the June sync-conflict copies (owner); build stamps differ.
- **FAIL: media copy .4 → .23, `Permission denied (publickey,password)`.** The other direction passes 5/5.
  - .4 has **no replication key at all** (`~/.ssh` held only `authorized_keys`, `known_hosts`, `agent/`).
  - By design (WO-670 P2b, `cluster-media.js`) the key is made (`ensureReplicationSshKey`) and handed to the receiver
    on the first **Send media**. Until then the box cannot send, but nothing is broken. So the check's FAIL, worded
    as a forced-command problem, was misleading.

### B11 — Send media .4 → .23, live (10:14)

- `POST 192.168.0.4:4200/api/cluster/peers/highascg7580/send-media` → 202 `{paths: 1, slug: testy_2}`.
  - .4 made its key.
  - .23's `authorized_keys` gained one line: `from="192.168.0.4",command="/usr/local/bin/highascg-replication-ssh",
    no-port-forwarding,…`. That is a rsync-only key, accepted only from .4. The file was backed up first
    (`c753/authorized_keys.23.before` in the session scratchpad).
  - The send finished: `{state: done, percent: 100, files: 1}`. The file was already identical on .23, so rsync
    copied nothing.
- The media copy check from .4 then passes 5/5, so media now moves both ways.

### A8 — Caspar still builds on 26.04, and the native build plays the same (25.10 10:15–10:25, `~/wo753-caspar` on .4)

- Our fork (`~/caspar-build/src-v2`, branch `wo742-shm-producer`) on 26.04's toolchain: gcc 15, cmake 4.2.3,
  ffmpeg 8 (`libavcodec62`), Boost 1.90, SFML 3, ICU 78.
- **One change needed:** `CMakeModules/Bootstrap_Linux.cmake:33` asked Boost for the `system` component. Boost 1.90 no
  longer ships `boost_system` as a library (it has been header-only since 1.69), so configure failed. With `system`
  dropped from `COMPONENTS`, configure and build pass with no other change. Caspar's CMake already handles SFML 3.
  - Fork commit `24db35cca` (local, not pushed). The same patch builds on 24.04 / Boost 1.83 (this box,
    146/146 targets, `build_rc=0`), so one tree builds on both.
- The new binary links only 26.04 libraries (`ldd`: avcodec 62, boost 1.90, SFML 3; nothing missing besides
  `libcef.so`, which comes from `lib/` as with the release binary).
- A/B on .4, the 26.04 build vs the release binary (24.04 build on the orphaned libraries). Each ran headless with a
  shm consumer and its own ports, playing HAP + H.264 + PNG on one 1080p50 channel:
  - CPU (utime+stime from `/proc`) over 10 s: 55.1 vs 56.4 CPU-seconds; RSS 2.87 vs 3.03 GB; `<dropped>0` on both.
  - PRINT of the same three moments: identical average luma (YAVG 110.629 / 44.655 / 169.052 on both).
  - HTML (CEF), shm and the DeckLink 8K Pro (desktopvideo 16.4a1 on kernel 7) worked from the new binary.
- **ffmpeg 8 difference:** on each video open, ffmpeg 8 logs "Changing video frame properties on the fly is not
  supported by all filters" (the colour space reads "unknown" until the first frame). It is cosmetic: the frames
  match. Caspar's log is noisier on a native 26.04 build.
- Both test Caspars were stopped by exact PID; the live Caspar (PID 39155) was untouched.

### A10 — every screen-destination setup through the server and the real Caspar (owner, mid-campaign: *"Weave into tests different projects with different screen destinations setups etc"*)

- Survey: 56 projects on each box carry **29 distinct destination setups**: operator GUI only; pgm_prv from 1280x768
  to 16384x2160; pgm_only 1080p / 2160p; multiview 1080p / 2160p; up to 8 channels with DeckLink inputs, audio and
  streams. The setups are the same on both boxes except `godot_test` (.23 has an extra 1080p pgm_prv).
- First server-side pass: 24 pass / 6 "channel N used twice". **All six were the check's mistake, not the server's.**
  A stream attaches to an existing channel by design: the `program_N` / `channel_N` picked, or `casparChannel`
  (`routing-map.js` `resolveStreamOutputCasparChannel`, WO-378). `llkk` streams the DeckLink input channel (channel_4).
  The stream now only has to exist in the config.
  - Found on the way: the sandbox keeps the previous project's streaming setting when a project has none (`tra`
    stores no `streamingChannel` and inherited one). A project load does not reset it. Owner question, not a fault.
- First Caspar pass: 0 / 30, all from the harness reading AMCP's `200 INFO OK` status line as a channel ("200:INFO").
  The channel lists themselves matched in all 30.

## What was done

- `tools/smoke/smoke-wo573-…-separate-binding.test.js`: stubs `getDisplaysXrandrDetailed` / `getGpuConnectorInventory`
  with a fixed GPU (DP-0, DP-5, DP-6) before the planner loads them. The assertions are unchanged; the test now
  checks the planner, not the machine it runs on.
- `smoke-wo702`, `smoke-wo704`, `smoke-wo708`, `smoke-wo709`: remove their temp dirs in an `after` hook. The leaked
  dirs were deleted on both boxes.
- `godot/client/run-client.sh`: `--test` and `--check` run with a throwaway `XDG_DATA_HOME` (removed on exit);
  `--test` no longer `exec`s, so the trap runs, and it still exits with Godot's code. Use `run-client.sh --test`, not
  a bare `godot --script res://tests/run_tests.gd`, on a kiosk box. CI calls Godot directly on a runner with no
  kiosk, so it is unaffected.
- `tools/smoke/smoke-wo753-client-test-modes-isolated.test.js` (new, in FILES): a stand-in Godot records its
  `XDG_DATA_HOME`. Both modes get a fresh dir that exists while Godot runs and is gone afterwards; `--test` passes on
  the exit code.
- `tools/sweep/checks-cluster.js` `cluster.media-copy`: on a box with no media key yet (`resolveReplicationSshIdentityPath()`
  empty) it is a WARN naming the button ("the first Send media (Devices → Servers) makes it and hands it over"), with
  no ssh attempt. `smoke-wo730-sweep` gained that case.

- `tools/e2e/project-matrix.js` (new): one project per distinct setup (`--all` for every project). For each:
  - load it with its hardware on a throwaway sandbox server (`POST /api/project/load {applyHardware:true}`);
  - check the channel map against the destinations: one PGM per pgm_prv / pgm_only, one PRV per pgm_prv, one channel
    per multiview, no channel used twice (the stream excepted, see A10), nothing past the end;
  - check the generated casparcg.config: every custom mode defined, every PGM at its destination's size;
  - with `--caspar=<binary>`, run that Caspar headless on the generated config. Screen, DeckLink and NDI consumers are
    dropped, shm is renamed, OSC clients are removed and it gets its own ports. Its AMCP `INFO` must list the same
    channels and modes, and its log must have no `[error]`. It is stopped by its own PID; temp dir and shm are removed.
- `tools/smoke/smoke-wo753-project-matrix.test.js` (new, in FILES): the rules on hand-made maps (a stream sharing the
  PGM passes; missing, duplicate and past-the-end channels, an undefined mode and a wrong PGM size are each caught),
  the headless rewrite, and a real sandbox run on three synthetic setups (5760x1728 pgm_prv; 1080p + 2160p pgm_only
  + multiview; GUI only), with no Caspar needed in CI.

## What was VERIFIED

- wo573 on .4: 1 pass / 2 fail before, 3 / 0 after; 3 / 0 on .23.
- wo702/704/708/709: 48 / 48, `/tmp/wo70*` count unchanged by a run (it grew by 28 per run before).
- Lint 214 warnings (cap 216); no file over 500 lines.
- run-client: the smoke passes 3 / 3; against the old script 1 / 3 (both "own user://" cases fail). Live on this box:
  the kiosk's `godot.log` md5 was the same before and after `run-client.sh --check` (boot OK) and `--test`
  (21656 / 0); no `highascg-client-*` dir was left.
- media-copy check: with `HIGHASCG_REPL_SSH_KEY=/nonexistent/key` → WARN with the new text; with the real key → PASS
  5/5 (.23 → .4). wo730 + wo749 smokes 12 / 12.
- Project matrix on .23, the release Caspar (`bin/casparcg`, beside the live one): **30 / 30 setups pass**. Each ran
  the generated config, from 1 channel (GUI only) to 8, up to 16384x2160 PGM+PRV. Caspar's channels and modes equal
  the config's; no `[error]` lines; no `wo753-caspar-*` dir or `wo753m-*` shm left.
- Matrix smoke 5 / 5 on .23 and on .4 (26.04). Gates: test:ci 3244 pass / 1 fail (WO-498, export-only), format,
  unwired exports, boot OK; lint 214 warnings.
