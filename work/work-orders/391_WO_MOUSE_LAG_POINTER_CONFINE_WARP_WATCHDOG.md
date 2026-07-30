# WO-391 — Intermittent mouse lag on the box

**Status: DIAGNOSED (2026-07-30) — cause identified, awaiting owner decision on the setting**
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

## 2. Ruled out

- **Not memory pressure.** 62 GiB total, 16 GiB used, 39 GiB free, **swap 0 B used**, `si/so = 0`.
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

## 4. Owner decision required

Confinement is deliberate show-time behaviour (an operator cannot drag the mouse off the GUI), so it
was **not** changed unilaterally. Options:

| Option | Effect |
|---|---|
| `operatorTools.pointerConfine: 'off'` | Pointer moves freely across both monitors. Operator can drag the mouse off the operator GUI onto DP-5. |
| Leave `'auto'` | Fence stays; the mouse keeps fighting on DP-5. |
| Raise `time.sleep(0.05)` / drop the warp loop, keep barriers | Barriers alone are the hard stop on drivers that honour them; the warp loop is the fallback for drivers that do not. Softens the symptom without giving up the fence — needs testing on this driver (`nvidia-modeset` present). |

Recommendation: `'off'` while the box is used for development, back to `'auto'` for shows — or the
third option if the fence is wanted permanently.
