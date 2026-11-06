# WO-974 — LTC timecode in (reader + timeline chase) and out (generator)

**Area:** audio, engine, godot-client
**Status: DONE (07.11.2026; LTC timeline campaign against the system libltc11 on the live box at 25/24/30/29.97 DF, FIFO audio path, on-glass screenshots; real sound-card audio NOT proven — needs `sudo modprobe snd-aloop` or a cable, see OPEN)**

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

### Timeline campaign 06–07.11 (system libltc11, owner: *"i also want you to run ltc tests. this is mostly for timeline i think."*)

Test rig (scratchpad `wo974/`: `campaign.js`, `analyze.js`, `tl.py`; raw runs and reports in `wo974/camp/`):
- A real timeline was added to the a&s project, "WO-974 LTC test" (`tmwo974ltcab`). It is 11 min long at 25 fps,
  sent to **PRV only** (ch3, Dioda 2560x640). Clips:
  - layer Film: the 4K H.264 Linc film, then `wss-partnerzy.mp4`, then Linc again;
  - layer Logo: `wss_logo_statyk.png` over the whole timeline.
- An external generator (`ltc_helper encode --realtime`) feeds FIFO B → node LTC in → chase. Node LTC out (playhead +
  offset) → FIFO A → a second decoder.
- `/api/ltc` was polled at 10 Hz. Caspar `INFO 3` (layer 210 file time) was sampled every 500 ms to measure what is
  really on PRV.

Findings, each fixed below:
1. **Caspar never answers `CALL x-y SEEK n` on an image producer.** This is a pre-existing engine bug that LTC chase
   exposed, because every chase locate is a timeline seek.
   - Probe: `PLAY 3-250 <png>` → 202 in 38 ms; `CALL 3-250 SEEK 100` → no reply in 4 s; `CLEAR` OK.
   - AMCP sends are serialized with a 15 s response timeout. So one scrub or seek with a still under the playhead
     stalled **every** Caspar command for 15 s, PGM included.
   - First pilot run: PRV content 6 s behind the timeline, then frozen.
2. **Stale frame after silence.** libltc hands over the last frame before a gap only when the signal returns
   (measured 1.04 s late). `LtcLock` counted it as the first frame of a run and re-locked instantly on a frame
   ~1 s old. Result: two wrong 1 s seeks per dropout, and one `play` to 76 s when the real TC was 300 s.
3. **Engine RESUME ignores `fromMs`.** `play(id, fromMs)` on a paused air timeline resumes from the parked position.
   So a chase resume after a hold landed −224 ms off and triggered an extra seek.
4. **Caspar content lags the engine clock after a transport change** (4K H.264 on ch3). Caspar file time − engine:

   | Transport | Lag |
   |---|---|
   | stopped → play | −519…−645 ms |
   | playing seek | −326…−645 ms |
   | pause + seek + immediate resume | −122…−202 ms |
   | pause + seek(+300) + wait 300 + resume | −84 ms |
   | pause + seek(+600) + wait 600 + resume | −50 ms |

   The engine clock is wall time, so this is landing latency in Caspar, not drift. Hence the chase **preroll**: park,
   seek ahead, resume when the LTC gets there.
   - 500 ms was not enough for a backward jump into another clip: −212 and −252 ms in two DF runs.
   - 800 ms landed the same jump at −90 ms.
5. **`latencyMs` caused a re-seek loop.** It was added after the threshold check, so every tick saw the timeline
   `latencyMs` ahead.
6. **Processing lag.** The chase tick's own work (8–11 ms) was not counted into the seek target.
7. **LTC out repeated one frame after an event-loop stall** (30 fps run, ~80 ms node stall). Encoder progress reports
   were judged against the playhead of *now*, not of when they were written. Two stale reports looked like a
   2-frame error and re-located a healthy encoder.
8. **The status read `libltc` as `null` after a config change** (start() returned before re-probing).
9. **Any settings save restarted LTC.** `settings-post.js` restarted the service whenever the body carried `ltc`.
   The web settings modal re-posts every section (`buildSettingsPayload` spreads `...prevAll`), so any web settings
   save would drop the chase lock and LTC out mid-show.
10. **The generator had no "parked deck" mode and no closing edge** (test tool). Without a closing transition the
    receiver could not finish the last frame before silence.
11. **Box audio (for the real-audio test).** No PipeWire or PulseAudio. Device status:
    - Free capture devices: `hw:0,0c` and `hw:0,2c` (PCH ALC1220).
    - PCH playback `hw:0,0` is held by Caspar and Godot.
    - NVIDIA HDMI 3/7/8/9 are closed but on-air (off limits).
    - The DM3 is not attached.

    So there is no free playback → capture path without a cable or the `snd-aloop` module, which needs sudo.
    `~/.asoundrc` and the Caspar config use `hw:2,0` (SC60), so the loopback card must not take index 2.

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

### Campaign fixes (06–07.11)

- **Still layers are never `CALL SEEK`ed** (finding 1).
  - `src/engine/timeline-playback-amcp-schedule.js:25-28,55`: `clipTransportMeta().isStill` is set for
    `source.kind === 'still'` or an image extension.
  - `src/engine/timeline-playback-amcp-send.js:179` (scrub seek), `:339` (loop seek) and `:247`: a still keeps its
    prevKey, so the next RESUME does not re-PLAY it (no flash).
  - Smoke: `tools/smoke/smoke-wo974-timeline-still-seek.test.js` (new, curated).
- **`src/timecode/ltc-lock.js`:**
  - `:44`: a frame that arrives after more than `dropoutMs` of silence restarts acquisition (finding 2).
  - `snapshot().pos`: the fractional, extrapolated LTC position.
  - `decideChase` targets `pos` and puts `latencyMs` inside the target (`:130`, finding 5). It returns `errorMs` (`:141`).
  - `chaseOps()` (`:161`) turns a decision into engine ops:
    - start from stopped: `seek(ms+pre)` → wait → `play`;
    - jump while playing: `pause` → `seek(ms+pre)` → wait → `play`;
    - without preroll: seek first, then play (finding 3).
- **`src/timecode/ltc-service.js`:**
  - `runOps()` (`:71`) executes the ops. It compensates processing lag (finding 6) and counts the preroll from the seek
    (`:75-95`).
  - While a preroll runs, the chase is busy and `errorMs` is null (`:109`).
  - Chase error statistics go to `status().chase.error` (`noteError`, `:30`).
  - `start()` re-probes libltc before the disabled early return (`:173`, finding 8).
- **`src/timecode/ltc-config.js:35`**: `chase.prerollMs`, default **800** (0–2000), with the measurements in the comment.
- **`src/timecode/ltc-output.js:34`**: `targetFramesAt()`. An encoder report is judged at its own `at` timestamp
  (finding 7). `tools/ltc/ltc_helper.py` reports now carry `at`.
- **`src/api/settings-post.js:163,424`**: LTC restarts only when the normalized `ltc` section really changed (finding 9).
- **`tools/ltc/ltc_helper.py`:**
  - `hold` command: repeats the current frame, i.e. a parked deck.
  - Closing edge: one half-bit transition before silence (`:193`). The last frame now decodes 0.48 s after stop
    instead of 1.48 s.
- **Smokes:** `tools/smoke/smoke-wo974-ltc-lock-chase.test.js` gained tests for:
  - the stale frame after a gap;
  - the fractional target and `errorMs`;
  - seek-first resume, preroll ops, and latency without a loop;
  - a stale encoder report;
  - an unchanged `ltc` re-post not restarting the service.

  Negative controls:
  - still guard removed → 4 of 5 still-seek tests fail;
  - settings guard removed → the restart test fails.

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

### Timeline LTC campaign, 06–07.11 (system `libltc.so.11`, no `libPath` / `HIGHASCG_LIBLTC`; status `"lib":"libltc.so.11"`)

Chase of the real 11-min test timeline on **PRV ch3 only** (PGM ch2 never touched). Reports are in
`/tmp/claude-1000/-home-casparcg/2c8389df-06bf-48f2-a6e2-f30036bbf7b0/scratchpad/wo974/camp/*.txt`. Times are measured
from the generator command; chase error = engine position − LTC position.

| | 25 (`run-25-short`) | 24, in-offset 01:00:00:00 (`run-24-offset`) | 30 (`run-30-short2`) | 29.97 DF (`run-2997df-df`) |
|---|---|---|---|---|
| lock → play | +239 ms | +278 ms | +229 ms | +215 ms |
| jump fwd: seek at / error after | +215 ms / −5 ms | +257 ms / −2 ms | +177 ms / −3 ms | +163 ms / −2 ms |
| jump back: seek at / error after | +215 ms / −7 ms | +215 ms / −5 ms | +187 ms / −4 ms | +183 ms / −6 ms |
| hold (LTC still) → pause, parked error | +255 ms, 0 ms | +259 ms, 0 ms | +221 ms, 0 ms | +204 ms, 0 ms |
| resume error | −2 ms | −3 ms | −4 ms | −5 ms |
| 1.0 s dropout (< freewheel 2 s) | freewheel, **no action** | same | same | same |
| loss → pause `ltc_lost` (expected 2400) | +2443 ms | +2478 ms | +2434 ms | +2424 ms |
| restart → play / error | +240 ms / −9 ms | +219 ms / −4 ms | +220 ms / −3 ms | +185 ms / −4 ms |

The analyzer's error is sampled 0.5–3 s after each action.

- **29.97 DF boundaries** (10 Hz polls). The timeline position matched the LTC within **−2…−6 ms** at:
  - 00:00:59;29 → 00:01:00;04 (frames ;00/;01 dropped);
  - 00:09:59;27 → 00:10:00;00 (ten-minute boundary, no drop);
  - 00:01:59;27 → 00:02:00;02 (backward jump target).

  The second decoder read node's LTC out as Δ 1 frame across 01:00:59;29 → 01:01:00;02, 01:09:59;29 → 01:10:00;00
  and 01:01:59;29 → 01:02:00;02.
- **Steady state over 170 s** (`run-25-glass2`, 25 fps, preroll 800):
  - chase error mean −3.4 ms, |mean| 4.5 ms, 0 chase actions;
  - Caspar − engine −58.9 ms with slope **0.1 ms/min, i.e. no drift**;
  - LTC out: one continuous run of 4436 frames, 0 discontinuities.

  The earlier 130 s window (`run-25-full`) gave the same: −9.7 ms mean, slope 0.1 ms/min.
- **What is really on PRV** (Caspar ch3-210 file time − LTC, clip-mapped, preroll 800):
  - start −61 / −63 ms, jumps −84 / −92 ms, resume −65 ms, restart −67 ms;
  - DF: backward cross-clip jump −90 ms (it was −212 / −252 ms at preroll 500);
  - start from stopped was −645 ms before the preroll.

  The remaining −50…−95 ms is Caspar's own output latency vs the engine clock. `chase.latencyMs` can absorb it per show.
- **LTC out from the playing timeline** (second decoder): see the table below.
- **Sub-threshold offset after a dropout.** After the test generator's dropout it resumed ~1 frame off. The chase
  then ran +28…+38 ms ahead, below the 3-frame threshold, so no seek happened (by design, since a seek is a visible
  glitch on 4K H.264).
- **Box disturbances survived:**
  - During a Godot relaunch the input blipped locked → freewheel twice (CPU load). No chase action resulted.
  - Another agent restarted node mid-run (23:54:05). Node was back in 6 s (systemd restart counter; the FIFO shutdown
    guard held). The chase target was re-hydrated from the stored project.

LTC out results:

| | |
|---|---|
| Continuity | 0 discontinuities without a silence gap in every run after the `targetFramesAt` fix (`run-30-short2`). Before the fix, `run-30-short` had one repeated frame at an ~80 ms node stall. |
| Offset | out − in = −0.7…+0.8 frames mean (leadMs 60 plus two decoder paths). |
| Timeline seek | ~530–580 ms of silence (the preroll park), then the new TC with no garbage frames. |
| Pause/hold | Silent while parked (~4.5 s). Restarts on the right frame. |
| Level | −18.6 dB. |

- **On glass** (Godot `:0`, a&s project), scratchpad
  `/tmp/claude-1000/-home-casparcg/2c8389df-06bf-48f2-a6e2-f30036bbf7b0/scratchpad/`:
  - `wo974_settings_timecode.png`: Settings → Timecode with the status line
    `LTC — In 00:01:50:07 locked -19 dB · Out 01:01:50:06` during the chase.
  - `wo974_timeline_chase.png`: the Timeline tab on "WO-974 LTC test", playhead 00:02:06:17 (API LTC 00:02:06:16),
    PRV only.
  - `wo974_timeline.png`: an earlier Timeline shot.
  - The GUI was left on the **Live** tab (`wo974_live_tabs.png`).
- **Gates (07.11):**
  - curated offline suite **5425 tests, 5420 pass, 0 fail, 5 skipped**;
  - WO-974 smokes 46/46 with the system libltc;
  - Godot `--test` **26079 passed, 0 failed**;
  - `check-max-file-lines` 0;
  - eslint 0 errors (3 pre-existing warnings in `timeline-playback-amcp-schedule.js`, also present at HEAD);
  - `format:check` clean, `gen-api-contract --check` OK, `check-wos` OK;
  - `check-unwired-exports`: nothing from WO-974.
- **Cleanup:**
  - Test timeline **deleted**: removed from the project via autosave (rev 436, activeId back to `tmw3u7epoydr`),
    then stopped and DELETEd in the engine.
  - PRV ch3 is clean (no test clips in `INFO 3`).
  - `GET /api/ltc` config deep-equals `normalizeLtcConfig({})` (all off, no paths, no `libPath`).
  - No FIFOs or helper processes left; `projects/_trash` unchanged.

**NOT proven:**
- **Real audio through a sound card** in either direction. The campaign used the FIFO PCM path, which feeds the same
  decoder and encoder code as ALSA; only `arecord`/`aplay` are untested. No free playback → capture pair exists
  without sudo (Investigation, finding 11).
- The DM3 bridge-tee input (the DM3 is not attached).
- A real external deck. The generator is libltc itself, so a different encoder's quirks are untested.

## OPEN

1. ~~Owner: `sudo apt install libltc11`~~: done (system `libltc.so.11`, campaign 06–07.11). eggs clones the host
   package set. The install gates should check the payload file `/usr/lib/x86_64-linux-gnu/libltc.so.11`, not dpkg
   (WO-431).
2. **Real-audio loopback** without a cable needs the owner to run:
   `sudo modprobe snd-aloop index=10 id=Loopback`
   - `index=10` keeps it off `hw:2`, which is the SC60 in `~/.asoundrc` and the Caspar config.
   - Then LTC out device `hw:Loopback,0,0` and LTC in device `hw:Loopback,1,0`.
   - Re-run `wo974/campaign.js` with the sinks set to `alsa`.

   With a cable instead: PCH line-out is held by Caspar, so use a free capture device (`hw:0,0c`) fed from an external
   LTC source.
3. A hardware test with the DM3 bridge tee and a real deck at 29.97 DF.
4. UX proposals (not built, the owner decides):
   - an **LTC badge in the Timeline transport bar**, next to the timecode: `LTC 00:02:06:16 locked` or `chasing`,
     red on loss;
   - a **"Chase this timeline" toggle** in the timeline menu, which writes `ltc.input.chase.timelineId`, instead of
     the bare id field in Settings;
   - showing the chase error and lock state in the Settings → Timecode status line.
5. Follow-up candidate: an engine-level transport landing lead. The operator's own playing seeks on 4K H.264 still
   land 0.3–0.6 s late (finding 4). The chase works around it with its preroll; manual timeline seeks don't.
