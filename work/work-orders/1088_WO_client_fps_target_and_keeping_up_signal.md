# WO-1088 — "Client at 100 fps?" + one clear "keeping up" signal (header pulse turns amber / red, names the worst offender)

**Area:** godot-client, engine
**Status: DONE (15.11, on the box: API + journal + on-glass screenshots of calm / amber / red / incident history; offline 6680 + Godot 28707 tests) — open: the not-publishing cost was not measurable on this show (§3)**

Owner, 15.11: *"check why the client is running in 100fps. or at least thats what the health check says. we also need a
clear info when something isnt keeping up"*

Related: [WO-907](./907_WO_client_render_not_vsync_paced.md) (why vsync is off + 100 fps cap),
[WO-623](./623_WO_godot_owner_notes_next_md_2.md) (the performance overlay, the pulse icon),
[WO-798](./798_WO_godot_client_idle_cpu_regression.md) (idle CPU), [WO-715](./715_WO_performance_check_23_10.md)
(OSC handled once, host-stats method), [WO-1084](./1084_WO_next_show_setup_offline_screens_not_started.md) (screen gate).

## 1. Investigation (15.11, box, read-only)

### Why the health popup says "FPS 100"

- Confirmed, deliberate. `godot/client/project.godot`: `run/max_fps=100`, `window/vsync/vsync_mode=0` since WO-907
  (commit 1c27f4fe, 31.10). The client renders the show's Visuals and `features/shm_out/viewport_publisher.gd`
  publishes **every Godot frame** into `/dev/shm/highascg-visuals`; Caspar's shm producer takes the newest frame each
  channel tick. Vsync-paced (FIFO, 50 Hz monitor) it delivered ≈ 44 new frames/s and stalled 90–100 ms per alt-tab;
  free-running at 100 = 2 × the 50 fps channel delivers 48–50/s with no stall. Pinned by
  `tools/smoke/smoke-wo907-client-free-running-render.test.js`.
- `app/perf_overlay_model.gd:client_rows` shows the bare number and judges it against fixed thresholds (warn < 45,
  alarm < 20): nothing says 100 is a target, nor what it is twice of.
- The cap is static: the client renders 100 fps whatever it does — also when no publisher runs (just the GUI and the
  previs), where twice the monitor rate buys nothing.

### Measured now (owner's GUI pid 405791, started 21:43, Visuals on air)

| what | value |
|---|---|
| operator monitor | DP-3 1920x1080 @ 50.00 (the only lit head; DP-0 dark → ch2 has no screen consumer, WO-1084 gate) |
| client CPU (`/proc/<pid>/stat`, 3 × 10 s) | 78 / 76 / 76 % of one core |
| GPU (`nvidia-smi`, `pmon`) | 48 % total; casparcg 39–44 % SM, godot 0–6 % SM |
| `highascg-visuals` ring (header `latest` @96, seq = latest >> 8) | **100 publishes/s** (25601 / 256 per s) |
| Caspar `ch2 layer 1 shm/frames` (OSC :6250) | 245 new frames in 5 s = **49 / s** of 50 |
| `highascg-pgm1`, `highascg-opgui` (Caspar → client) | 50 / s each |

So now (on air) the 100 cap is doing its job; the waste is in the not-publishing state.

### What is already measured somewhere (before adding probes)

- **Caspar OSC** (full copy sniffed read-only on UDP :6250, `scratchpad/osc_addrs.py`; the node listens on :6251):
  per channel per tick `/channel/N/framerate [50,1]`, `/channel/N/format`, and per output port
  `…/output/port/P/consumer` plus consumer counters:
  - screen consumer: `screen/presented_frames`, `screen/dropped_frames`, `screen/name`
    (Caspar `modules/screen/consumer/screen_consumer.cpp:1362-1369`) — none on this boot (no lit program head);
  - shm consumer (opgui ch1 / pgm1 ch2): `shm/published`, `shm/dropped` (23 / 2, static);
  - portaudio (ch2): `fifo-underruns` 246, `fifo-overruns` 131 (static while sniffed), `frame-counter`;
  - DeckLink consumer: **no counter on OSC** — its late / dropped frames only go to Caspar's diagnostics graph
    (`decklink_consumer.cpp:704-705, 970-974`), `monitor.cpp` sends config only. Not watchable without a Caspar patch;
  - ffmpeg consumer (recording / stream): `file/frame` only, no drop counter;
  - layers: `stage/layer/L/foreground/producer`, `paused`, and for shm producers `shm/frames` (new frames taken),
    `shm/lapped`, `shm/signal`, `shm/name`. DeckLink input layers: `has_signal`, `buffer [n, cap]` (inputs with no
    cable read `has_signal False` — a normal state, not a keeping-up problem).
  - No channel-level `profiler/time` on this build (only per DeckLink producer layer).
- **`src/osc/osc-state.js:144-163`** keeps only `output/port/P/type|frame` (and `frame` is no longer sent); the
  counters above, `framerate` and the layer shm counters are not stored anywhere in the node.
- The node's OSC socket (`ss -ulpnm`: `127.0.0.1:6251 … d1684`) drops a datagram now and then (bursty, 0 over 10 s)
  → rates must come from the **cumulative counters**, never from message counts.
- **Ring header** (`caspar/modules/shm/hshm_abi.h`): `fps_num` @32, `fps_den` @36, `latest` @96, `dropped` @112,
  `published` @120 — the writer's own rate, readable with one 128-byte `pread`.
- **Box**: `GET /api/host-stats` (`src/api/routes-host-stats.js`) — machine CPU % (`src/system/host-cpu-usage.js`),
  RAM, `nvidia-smi` util / VRAM / temperature (one spawn per 5 s TTL), Caspar + node process CPU. Thermal throttling:
  not read. `nvidia-smi --query-gpu=…,clocks_event_reasons.hw_thermal_slowdown,clocks_event_reasons.sw_thermal_slowdown`
  works on this driver ("Not Active"); `-lms 1000` loop mode costs 0 % of a core (10 s sample). CPU:
  `/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count` (81445, unchanged over 10 s idle).
- **Node event loop**: not measured anywhere (`monitorEventLoopDelay` unused).
- **Follow / DMX engine** (`src/fixtures/follow-engine.js:50, 221-245`): 23 ms clock + frame kicks; tick lateness and
  tick cost are **not measured** (`status()` reports `tick_hz` only).
- **Tracking**: the sidecar reports `{state, fps, ms}` per camera at 1 Hz (`tools/tracking-detect/sidecar.py:330-338`),
  kept in `detect-service.js:72` (`sidecar`), with the target rate `config.interval_ms` (67 ms ≈ 15/s). Detection is
  off on this box now.
- **WS backlog**: `ws.bufferedAmount` is checked per send (`src/server/ws-server.js:119-131`; > 8 MB terminates,
  'change' frames are skipped) but never surfaced.

## 2. What was done

Commits `90d3f33c` (server), `7d9c55ad` (client), `42c482cd` (on-glass follow-ups). Nothing pushed.

### Part A — the cap follows what the client feeds (`godot/client/app/render_pacer.gd`, new)

- One static pacer. While at least one `viewport_publisher.gd` feeds Caspar (Visuals on air or as a Live source, a Live
  shm source, a solo bus) the cap is **2 × the fastest fed channel's fps** (the `fps` the publisher was started with =
  `programResolutions[screen].fps` — 50 → 100, 60 → 120, 25 → 50, never hard-coded). Otherwise it is the **monitor's
  refresh** (`DisplayServer.screen_get_refresh_rate()`, here 50), the show's channel rate when the refresh is unknown, 60
  as the last resort. Never below the idle cap. Vsync stays off (WO-907's alt-tab stall finding stands).
- Seamless: `viewport_publisher.start()` calls `Pacer.publish_started()` **at the end of a successful start, before the
  first published frame** — the cap rises at once and any pending lowering is void. `stop()` (and PREDELETE — not
  `_exit_tree`, an undocked tab re-parents) calls `publish_stopped()`, which lowers only after `HOLD_S = 5 s`
  (seq-guarded SceneTree timer), so a re-start in between (a resize, Send off/on) never dips.
- `--max-fps N` on the client's command line is the operator's own cap: the pacer never touches it and the fps check
  judges against it ("why: --max-fps N").
- `project.godot` keeps `max_fps=100` (the boot value until `Pacer.boot()` brings it to the idle cap 5 s in) — the
  WO-907 smoke still pins it, and a new WO-907 test pins the 2× rule, its place in `start()` and the hold.
- The health popup's FPS row now reads **"100 / 100 · 2× the 50 fps show, feeding Caspar"** (or "50 / 50 · the 50 Hz
  monitor"); its colour is the debounced level of the client's own check — target-relative, no fixed 45 / 20
  (`perf_overlay_model.gd`).

### Part B — one "keeping up" signal

Server (`src/health/`, new; wired from `index.js`, `shutdown.js`, one appended `register` on an existing `router.js`
line — that file is at 497 lines):

- `osc-health-counters.js` + one hook in `osc-state.js`: keeps Caspar's cumulative counters per output port
  (screen presented / dropped, shm published / dropped, portaudio fifo-underruns / -overruns) and per shm layer
  (`shm/frames`, signal, name) plus each channel's `framerate`. int64 counters arrive as a single osc.js `Long`, which
  `_argValues` dropped — the raw args are passed instead.
- `keeping-up-checks.js` (pure): one sample → named checks with target, measured, `text`, a plain-language `label`
  ("Visuals at 38 of 50 fps") and a one-line `hint`. Rates come from **counter deltas over each entry's own
  timestamps** (≥ 0.5 s; the node's UDP socket drops datagrams, so message counts lie). A counter going backwards
  (Caspar restarted) gives no rate, not a negative one. Thresholds:

| check | data source | behind (amber) | failing (red) |
|---|---|---|---|
| Caspar link | `ctx._casparStatus.connected` | — | not connected (the only check then: "Caspar not connected — outputs unwatched") |
| Caspar OSC | last OSC message | silent > 5 s | — |
| screen output | OSC `screen/presented_frames`, `dropped_frames` | presented < 0.94 F or any drop (rise 1) | < 0.8 F or ≥ 0.1 F drops/s |
| preview feed (shm consumer → clients) | OSC `shm/published`, `shm/dropped` | drops or < 0.9 F | never (on air is unaffected) |
| audio output | OSC portaudio `fifo-underruns` + `fifo-overruns` | ≥ 3 in the 2 s window | ≥ 10 |
| shm source layer (Visuals, Live shm sources) | OSC layer `shm/frames` vs T = min(F, ring header fps) | < 0.9 T | < 0.5 T ("not arriving" at 0) |
| server event loop | `perf_hooks.monitorEventLoopDelay` (10 ms resolution subtracted) | p99 ≥ 100 ms, or a stall ≥ 500 ms (rise 1) | mean ≥ 50 ms |
| DMX follow | `follow-engine.js takeTiming()` (new: tick work + gap, reset per read) | gap ≥ 4 ticks or a tick ≥ 23 ms | mean tick ≥ 23 ms |
| tracking camera | sidecar `{state, fps, ms}` via `ctx.detectService.health()` (new) | fps < 0.8 T while compute-bound (ms ≥ 0.8 interval) | fps < 0.5 T |
| WS backlog | each client's `bufferedAmount` (loopback named "on this box") | ≥ 1 MiB | ≥ 6 MiB |
| CPU / RAM / VRAM | `/proc/stat`, `os`, nvidia-smi | ≥ 90 / 90 / 90 % | ≥ 98 / 96 / 97 % |
| GPU | nvidia-smi util | ≥ 95 % | — |
| GPU / CPU temperature | nvidia-smi `clocks_event_reasons.*thermal_slowdown`; `package_throttle_count` delta | throttling (rise 1, fall 10) | — |
| client fps (reported) | POST …/report from each client | the client's own judgement | the client's own judgement |

- `keeping-up-model.js` (pure): hysteresis per check (rises after `rise` samples, default 2; falls after `fall`,
  default 5; worst level seen while rising/falling wins), incidents (start, end, duration, worst value; "check gone"
  when its subject vanishes), the worst offender = highest level, then group rank caspar → output → source → client →
  server → box. `changed` = a status change or an incident event (a newly listed ok check is not a change).
- `keeping-up-service.js`: samples at 1 Hz (no per-frame work; a persistent `nvidia-smi -lms 1000` child, retried
  after 60 s if it dies; ring headers read with one 128-byte pread, cached 10 s). Channel names from the channel map
  (program → screen label, "… preview", "Operator GUI", "Multiview"). Broadcasts WS **`health:keeping-up`** only on
  change. Journal **`[keeping-up] behind|failing: <label> (<worst>)`** at each start and **`[keeping-up] recovered
  after N s: <label> — worst <status>, <worst>`** at each end. Preshow (`offline_mode`) → no checks at all.
- Routes (`routes-keeping-up.js`): `GET /api/health/keeping-up` → `{level, status, label, worstKey, checks[],
  incidents[], updatedAt, mode}`; `POST /api/health/keeping-up/report` (a client's own check, 30 s TTL, level clamped
  0..2; 400 without client/key). API + WS contracts regenerated.

Client (`godot/client/app/`):

- `keeping_up_model.gd` (pure) + `keeping_up.gd` (a Node with a 1 s Timer): the client judges **its own fps against
  the pacer's target** — publishing: failing below 0.95 × the channel rate (Caspar repeats frames), behind below 0.85 ×
  the cap; not publishing: behind < 0.8 ×, failing < 0.5 × the cap. Rise 3 / fall 5. Not judged in the first 15 s
  after launch nor 6 s after a publisher starts (shader compile; the per-second average trails the raised cap). A
  not-ok own check is POSTed to the server (on change, every 10 s while it lasts) as "Operator client" (on the box) or
  "Client <host>", so it is journalled and the other clients see it; the server's copy of its own report is left out
  of its merge (the local one is fresher).
- Header (`shell.gd`): the **pulse icon turns amber / red**; a short label next to it names the worst check (its
  `name`, clipped with an ellipsis into the free header room — on a 1920 px header only ~60–90 px are free, see §3;
  the full label is the tooltip). Clicking the label or the icon (F3) opens the panel. Calm = the plain icon, no label.
- Health panel (`perf_overlay.gd`): a **KEEPING UP** block on top — summary label (or "all keeping up"), every check
  "name · measured / target · why", offenders first in their colour with their hint wrapped under them, then
  **RECENT** — the last 5 incidents "HH:MM:SS · 12 s · Visuals at 38 of 50 fps — worst 31 / 50 fps" (ongoing ones
  say "ongoing"). Refreshed by WS on change and by GET every 2 s while the panel is open.

### No-false-alarm states (each one a test or observed live)

Nothing playing (no layer → no check) · a paused shm layer · a layer that is not shm (DeckLink inputs without signal
are not watched) · the screen-gate state (no screen consumer → no output check) · the first sample (no rate yet) · a
Caspar restart (counters reset → no rate, not "0 fps") · preshow (no checks) · Caspar down (exactly one check) · an
idle box · tracking detection off, and a slow camera that is not compute-bound · a client capped with `--max-fps` ·
a lone portaudio under/overrun (the chronic clock drift below) · a client in its first 15 s / a publisher's first 6 s.

### Finding: the portaudio output overruns chronically

Caspar's log shows `FIFO overrun #…` every few minutes on ch2's portaudio consumer (thousands per day) — card vs
channel clock drift, not load. Judged as "behind" only as a burst (≥ 3 in the window). Not fixed here.

## 3. What was VERIFIED

### Why 100 fps — answered (§1): deliberate WO-907 cap, 2 × the 50 fps channel while Visuals feed Caspar.

### Tests and gates

- Node: WO-1088 smokes **23 / 23** (model 7, checks 12 — a real `OscState` fed osc.js packets incl. `Long` counters —,
  service 4) + WO-907 **3 / 3**; in `tools/ci/offline-test-files-3.js`. Full offline suite **6680 pass, 1 fail** — the
  fail was `check-wos` (INDEX stale before this WO was indexed); `node tools/wo/check-wos.js` → OK afterwards.
- Gate loop: verify:script-paths 0 · check-max-file-lines 0 · check-unwired-exports 1 → fixed (10 internal-only
  exports dropped) → 0 · `node index.js --no-http` 0 · lint 0 · format:check 0 · npm-audit 0 · offline tests (above).
- Godot: `--check` boot OK; `--test` **28707 passed, 0 failed** (new `test_keeping_up_model.gd`, repointed
  `test_perf_overlay.gd`: a low fps without a target is no longer an alarm).

### Live on the box (node restarted once 22:09 with the new code; the owner's GUI relaunched twice by me, 22:18 and 22:20, under `flock -o /tmp/highascg-gui.lock`, same env + args as the running loop)

- `GET /api/health/keeping-up` (calm, 22:11): status ok, 13 checks — Caspar OSC flowing · Preview feed opgui 50 / 50 ·
  Preview feed pgm1 50 / 50 · PGM/PRV 1 audio out no under/overruns · **Visuals 50 / 50 fps** · DMX follow gap ≤ 25 ms
  tick ≤ 0.4 ms · Server max 7 ms p99 1 ms · CPU 9 % · RAM 14 % · GPU 43 % · VRAM 7 % · GPU / CPU temperature no
  throttle. No screen-output check (no screen consumer on this boot — WO-1084 gate).
- **Real incidents it caught** (not induced by the check itself):
  - the offline test suite running on the box (22:09–22:11 and an other agent's run 22:22): *Visuals at 23–38 of 50
    fps*, *Operator client at 3–79 of 100 fps*, *PGM/PRV 1 audio output glitching (19 under/overruns)*, *CPU thermal
    throttling* (i7-14700KF package at 93 °C). Running the suite on the show box visibly hurts the on-air Visuals.
  - every GUI relaunch: *Visuals not arriving (0 of 50 fps)* for ~6 s (the publisher is gone; Caspar holds the last
    frame), and on one relaunch *Visuals at 31–35 of 50* for ~10 s while the new client compiled and settled.
- **Induced** (22:14:52–22:15:31): a synthetic client report (amber), then a CPU burner (one `nice -n 19` busy loop
  per core, 25 s). Journal:

```
[warn] [keeping-up] behind: TEST induced client at 70 of 100 fps (70 / 100 fps · induced by WO-1088 test)
[warn] [keeping-up] behind: CPU thermal throttling (6 throttle events)
[warn] [keeping-up] failing: CPU saturated (98 %) (98 %)
[warn] [keeping-up] behind: PGM/PRV 1 audio output glitching (15 under/overruns)
[warn] [keeping-up] behind: Operator client at 51 of 100 fps (51 / 100 fps · 2× the 50 fps show, feeding Caspar)
[warn] [keeping-up] behind: Preview feed opgui dropping frames (51 / 50 fps · 1 dropped)
[warn] [keeping-up] behind: Visuals at 41 of 50 fps (41 / 50 fps)
[info] [keeping-up] recovered after 6 s: Visuals at 41 of 50 fps — worst behind, 41 / 50 fps
[info] [keeping-up] recovered after 15 s: PGM/PRV 1 audio output glitching — worst failing, 38 under/overruns
[info] [keeping-up] recovered after 26 s: CPU saturated (99 %) — worst failing, 99 %
[info] [keeping-up] recovered after 33 s: CPU thermal throttling — worst behind, 145 throttle events
```

  Even at nice 19 the burner glitched the program audio out and cost Visuals frames for a few seconds — the box has
  no CPU headroom to spare for side jobs (and package-throttles at 93 °C).
- **On glass** (screenshots, `scratchpad/ku/`): calm (plain pulse icon); amber (amber icon + label); red (red icon +
  "CPU saturated (99 %)"); the panel's KEEPING UP list with offenders first and their hints, target vs measured per
  check, "This client 100 / 100 fps · 2× the 50 fps show, feeding Caspar", and RECENT with clock, duration, label,
  worst. Back to calm when everything recovered. First pass found the long label pushing the pulse icon and the eyes
  off a 1920 px header → fixed (`42c482cd`: name + ellipsis), re-checked on glass: icon and eyes stay, label reads
  "TEST cl…" in amber / red — the free header room is that small (the PGM timer reserves 360 px).
- Part A on glass: the client publishing (Visuals on air **and** a Live source) reads **100 / 100 · 2× the 50 fps show,
  feeding Caspar**; client CPU 58–63 % of one core (6–10 s samples), GPU 37–41 % total (casparcg 42 % SM; pmon gives
  no per-process figure for godot). The 21:43 "before" (76–78 %) was on another tab and is not comparable.

### Not verified / open

- **The not-publishing cap (monitor rate, 50 here) and its saving were not measured live**: in this show Visuals is
  both on air and a Live source (`slice.output.ring`, project data); turning the Live source off would change the
  active project, which this WO was not allowed to do. Covered by `test_keeping_up_model.gd` (targets, raise at
  once, hold) only. Owner: switch Visuals' Send and Live source off once and read the FPS row (expect "50 / 50 · the
  50 Hz monitor" after 5 s) and the client's CPU.
- The screen-output check (presented / dropped) was not exercised live — no screen consumer on this boot.
- DeckLink and ffmpeg consumer drops are not on Caspar's OSC on this build — not watched (needs a Caspar patch).
- The client's long-frame (hitch) detection is not done — the check is the per-second fps average only.
- The level clamp on POST …/report (`42c482cd`) is offline-tested only; the running node predates it (no third
  restart — it would have dropped the other agent's test people).
- Header room: at 1920 px only the check's name fits, clipped. Giving the label more room (e.g. letting it use the idle
  PGM timer's 360 px reservation) is an owner layout call.

### What the owner must do to see it

Nothing for the server (running since 22:09). The GUI already runs the new client code (relaunched 22:20). Look at the
pulse icon at the top right: plain = everything keeps up; amber / red + a name = something is behind; click it (or F3)
for the KEEPING UP list and the recent incidents. `journalctl -u highascg | grep keeping-up` lists every incident.
