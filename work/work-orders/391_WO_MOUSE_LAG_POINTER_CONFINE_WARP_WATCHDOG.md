# WO-391 — Intermittent mouse lag on the box

**Status: DONE for the poll loop (2026-07-30) — the "barriers leak on NVIDIA" premise was FALSE; it was a barrier corner-endpoint gap. Corners sealed, cursor polling DELETED. The original intermittent-lag report is split out as still-unexplained (§7).**

> **Correction to the first pass of this WO (kept deliberately).** It originally asserted the
> pointer-confine warp watchdog *was* the lag. That is **not supported**: sampling the pointer for 5 s
> found it parked at `X=3341 Y=25`, i.e. **inside** the DP-1 fence — and the watchdog only warps when
> the pointer is *outside*. Inside the fence it is a bare `XQueryPointer` every 50 ms, which is far
> too cheap to feel. The per-hour "5–12 restarts" figure was also wrong: it pooled several days AND
> counted `DISPLAY=:87` spawns from the offline test suite (i.e. from this session's own test run).
> **Today shows 2 real restarts.** What survives is the owner's design objection (§1), which is
> correct on its own terms and acted on in §5.
**Source:** owner 30.07.26 — "mouse on the machine is lagging at times. like something is happening in
the background. maybe there is some leftover process that gets the mouse position or something."

The owner's hunch was right about the mechanism, though it is not leftover — it is a shipped feature.

## 1. Cause: the pointer-confine warp watchdog

`tools/runtime/confine-pointer-barriers.py`, started by `src/system/pointer-confine.js` via
`src/utils/x-display-session-runtime.js:59`, does two things:

1. installs 4 XFixes pointer barriers around the operator monitor, and
2. runs `warp_watchdog()` — a loop that calls **`XQueryPointer` every 50 ms (20 Hz)** and, whenever the
   pointer is outside the operator monitor rect, calls **`XWarpPointer` + `XSync` to drag it back**
   (`:188-231`, `time.sleep(0.05)` at `:231`).

Live state confirms it is active and confining to the **operator** monitor:

```
$ ps -eo pid,ppid,etime,cmd | grep confine
1797304  538288  python3 .../confine-pointer-barriers.py DP-1     # parent 538288 = the node server

$ tail ~/.highascg/log/confine-pointer-barriers.log
Pointer confine for DP-1 1920x1080+1920+0
barrier left/right/top/bottom …
Pointer barriers active (4 edges) + warp watchdog

$ DISPLAY=:0 xrandr --listmonitors
 0: +*DP-1 1920/520x1080/320+1920+0   <- operator monitor, pointer fenced to here
 1: +DP-5 1920/800x1080/450+0+0       <- the other monitor
```

So the pointer is fenced to **DP-1**, and there is a second monitor **DP-5 at +0+0**. Any pointer
motion onto DP-5 is fought by a 20 Hz warp loop. That is precisely "lagging at times, like something
is happening in the background": it is not a slow cursor, it is a cursor being repositioned 20 times
a second while you try to leave the operator screen.

The script's own docstring describes the severe version of this, from a previous incident:

> "this loop warps the pointer every 50ms, so when the layout moved under us the watchdog spent 20
> times a second dragging the pointer into coordinates where no monitor existed any more. … the mouse
> unusable — it reads as a frozen cursor, not as a fence."

Right now the rect is **not** stale (barrier geometry `1920x1080+1920+0` matches xrandr), so this is
the milder in-spec case, not the lockout bug. `GEOMETRY_POLL_SEC = 2.0` re-reads geometry, so drift
self-heals.

### 1.1 It is on by default

`src/config/defaults-core.js:47` — `operatorTools.pointerConfine: 'auto'`, and `config/general.json`
carries **no override**, so `'auto'` applies: confinement follows whatever resolves an operator
monitor, and DP-1 resolves. WO-308 added the `'off'` / `'on'` values after the 2026-07-21 mouse
lockout precisely so "operator monitor" and "confine pointer to it" could be chosen separately.

### 1.2 Churn worth noting

The helper is restarted **5–12 times an hour** (`grep "Pointer confine for" …log`, grouped by hour).
Each restart tears down and rebuilds the 4 barriers. Not the main symptom, but it means brief windows
with no fence and repeated barrier churn. Worth a follow-up: find why `pointer-confine.js`'s watchdog
keeps deciding to respawn.

## 1a. Latent hazard: the xdotool fallback spawns a process every 80 ms

`startXdotoolConfine` (`src/system/pointer-confine.js:270`) is the backend used when barriers fail:

```js
confineTimer = setInterval(() => { void tickXdotoolConfine(...) }, 80)
```

and each tick shells out to `/usr/bin/xdotool getmouselocation --shell` — **12.5 process spawns per
second, forever**. If that path ever latches on (barriers failing, xrandr hiccup), it would produce
exactly the reported symptom and would be very easy to mistake for "the machine is just busy".

Right now it is **inactive** — barriers succeed, and the journal has **one** `tick failed` line in
24 h (`11:38:58`, during a transition), not a stream. Flagged rather than fixed: converting it to a
persistent Xlib client instead of a subprocess-per-tick is its own change, and barriers are holding.

## 2. Ruled out

- **Not memory pressure.** 62 GiB total, 16 GiB used, 39 GiB free, **swap 0 B used**, `si/so = 0`.
- **Not CPU starvation.** **28 cores**, load 6.2–7.2 (≈25%). PSI `/proc/pressure/cpu`:
  `some avg10≈6.6`, **`full avg10=0.00`** — nothing is fully stalled. `/proc/pressure/io` all zero.
- **Not the GPU.** RTX PRO 4000 Blackwell at **30–37%** util, 3% memory-bandwidth, 6.3/24.5 GiB VRAM,
  66 °C, `clocks_event_reasons.active = 0x0` (no throttling). Sampled 10× at 1 s — no spikes.
- **Not the system-wide context-switch rate.** `vmstat` shows ~116k cs/s, but per-thread attribution
  (summing `/proc/*/task/*/status`) puts **~104k/s (≈90%) in `casparcg` itself** — inherent to 8
  channels at 50 fps, not a stray poller. Next largest are the vcam ffmpeg (1.3k), the DeckLink
  kthreads (~768 each) and Xorg (733).
- **Not the 30 s `PRINT 8`.** Real (`live_thumbnail_ttl_ms: 30000` drives it) but a 30 s cadence does
  not match "lagging at times" the way a 50 ms warp loop does.

## 3. A genuine leftover, unrelated to the lag

A **headless Firefox from a dead Claude Code session** has been running 19.5 h:

```
376402  --headless --profile /tmp/claude-1000/-home-casparcg/3508d865-…/scratchpad/ffprof
        --remote-debugging-port 9223 --no-remote about:blank      # 618 MB RSS
376687  └─ Isolated Web Co (content process)                      # 208 MB RSS
```

Session `3508d865-…` is not the current session. ~826 MB RSS and ~4.5% CPU for nothing. It is
*headless*, so it holds no pointer and is not the lag — but it should be reaped, and whatever CDP
work spawned it (WO-247 / WO-344 raw-CDP thumbnails) is not cleaning up on exit. Worth a follow-up so
these do not accumulate; `/tmp/claude-1000` already holds 10 session dirs / 124 MB.

## 3a. DONE — orphan reaped

`kill 376402` — the 19.5 h headless Firefox and its content child are gone (verified by `ps`: both
PIDs absent). ~870 MiB returned. A scan of the other 9 scratchpad session dirs found **no** further
live processes from dead sessions.

## 4. Owner's answer, and what was done

Owner 30.07: *"something is wrong with the confiment if it needs to poll the mouse pointer all the
time. seems like it should be clear boundries that are respected. which seemed to work fine
earlier."*

**Correct, and worth stating plainly:** XFixes barriers are enforced **by the X server**. On a driver
that honours them the warp loop never fires, so it is pure overhead — 20 pointless round-trips a
second for the life of the box. The loop exists solely for the NVIDIA multi-head slip-past quirk
named in the script's docstring, and **nobody had ever measured whether this box suffers it.**

What was NOT done, and why: deleting the loop outright today. If barriers *do* leak here, the
operator loses the pointer off-screen mid-show, and 30.07 is a show day. Guessing in that direction
is the one unrecoverable option.

### 5. What was changed (`tools/runtime/confine-pointer-barriers.py`)

- `WARP_POLL_SEC = 0.25` — idle poll **20 Hz → 4 Hz**. A genuinely escaped pointer is still recovered
  within a quarter second, at a fifth of the X traffic.
- **Every warp is now logged** (rate-limited to one line / 10 s by `WARP_LOG_MIN_INTERVAL_SEC`), with
  the escape coordinates and a running count, explicitly saying the barriers did not hold.
- `warp_watchdog`'s docstring now records the decision procedure and the event-driven endgame
  (`XFixesSelectBarrierInput` + `XFixesBarrierReleasePointer`, not polling).

Verified: `python3 -m py_compile` OK; `smoke-wo308-pointer-confine-split` +
`smoke-pointer-confine-geometry-follow` → **12/12 pass**. Deployed live — old helper killed, the
app's 8 s watchdog respawned it as **pid 1842120 at 12:01:12**, all four barriers rebuilt, and
`grep -c "warp:"` on the log is **0**.

### 6. RESOLVED — the instrumentation paid off in 12 minutes, and it disproved the premise

Owner ran the grep and came back with: *"i dont like that mouse cursor poll loop at all. it worked
but in a false situation. i dont see the need for that at all."* The log had two lines, both from the
instrumented build (pid 1976122):

```
12:44:06  warp: pointer escaped to (1919,0) — pulled back to (1920,0)
12:47:12  warp: pointer escaped to (1851,0) — pulled back to (1920,0)
```

**Both escapes are at exactly `y=0`.** That is not a driver leaking at random — it is the barrier
**corner/endpoint gap**. The segments were built to merely *touch*:

```python
("left",   x,   y,     x,   y+h, BARRIER_NEGATIVE_X)   # starts AT y
("top",    x,   y,     x+w, y,   BARRIER_NEGATIVE_Y)   # starts AT x
```

so at the top-left corner both barriers share an endpoint, and a leftward move along the `y=0` row
crosses the left barrier exactly at that endpoint, where X's barrier intersection test does not stop
it. (The 69 px excursion in the second line is just how far the pointer got before the then-4 Hz poll
noticed — the 20 Hz original hid the size of the leak, which is part of why this was never diagnosed.)

So the premise the loop was built on — "NVIDIA multi-head sometimes lets the pointer slip past
barriers", never measured — was **false**. The owner's instinct was right on both counts: barriers
*should* be respected, and the loop *was* covering for a bug elsewhere.

**Fixed at the source and the poll deleted:**

- `CORNER_OVERLAP_PX = 16` — every segment now extends past both perpendicular edges, so a corner
  crossing lands mid-barrier instead of on an endpoint. Live geometry confirms it:
  `left (1920,-16)-(1920,1096)`, `top (1904,0)-(3856,0)`, etc. Documented tradeoff: the overlap
  protrudes just outside the monitor, which is harmless here but would also fence a monitor stacked
  directly above/below.
- `warp_watchdog` → **`barrier_maintenance_loop`**. It re-reads the geometry every
  `GEOMETRY_POLL_SEC` and rebuilds the barriers when the layout moves (that must stay — it is what
  stops the fence fossilising around a dead rect, the WO-176-era bug) and **never touches the
  cursor**. `query_pointer`, `clamp`, and the `XQueryPointer`/`XWarpPointer` ctypes bindings are
  deleted outright.
- Module docstring now says do not reintroduce polling, and names the right answer if the fence ever
  does leak: `XFixesSelectBarrierInput` — barrier **hit events**, which the server pushes to us.

**Verified:** `py_compile` OK; the two confine smokes **14/14** (was 12 — the pointer-clamping
assertions were replaced by their inverse, not dropped: the harness now records any `query_pointer` /
`XWarpPointer` attempt and the test fails if either happens, plus a source guard that the banned
symbols cannot reappear in executable code, plus a guard that all four corners overlap). Full gate
**1728 tests, 1726 pass, 0 fail, 2 skip**. Deployed: helper respawned by its own 8 s watchdog as
**pid 1982228 at 12:52:45**, log reads `4 edges, corners sealed — cursor is not polled`, and **0 warp
lines since** (both existing lines predate it).

### 6a. Precision: cursor polling is gone, but the geometry re-read is STILL a poll

Stated plainly because it would be easy to read §6 as "all polling removed". It is not.
`barrier_maintenance_loop` calls `get_monitor_geometry` every `GEOMETRY_POLL_SEC` (2 s), and that
function is:

```python
out = subprocess.check_output(["xrandr", "--query"], env=env).decode()
```

— a **process spawn plus an X round-trip, every 2 seconds, for the life of the box**. It is not
cursor polling and it earns its keep (it is what stops the fence fossilising around a dead rect), but
by the owner's own principle the right mechanism is **push, not poll**: select
`RRScreenChangeNotifyMask` via XRandR and block on the event, exactly as `XFixesSelectBarrierInput`
is the right answer for barriers. Both would collapse this script to a single blocking
`XNextEvent` loop with zero periodic work.

Not done today: it means adding XRandR ctypes bindings and changing the process from
"loop with sleeps" to "event-driven", on a show day, in the component that holds the operator's
cursor. Worth doing deliberately.

### 6b. The xdotool fallback is NOT merely latent — it engaged today

§1a called it latent. The journal proves otherwise:

```
12:40:46 [warn] [Pointer confine] barrier daemon failed to start
12:40:46 [info] [Pointer confine] xdotool fallback on DP-1 @ 1920,0 1920x1080
12:40:52 [info] [Pointer confine] XFixes barriers on DP-1 @ 1920,0 1920x1080
```

So barrier creation *does* fail sometimes (here during a highascg service restart, racing the
previous process's helper), and when it does the box runs the **80 ms `xdotool getmouselocation`
subprocess loop — 12.5 process spawns per second**. It lasted ~6 s before barriers took over. If
barrier creation ever fails persistently, that loop runs indefinitely, and it is by far the best
match for "the mouse lags at times, like something is happening in the background".

**This is now the top suspect for §7 and the next thing to fix** — either make the fallback a
persistent Xlib client instead of spawning `xdotool`, or drop it entirely now that barriers are
correct.

### 7. Still open: the original intermittent-lag report

> **RESOLVED 2026-07-30 by [WO-397](./397_WO_MOUSE_LAG_8S_XRANDR_FREEZE.md):** none of the
> candidates below was it. The lag is the **8 s barrier watchdog added by this very WO (§9.2)**
> — each tick recomputes the full layout → uncached `xrandr --verbose`/`--query` → two ~180 ms
> X freezes every 8.000 s, causally reproduced. The §9.3 cache never engages: TTL 3 s < 8 s tick.

The poll loop is gone, but it was never proven to be what the owner felt. Measured clean at the time:
swap 0 B; CPU 28 cores / load ~7 / PSI `full=0.00`; IO pressure 0; GPU 30–37% with no throttling; and
the pointer sampled *inside* the fence, where even the old loop did not warp. Remaining candidates if
it recurs, in order:

1. **The xdotool fallback (§6b)** — 12.5 subprocess spawns/second, and it is *confirmed* to engage,
   not merely latent. Strongest match for the symptom. Still unfixed.
2. **`spawnSync` xrandr storms blocking the node event loop.** Seen today 12:53:37–12:54:04, ten
   `[Hardware-Info] getDisplaysXrandrVerboseRaw/Detailed failed: spawnSync /bin/sh ETIMEDOUT` lines
   about 3 s apart. `spawnSync` blocks Node's event loop for its whole duration, and ETIMEDOUT means
   each call burned the full timeout. **Caveat — this burst correlates with the helper restarts this
   session performed at 12:52:37 / 12:52:46 / 12:54:06**, so it may well be self-inflicted rather
   than spontaneous; `display-stable-wait.js` polls `getDisplaysXrandrDetailed` in a loop and a
   confine RUN can trigger it. Do not treat it as an independent finding without seeing it recur
   unprompted. What it *does* prove is that xrandr can time out on this box under X contention —
   which is also an argument for §6a's event-driven rewrite.
3. The X cursor path under the SHAPE/restack watchdogs (`operator-shape-overlay.py` re-asserts
   stacking on a 2 s watchdog).

Next time it happens, note **what was on screen and what the box was doing** — that is the missing
input, not more system metrics.

### 8. Superseded: how this WO used to say to finish itself

Use the mouse normally, and deliberately shove it at all four edges of DP-1, then:

```
grep "warp:" ~/.highascg/log/confine-pointer-barriers.log
```

- **No lines** → barriers hold on this driver. Delete the warp loop (or make it opt-in via env) and
  the last pointer poller on the box is gone — exactly what the owner asked for.
- **Lines present** → the driver really does leak; keep a fallback but make it event-driven, and the
  logged coordinates tell us which edge fails.

And if the lag recurs, note **what was on screen and what the box was doing** — with CPU, GPU, IO,
memory and the pointer poller all now measured clean, the next most likely candidates are the X
cursor path under the SHAPE/restack watchdogs (`operator-shape-overlay.py` re-asserts stacking on a
2 s watchdog) or the §1a xdotool fallback latching on.

Confinement is deliberate show-time behaviour (an operator cannot drag the mouse off the GUI), so it
was **not** changed unilaterally. Options:

| Option | Effect |
|---|---|
| `operatorTools.pointerConfine: 'off'` | Pointer moves freely across both monitors. Operator can drag the mouse off the operator GUI onto DP-5. |
| Leave `'auto'` | Fence stays; the mouse keeps fighting on DP-5. |
| Raise `time.sleep(0.05)` / drop the warp loop, keep barriers | Barriers alone are the hard stop on drivers that honour them; the warp loop is the fallback for drivers that do not. Softens the symptom without giving up the fence — needs testing on this driver (`nvidia-modeset` present). |

Recommendation: `'off'` while the box is used for development, back to `'auto'` for shows — or the
third option if the fence is wanted permanently.

---

## 9. WO-391b / WO-391c — the three follow-ups, done (2026-07-30, owner: "i want these 3 fixed. i need that xrandr rewrite")

### 9.1 The xrandr rewrite (§6a) — event-driven, no fork

`tools/runtime/confine-pointer-barriers.py`:

- Geometry now comes from **`XRRGetMonitors`** (RandR 1.5) via ctypes. Verified against the old
  parser on the live display: both return `('DP-1', (1920, 1080, 1920, 0))` — byte-identical.
- **RandR change events** (`RRScreenChangeNotify | RRCrtcChangeNotify | RROutputChangeNotify`)
  selected on the root window; the process blocks in `select()` on the X connection.
  `XRRUpdateConfiguration` is called for ScreenChangeNotify so Xlib's cached config cannot go stale.
- `main()` reordered to open the display **before** the first geometry read, so even process startup
  no longer forks `xrandr`.
- The `xrandr --query` parser survives only for RandR < 1.5; the 2 s loop only if RandR cannot be set
  up. Both log `DEGRADED` when they engage.

**Measured on the deployed build** (the point of the whole exercise):

| | old | new |
|---|---|---|
| idle CPU ticks / 12 s | — | **0** |
| context switches / 35 s | ~17 forks + ~700 `XQueryPointer` | **2** |
| child processes | 1 `xrandr` per 2 s | **0** |

**What is NOT proven, and why the code says so.** Event *delivery* could not be verified. The probe
used — `xrandr --setmonitor` / `--delmonitor` — turned out to emit no RandR notify at all; that was
established by running **`xev -root -event randr` as a reference client**, which saw nothing either,
so it was a bad probe rather than evidence about our client. (`--brightness` was also tried and is a
gamma-ramp op via `XRRSetCrtcGamma`, which emits nothing.) Proving it needs a real mode/framebuffer
change, refused on a show day.

So correctness does not depend on it: `select()` keeps a **`GEOMETRY_BACKSTOP_SEC` = 30 s** timeout
as a safety net, and the loop logs `RandR change event RECEIVED` the first time an event actually
wakes it. That line appearing after the next real layout apply is the signal that the backstop can be
dropped for a pure block. This is deliberately the same instrument-then-decide pattern that disproved
the warp loop's premise in §6 — the alternative was assuming events work and silently fossilising the
fence, which is the exact bug §6a set out to avoid.

### 9.2 The xdotool fallback (§6b) — deleted

`src/system/pointer-confine.js`: `tickXdotoolConfine` / `startXdotoolConfine` / `stopXdotoolConfine`
and `confineTimer` are gone, with the reasoning kept as a block comment where they were. Barrier
failure now logs `pointer left UNCONFINED` and leans on the existing 8 s watchdog to retry — which is
how the observed 12:40:46 transient healed itself anyway. Dead imports (`pointerInConfineAllowance`,
`parkPointerOnOperatorDisplay`, `resolveXdotoolBin`, local `clamp`) removed; the unwired-exports
ratchet stays green because `pointerInConfineAllowance` is still referenced by its own smoke test.

### 9.3 The spawnSync xrandr storm (§7 item 2) — cached + failure backoff

`XRANDR_TIMEOUT_MS` and `XRANDR_CACHE_TTL_MS` were **both 3000**, so a wedged X server gave "block
3 s → time out → cache 3 s → block 3 s": the node event loop gone ~half the time, re-hammering an X
server already in trouble. And `getDisplaysXrandrVerboseRaw` had **no cache at all** — measured **195
ms per call** on this box, reading EDID from every output.

- New `XRANDR_FAILURE_BACKOFF_MS` (30 s, `Math.max(TTL, …)` so it can never be shorter than the
  success TTL). Successes keep the 3 s TTL so an applied layout stays visible.
- `--verbose` cached, shared by its sync and async siblings, cleared by `invalidateXrandrCache()`.
- Both `--query` paths mark boot-snapshot fallback as `failed`, since the live probe did not answer.

**File split (500-line gate):** the additions took `hardware-info.js` 491 → 554. Extracted
`src/utils/hardware-info-xrandr.js` (probes + parser + cache, 337 lines) leaving `hardware-info.js`
at 255; every previously-public name is re-exported, verified by asserting all 15 exports still
resolve. `parseXrandrQueryRaw` is intentionally NOT exported — the WO-367 ratchet correctly flagged it
as an unreferenced surface.

**Test repointing, not weakening** (the CLAUDE.md rule): `smoke-hardware-info-xrandr-timeout.test.js`
greps source text, so its execSync scan now reads **both** files concatenated (`getGpuModel`'s call
stayed behind, the two probes moved — scanning one file would have silently stopped checking the
probes the test exists for), and the async-timeout check follows the functions. Its
`XRANDR_TIMEOUT_MS` guard was also *strengthened*: it used to early-return because the constant was
never exported from `hardware-info.js`, and now asserts against the module that does export it.

### 9.4 Verified

- Full gate **1736 tests, 1734 pass, 0 fail, 2 skip**; 500-line gate 0 over; unwired-exports ratchet
  green; `py_compile` OK.
- New/updated tests: `smoke-wo391c-xrandr-cache-backoff.test.js` (6, registered in the curated list —
  stubs `child_process` via `require.cache` so it needs no X and counts execs exactly),
  `smoke-pointer-confine-geometry-follow.test.js` now 7 (adds: geometry comes from the API and forks
  no subprocess; the watch is event-driven with polling only as a logged degradation; the backstop
  must stay ≥ 15 s so it cannot regress into the old 2 s poll).
- Deployed: highascg restarted (`kill -TERM`, pid 2007538 → healthy, `/api/state` 200, both services
  active), confine daemon respawned by its own watchdog with `corners sealed` + `no cursor polling, no
  xrandr fork; 30s backstop`, and the idle-cost measurement above taken on the running process.
