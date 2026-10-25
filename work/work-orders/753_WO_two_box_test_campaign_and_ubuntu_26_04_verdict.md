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
| A8 | can the dev box still BUILD Caspar after 26.04 | configure the Caspar tree on .4 | nothing |
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

## What was done

- `tools/smoke/smoke-wo573-…-separate-binding.test.js`: stubs `getDisplaysXrandrDetailed` / `getGpuConnectorInventory`
  with a fixed GPU (DP-0, DP-5, DP-6) before the planner loads them. The assertions are unchanged; the test now
  checks the planner, not the machine it runs on.
- `smoke-wo702`, `smoke-wo704`, `smoke-wo708`, `smoke-wo709`: remove their temp dirs in an `after` hook. The leaked
  dirs were deleted on both boxes.

## What was VERIFIED

- wo573 on .4: 1 pass / 2 fail before, 3 / 0 after; 3 / 0 on .23.
- wo702/704/708/709: 48 / 48, `/tmp/wo70*` count unchanged by a run (it grew by 28 per run before).
- Lint 214 warnings (cap 216); no file over 500 lines.
