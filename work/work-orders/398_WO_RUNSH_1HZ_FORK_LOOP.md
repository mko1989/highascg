# WO-398 — run.sh hang-detector forks ss+grep+sleep every second, forever

**Status: DONE (2026-07-30, executed as part of WO-400's supervisor cleanup, owner: "do this now" — healthy-state poll is 10 s seconds-accounted; live fork capture: 5 run.sh forks/32 s, was ~96; hang budget preserved, `ss -tln`)**
**Source:** WO-397 §1.6 background findings (owner 30.07: "make work orders for fixing the other 2 issues").

---

## 1. Investigation (2026-07-30)

WO-397's 50 Hz /proc fork capture showed a constant background fork churn:

```
15:23:24.286 ppid=12556 [/bin/sh run.sh] :: ss -tlnp
15:23:24.286 ppid=12556 [/bin/sh run.sh] :: grep -qE :5250\b
15:23:24.307 ppid=12556 [/bin/sh run.sh] :: sleep 1
… (every single second, all day) …
```

Chain: `run.sh:run_caspar()` supervises the Caspar child with a hang detector — every loop
iteration calls `caspar_amcp_listening` (`tools/runtime/casparcg-supervisor-lib.sh:134`:
`ss -tlnp | grep -qE ":5250\b"`) then `sleep 1`. That is 3 forks/second (~260 k/day) in the
HEALTHY steady state, purely to notice an AMCP hang whose reaction budget is
`CASPAR_HANG_SEC` = **90 s**.

Impact: no X server contact (ruled out as the WO-397 lag), but constant fork/exec churn and
supervisor log noise. It also showed up as the dominant line-noise in every fork capture,
which is itself a diagnosability cost.

## 2. Proposed fix

Poll at hang-budget granularity in the healthy state: once `_saw_amcp=1` and the port is
listening, `sleep 10` between checks; drop back to `sleep 1` only while `_stuck` is counting
(so detection latency stays within the 90 s budget — count seconds, not iterations, when
adjusting). One-line-ish change in `run_caspar()`; verify by re-running the WO-397 fork
capture (expect run.sh lines every ~10 s instead of 1 s) and by killing Caspar's AMCP
listener to confirm the hang path still trips within `CASPAR_HANG_SEC`.

Note: run.sh restarts CasparCG — changes take effect on the next Caspar (re)start, and this
file is on the box's live playout path. Change + verify in a quiet window.

## 3. What was VERIFIED

See WO-400 §5 — implemented together (same files, one deploy): `_poll` 10 s when AMCP is
listening, 1 s while a stall (or boot) is being counted, `_stuck` accumulates the interval
actually slept so `CASPAR_HANG_SEC` detection latency is ≤ budget + one 10 s window. Live after
`systemctl restart casparcg-server`: **5 run.sh forks in 32 s** (previously ~96), Caspar back
with 8 channels, AMCP reconnected.
