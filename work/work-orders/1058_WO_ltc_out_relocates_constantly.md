# WO-1058 — LTC out to ALSA re-located ~3×/s (never ran clean); stuck 2 frames behind after a loop wrap

**Area:** audio, engine
**Status: DONE (13.11 — offline repro + smoke; live on the Scarlett: 0 re-locates in a pass, 2 at the loop wrap, 0 after)**

Owner, 13.11: *"i still cant get ltc out of the scarllet"* … *"run some tests on the scarlet output. ill run the timeline in loop."*

## Investigation

- `GET /api/ltc` on the box, source `timeline`, timeline looping: `relocates` 1057 → 1589 in 3 min (~3/s). Each re-locate is
  a jump in the LTC, so a receiver could not hold lock. Source `clock` in an offline repro: 60 re-locates in 20 s.
- Offline repro: a fake `aplay` on PATH that consumes PCM at exactly real time (10 ms periods) + the real
  `createLtcOutput` (`src/timecode/ltc-output.js`).
- **Cause 1 — the encoder was not paced by the sound card.** `ltc_helper.py` shrinks its stdout pipe to 4 KiB
  (`F_SETPIPE_SZ`) so `aplay`'s buffer back-pressures it. Under node the helper's stdio are **UNIX sockets**
  (`/proc/<pid>/fd/1 -> socket:[…]`), the fcntl fails silently, and `e.stdout.pipe(aplay.stdin)` adds node's stream
  buffers. Measured: the encoder wrote 145 frames in 5.04 s (126 expected), in bursts; reports ran −3…−23 frames against
  the target and jumped back. From a shell pipe the same helper wrote exactly 50 frames / 2 s.
- **Cause 2 — report timestamp taken after the blocking write.** A 2-channel frame (7680 B) is larger than the pipe, so the
  write blocks up to a frame; `at` was taken after it → a steady 2-frame offset in some start phases → re-locate every
  second report (49 in 20 s, bistable).
- **Cause 3 — a re-locate while running lands 2 frames late, every time.** After a jump (loop wrap, seek) the debug log
  showed `signed −2` on every report: `locate` is read between frames with frames already queued. Each further re-locate
  repeated the same miss (2.5/s for good). On the box: 0 re-locates for the whole first pass (2 min 40 s), then 51 in the
  20 s after the wrap.
- The Scarlett also dropped off USB in bursts (kernel: `usb 1-13: USB disconnect`, xhci "not part of TD" on ep 1) at
  01:30, 01:41, 01:58, 02:04. None since 02:04:37 (35 min, incl. two node restarts and 6 min of watched streaming).
  Hardware / cabling; not caused by HighAsCG. Each drop was restarted correctly.
- Not a bug: source `timeline` is silent while the timeline is stopped or holding its end frame.

## What was done

- `tools/ltc/ltc_helper.py`: `--sink-cmd <json argv>` — the helper starts the sink (`aplay`) itself on a real pipe shrunk to
  4 KiB (`open_sink`), relays the sink's stderr as `{"error": "sink: …"}` and exits 4 when the sink dies. Report `at` is
  taken before the write.
- `src/timecode/ltc-helper.js` `spawnEncoder(…, { sinkCmd })`; `src/timecode/ltc-output.js`: ALSA passes `aplayArgs()` as
  `sinkCmd` (no node pipe; FIFO sink unchanged), exit 4 → restart with the sink's error. `sync()` learns the landing latency
  of a running re-locate (`aim`, ±4 frames max): a second miss within 1.5 s of a re-locate adds its offset to `aim`.

## What was verified

- `tools/smoke/smoke-wo1058-ltc-alsa-pacing.test.js` (new, in `offline-test-files-2.js`): 1 ch and 2 ch run 6 s on the clock
  with ≤ 1 re-locate; loop wrap ≤ 2 re-locates at the first wrap and ≤ 1 at the next; a dying sink is reported with
  "No such device" and restarted. With the WO-974 smokes: **33 / 33**.
- Offline repro, 20 s, 8 runs (4 mono + 4 stereo, in parallel pairs): **0 re-locates** each (before: 53–62).
- Live on the Scarlett (`plughw:CARD=USB,DEV=0`, source timeline, loop on): 0 re-locates in the first pass (3 min watch at
  0.5 s, PCM RUNNING throughout); after the final fix, seek to 150 s → wrap: 0 before, **2 at the wrap, 0 in the next 45 s**;
  `starts` 1, no USB disconnect.
- **Not verified:** the signal with ears or a reader on the Scarlett's outputs (nothing on the box can capture them), and
  a hardware LTC reader's lock.
