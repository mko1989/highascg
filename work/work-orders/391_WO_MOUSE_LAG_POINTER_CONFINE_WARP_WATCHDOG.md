# WO-391 — Intermittent mouse lag on the box

**Status: OPEN (2026-07-30) — root cause NOT proven. Polling reduced 20 Hz → 4 Hz and instrumented so the next occurrence produces evidence. Two latent hazards found and one orphan reaped.**

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

### 6. How to finish this WO

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
