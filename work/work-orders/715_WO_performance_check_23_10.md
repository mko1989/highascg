# WO-715 — Performance check 23.10: OSC handled twice, vsync spin on the ISO screen consumer

**Status: IN PROGRESS (23.10.26) — OSC fix DONE (smoke 2/2, fails on HEAD; box: 1900 → 951 handled/s = the 950 msg/s
on the wire); vsync finding measured, change awaits the owner (D1); other checks clean**

Owner, 23.10: *"run performance tests and checks to see whether the system runs optimally."* Compared against
WO-401 (round 1, show config, 30.07) and WO-405 §4 (idle floor, 04.08). The method follows those WOs: `/proc`
CPU over 20–60 s windows, `nvidia-smi`, `/api/host-stats`, `/api/osc/diagnostics`, a WS client, and
`tools/dev/measure-playback-rate.js`.

## Investigation

### What is running (it is not the config on disk)

- The running Caspar (pid 10057, started 15:50) has **1 channel, 720p50, one screen consumer**
  (`log/caspar_2026-10-23.log:9996`). That is `config/casparcg.config.iso`, written by the eggs produce
  (`tools/eggs/live-usb/reset-iso-operator-config.sh:34-42`).
- `config/casparcg.config` on disk has **5 channels** (2 × 3072×1024, 3 × 1080p50). It was rewritten at 16:00:36
  (ctime) with its mtime kept from 22.10 21:53, by the post-produce exFAT remount + sync
  (`build-highascg-egg.sh:189-193`). Caspar was not restarted after that. The next Caspar restart boots the
  5-channel config.
- This is the intended produce flow (memory: config reset after a produce is intended). It is recorded only so the
  numbers below are read against the right config.

### Host

| check | value | verdict |
|---|---|---|
| CPU | i7-14700KF, 28 threads, governor `performance`, EPP `performance`, turbo on | OK |
| load / busy | load1 ≈ 1, host busy 3.6 % over 60 s (before the vsync swap) | OK |
| memory | 6.1 / 62 GiB used, swap 0 B used (zram 8 G + /swap.img 8 G), swappiness 60, THP madvise | OK |
| temperatures | CPU package 50 °C, NVMe 53 / 42 °C, GPU 48 °C | OK |
| GPU | RTX PRO 4000 Blackwell; **driver 595.71.05, kernel module = userspace** (the mismatch is gone); persistence on; P5 idle, PCIe gen1 ×16 at idle (power saving, max gen5); no throttle reasons | OK |
| disk `/` | 938 G, **791 G used (89 %)**, 99 G free | watch: produce ISOs + media |
| journal | `task sync blocked > 122 s` at 16:05: the produce syncing to the exFAT stick (`sda3: Volume was not properly unmounted` at 16:00:35); one-off | OK |
| journal noise | `live-config-getty-generator failed with exit status 2` on every `systemctl daemon-reload` (a live-ISO generator on an installed system, not from dpkg) | cosmetic |
| Companion | `/etc/systemd/system/companion.service.d/override.conf` is a bare `--extra-module-path …` line with no `[Service]` section. systemd ignores it ("Assignment outside of section"), and Companion runs without `--extra-module-path` | owner (root file) |

### Processes (60 s window, box idle)

| process | CPU | RSS |
|---|---|---|
| casparcg | **92.6 %** (one thread 77.6 %) | 483 MB |
| Godot operator client | 5.5 % | 957 MB |
| node (highascg) | 1.2 % | 291 MB |
| Xorg | 0.6 % | 70 MB |

The WO-405 floor was casparcg 8 % and node 1 %. Node and the GPU match the floor; Caspar is 10× over.

### Finding 1 — the vsync-on screen consumer spins a core (78 %)

- Caspar's hottest thread (tid 10461, unnamed). It made about 100 voluntary context switches per second: 2 per
  frame at 50 fps, burning CPU in between.
- I could not take a stack: `perf_event_paranoid` = 4 and `ptrace_scope` = 1, and both need sudo. So I proved it
  by A/B over AMCP with no restart (20 s windows):

  | state | casparcg | hottest thread |
  |---|---|---|
  | screen consumer from the ISO config, `<vsync>true</vsync>` | **82.7 %** | 79.4 % |
  | `REMOVE 1-600` (no screen consumer) | 0.7 % | 0.3 % |
  | `ADD 1-600 SCREEN 1 BORDERLESS NON_INTERACTIVE X 0 Y 0 WIDTH 1280 HEIGHT 720` (AMCP ADD = vsync off, struct default `screen_consumer.cpp:103`) | **5.2 %** | 1.9 % |

- Why: the screen consumer's own thread calls SFML `window_.display()` (`screen_consumer.cpp:908/983`) with
  `setVerticalSyncEnabled(true)` (`:544`). That is `glXSwapBuffers`, which the NVIDIA driver spin-waits in unless
  `__GL_YIELD` is set. Caspar's environment has no `__GL_*` variable.
- The ISO template still carries `vsync true` (`config/casparcg.config.iso:22`). WO-447 flipped the generator's
  defaults to off but left this template, the operator-GUI consumer (`config-generator-operator-gui.js:88`) and
  `multiview_vsync: true` alone, as part of the owner's verified-perfect state.
- Open question: WO-405's August floor (8 %) included a vsync-on operator-GUI consumer. Either that consumer did not
  spin then, or the spin is new with driver 595 or the 2.5.1 build. If it is new, every vsync-on consumer in a show
  config now costs about a core.

### Finding 2 — node handles every OSC message twice

- `/api/osc/diagnostics` counted **1900 msg/s**. A sniff of Caspar's copy on UDP :6250 for 5 s shows
  **50 packets/s, 950 messages/s**: one 1156-byte bundle per frame (`port/600` 300/s, layers 110/100/50, format,
  framerate, volume).
- Cause: `src/osc/osc-listener.js` listened to both `message` and `bundle`. osc.js `fireBundleEvents`
  (`node_modules/osc/src/osc-transports.js:32-37`) emits `bundle` and then `message` for every packet inside it.
  Caspar sends everything in bundles, so **all** of its OSC went through `OscState.handleOscMessage` twice. With
  the HEAD listener, 2 bundled messages → 4 calls (`/a /b /a /b`).
- This was missed in PERF-J1 and in WO-401: the "18,656 msg/s" there is this double count, about 9.3k real.

### Node and the API (after the vsync swap, before the OSC fix)

| metric | WO-401 (show config) | now (1 ch idle) |
|---|---|---|
| `GET /api/state` | 43–49 ms | **15–19 ms** (112 KB) |
| small GET p50 / p95 / max | — | 0.4 / 0.6 / 3.6 ms (no event-loop stalls) |
| WS per client | 335 KB/s | **43 KB/s** (osc 38, state 5.4) |
| OSC in | 18,656 "msg/s" (double count) | 950 msg/s real |

### Playback (`measure-playback-rate.js`, ch 1 layer 20, 20 s)

| clip | rate | casparcg CPU | GPU |
|---|---|---|---|
| `PROJECTS/AIRPORT/1. GŁÓWNE TŁO` (ProRes 3840×1344 p50) | **99.8 %** (spread 0.979–1.035, 0 regressions) | 245 % | 10 % |
| `TESTOWE/PIEKLOKOBIET… HD 25fps HAP` | **100 %** (spread 0.98–1.04, 0 regressions) | 83 % | 29 % |

Both are realtime. ProRes at this size is a software decode, so 2.5 cores is expected.

## What was done

- `src/osc/osc-listener.js`: removed the `bundle` handler. The `message` events already cover every bundled
  message, nested bundles included. A comment cites the osc.js lines.
  - Why remove `bundle` rather than `message`: osc.js emits `message` for bare packets and for every bundle member
    at any depth, so a `bundle`-only listener would need its own recursion and still miss bare packets.
  - `OscState` sees the same values in the same order, once.
- New `tools/smoke/smoke-wo715-osc-bundle-once.test.js` (in the curated list). It sends real UDP on a free loopback
  port: a bundle with a nested bundle, plus a bare message → exactly 4 `handleOscMessage` calls, `received` = 4.
  It also pins that there is no `on('bundle'` in the source.
- Live: the screen consumer of the running channel 1 was swapped for a vsync-off one over AMCP (A/B above). It stays
  until the next Caspar restart. I did not change the ISO template or the generator (D1).
- Not changed: the Companion override (root file, owner); the getty generator noise (live-ISO leftover).

## What was VERIFIED

- Smoke: 2 / 2. The same check against `git show HEAD:src/osc/osc-listener.js` → 4 calls for 2 messages (the
  bug). All `*osc*` smokes: 43 / 43.
- Box: node restarted (pid 238251) → `/api/osc/diagnostics` counts **951 / s** (was 1900), matching the sniffed
  950 msg/s on the wire. At idle, node CPU is unchanged at 1.3 % (950 msg/s is cheap). The saving is half of the
  OSC handling under a show config.
- Caspar after the vsync swap: 5.2 % CPU over 20 s; `/api/host-stats` reports caspar `cpuPct: 5`.

## Decisions for the owner

- **D1 — vsync on screen consumers.** On this box (driver 595, build v2), a vsync-on screen consumer costs about 78 %
  of a core; vsync off costs about 2 %. Should the ISO template (`config/casparcg.config.iso:22`) go to `false`,
  as WO-447 did for the PGM screens? And should the operator-GUI consumer / `multiview_vsync` follow? The A/B only
  measured CPU: look at the screen for tearing first. The alternative that keeps vsync is
  `__GL_YIELD=USLEEP` in Caspar's environment (it makes the driver sleep instead of spin). That has not been tested
  yet; it needs a Caspar restart.
