# WO-974 — LTC timecode in (reader + timeline chase) and out (generator)

**Area:** audio, engine, godot-client
**Status: IN PROGRESS** (code + offline tests + FIFO loopback/chase proven on the live node; needs `sudo apt install libltc11` on the box and a real-audio-device test)

Owner show note 06.11.2026: *"LTC timecode in and out support."*

## Investigation

- **Nothing existed.** `rg -i "timecode|ltc|mtc" work/work-orders/INDEX.md` only finds WO-542 (flag jump-time display
  format). The repo had no timecode math and no audio-timecode code. The timeline engine (`src/engine/timeline-engine*`)
  already has everything a chaser needs: `play(id, fromMs)`, `seek`, `pause`, `getPlayback(id)` and a `'playback'`
  event. It also has `_airTimelineId` for "the timeline on air".
- **Engine is empty after a node restart (WO-949).** A configured chase target is not in the engine until a client
  pushes it. The first live run failed with "Timeline not found" after another agent's node restart. The service now
  hydrates the target from the stored project (`project-scenes-load.loadFullProject()`).
- **Audio inputs.** The DM3 is single-open (memory shader-audio-fft-routing), so LTC cannot open it a second time. The
  live-audio bridge ffmpeg (`src/audio/live-audio-bridge.js`) already tees the capture to UDP for the FFT. An LTC tee
  belongs next to that.
- **Codec choice.**
  - `apt-cache policy libltc11`: candidate 1.3.2-1build2 (resolute/universe), **not installed**.
  - The official `.deb`s were downloaded to the scratchpad and extracted, never installed. sha256 values:
    - libltc11: `10af29f3…4660`
    - libltc-dev: `78cf2896…cc7e`
  - npm candidates and why each was rejected:
    - `libltc-wrapper` 1.1.2 (bitfocus): node-gyp native build against libltc-dev, so it needs the same system package plus a toolchain.
    - `timecode-tools` 0.1.0: reader only (no generator), prebuilt Rust binary, 4 weeks old.
    - `linear-timecode` 0.1.0: pure JS, but its README states 29.97 is unsupported in both the encoder and decoder.
    - `smpte-timecode`: math only.
    - `node-ltc` and `ltc-reader`: 404.
  - **Decision:** libltc (the reference implementation, also used by Ardour/xjadeo) via Python `ctypes`. No build step, and
    the only new system dependency is the runtime library. Per the brief this is an ask for the owner (`sudo apt install libltc11`).
- **ctypes ABI (libltc 1.3.2, x86_64).** `LTCFrameExt` is 368 bytes: `ltc` is `uint32[3]`, `off_start` is at 16 and
  `volume` is at 360. The DF flag is bit 10 of word 0. libltc sets it automatically at 29.97.
- **06.11 incident (caused by this WO, fixed here).** The first FIFO sink did `fs.createWriteStream(fifo)` inside node.
  Opening a FIFO with no reader blocks a libuv threadpool thread in `open(2)`. On TERM, node could not exit until
  systemd's SIGKILL, about **4 min later (22:48:29)**. A repro of the old pattern under `timeout` exits 124 (hangs).
  Rule now: **node never open()s a FIFO**. A child process (`cat`/`dd`) does, and teardown SIGKILLs it.

## What was done

Design: three layers. (1) Pure math. (2) A small Python helper that only does PCM ↔ frames through libltc. (3) A node
service that owns the processes, the lock state machine and the chase, and has no codec code of its own.

- `tools/ltc/ltc_helper.py` (new). libltc via ctypes.
  - `decode`: s16le stdin → JSON lines `{tc,h,m,s,f,df,start,end,rev,vol}`.
  - `encode`: stdin commands `locate HH:MM:SS:FF | run | stop | quit` → continuous s16le stdout. A stopped encoder
    outputs silence, so the sink never starves. Progress reports `{out,running,frames}` go to stderr.
  - `probe`: exits 3 if libltc is missing.
  - Library lookup order: `$HIGHASCG_LIBLTC`, then `libltc.so.11`, then `find_library`.
  - Pacing: back-pressure for pipes (stdout pipe shrunk to 4 KiB), or `--realtime` for FIFO/file sinks, which cannot
    pace on their own.
- `src/timecode/timecode-math.js` (new). Modes: 24, 25, 29.97 DF, 30.
  - Drop-frame conversion: 1798 frames per minute and 17982 per ten minutes, so 1 h = 107892 frames and a day =
    2589408 frames.
  - Also provides tc↔frames↔ms, parse/format and wrap-aware `frameDelta`.
- `src/timecode/ltc-helper.js` (new). Spawns the helper, caches the probe (`APT_HINT = 'sudo apt install libltc11'`)
  and handles the `libPath` override.
- `src/timecode/ltc-lock.js` (new).
  - `LtcLock` states: none → acquiring → locked (`lockFrames` consecutive frames) → freewheel (no frames for more than
    `dropoutMs`, extrapolated) → lost (beyond `freewheelMs`), plus still (repeated TC = parked deck). It also counts jumps.
  - `decideChase()` (line 110) is pure and returns play / seek / pause / none, with 400 ms action spacing and an
    `engaged` flag, so a timeline the operator starts by hand is not paused by a silent input.
- `src/timecode/ltc-input.js` (new). Three sources:
  - `alsa`: an `arecord` child.
  - `bridge`: a UDP socket on 52240+slot, fed by the live-audio bridge tee.
  - `fifo`: a `cat` child (line 89).
  - A child that fails restarts after 2 s. Stop uses SIGKILL.
- `src/timecode/ltc-output.js` (new). Sinks:
  - `alsa`: `aplay` with a 60 ms buffer.
  - `fifo`: a `dd` child (line 124).
  - Source `timeline` follows the air playhead and `clock` follows time of day, each plus `offset` and `leadMs`.
  - Re-locate hysteresis (lines 18–19): 2+ frames off on two reports in a row, or 5+ frames off once (a seek).
    Without it, early jitter caused small discontinuities. It also re-syncs on the engine's `'playback'` event.
- `src/timecode/ltc-config.js` (new). `normalizeLtcConfig(raw, prev)`. **All off** by default. An invalid offset keeps
  the previous value. `inputProblem`/`outputProblem` produce the "why not running" text.
- `src/timecode/ltc-service.js` (new). Built from `config.ltc`:
  - Probes libltc, starts the input with a 40 ms chase tick and the output.
  - Broadcasts `ltc.status` at 5 Hz.
  - Chase target: `chase.timelineId`, or else the air timeline. It is hydrated from the stored project when the engine
    lacks it.
  - `onShutdown = stop`.
- `src/timecode/routes-ltc.js` (new). `GET /api/ltc` returns status and config. `POST /api/ltc/config` deep-merges,
  normalizes, saves through the config manager and restarts the service.
- Wiring:
  - `index.js:424`: create and start the service.
  - `src/bootstrap/shutdown.js:30`: `onShutdown()`.
  - `src/api/router.js:487`: register the routes.
  - `src/config/defaults-core.js:99`: the `ltc` defaults. This is the single reset root.
  - Settings: `src/api/settings-get.js:55` and `src/api/settings-post.js` add `ltc` to the hand-listed `newConfig` and
    restart the service at line 423 (memory settings-post-newconfig-hand-listed).
  - `src/audio/live-audio-bridge.js:192-197`: when `ltc.input.source = 'bridge'` and the slot matches, add
    `-map 0:a -af pan=mono|c0=cN,aresample=48000 -f s16le udp://127.0.0.1:5224x`.
- Godot:
  - `features/settings/ltc_model.gd` (status line) and `ltc_pane.gd`: Settings → **Timecode** has fps, in on/off,
    source, device/slot/channel, chase on/off, timeline id, offset, out on/off, out source, device, level and offset,
    plus a live status line (polls `/api/ltc` at 4 Hz while visible).
  - `settings_tab.gd` adds the pane.
- Tests (all in the curated list, `tools/ci/offline-test-files-2.js`):
  - `smoke-wo974-timecode-math.test.js`: DF math, including the 1/10-minute boundaries, day wrap and parsing.
  - `smoke-wo974-ltc-lock-chase.test.js`:
    - lock state machine and chase decisions
    - config normalization and settings POST/GET persistence
    - bridge tee args
    - **FIFO sinks/sources with no partner: a child node process starting both must exit by itself in under 5 s**
      (the incident guard).
  - `smoke-wo974-ltc-roundtrip.test.js`: needs libltc. Covers encode→decode round trips at 24/25/29.97DF/30 across a
    minute boundary, and generator→FIFO→reader following a seek.
  - `godot/client/tests/test_ltc_pane.gd`: the status-line model. The pane uses autoloads, so it is covered by
    `run-client.sh --check`.
- Regenerated `docs/wiki/api/contract/{http,ws}.md` (+2 routes, +1 WS type) for the WO-598 contract smoke.

## What was VERIFIED

**Offline:**
- Curated suite: **5392 tests, 5387 pass, 0 fail, 5 skipped**. The only failure on the first run was the stale API
  contract docs; after regenerating, that smoke passes 3/3.
- WO-974 tests:
  - With `HIGHASCG_LIBLTC` pointing at the extracted official library: **32/32**.
  - Without libltc: 27/27, and the round-trip tests are not registered.
- Godot `run-client.sh --test`: **26046 passed, 0 failed**.
- Other gates:
  - `check-max-file-lines`: 0 files over 500 lines.
  - eslint on the touched files: clean.
  - `format:check`: clean.
  - `check-unwired-exports`: no WO-974 entries (the remaining 2 are WO-973's `clip-speed.js`).

**On the box** (live node on :4200, `libPath` pointed at the extracted .deb library, LTC config posted over the API).
Logs are in `/tmp/claude-1000/-home-casparcg/2c8389df-06bf-48f2-a6e2-f30036bbf7b0/scratchpad/wo974/`:
- **Missing library.** Status reports `libltc not found … sudo apt install libltc11`, and nothing starts.
- **Clock out → FIFO → in loopback.** Decoded LTC locked at −18.6 dB and tracked the generated time of day.
- **Chase (run 4, `poll.log`):**
  - **Lock and play.** An external generator started at 00:00:05:00. The input locked and the test timeline (empty,
    routed nowhere) started playing at ~5.5 s (`play ltc_running`).
  - **Jump.** A locate to 00:00:20:00 gave `seek ltc_jump`, and the timeline was at 20396 ms.
  - **Dropout.** After the signal stopped, the input showed `freewheel` for ~2 s while the timeline kept rolling, then
    `lost`, then `pause ltc_lost`.
- **LTC out from the chased playhead.** With offset 10:00:00:00, a separate decoder (`decA.log`) read 324 frames, from
  10:00:05:07 to 10:00:27:07, at −18.6 dB. The only discontinuity was 10:00:11:04 → 10:00:20:07, which is the real seek.
- **FIFO shutdown guard.** The old pattern hangs (timeout exit 124). The new cat/dd pattern exits promptly, and that
  case is now an offline test.
- **Restored afterwards.** The live `ltc` section is back at factory defaults (all off, sink `alsa`, no FIFO paths, no
  `libPath`), checked via `GET /api/ltc`. The test timeline was stopped and the scratchpad FIFOs removed.

**NOT proven:**
- Real audio hardware in either direction: `arecord`/`aplay` devices, and the DM3 bridge-tee input on the box.
- A live drop-frame chase. 29.97 DF is covered offline only.
- The Godot pane on glass. No screenshot: the test-agent driver would start an extra Godot/Xvfb, which the batch
  contract forbids. The pane compiles (`--check`) and the model is tested.

## OPEN

1. Owner: `sudo apt install libltc11`. Then clear `ltc.libPath` (or leave it empty) and re-run
   `smoke-wo974-ltc-roundtrip`. eggs clones the host package set, so the ISO picks it up on the next produce. The
   install gates should check the payload file `/usr/lib/x86_64-linux-gnu/libltc.so.11`, not dpkg (WO-431).
2. Hardware test:
   - LTC in through the bridge tee on the DM3 slot (any channel carrying LTC).
   - LTC out to an ALSA device Caspar does not hold. Not DM3 or HDMI on-air routing.
3. Live 29.97 DF chase against an external deck or generator.
4. Optional: a web-client UI. Godot is the only UI today.
