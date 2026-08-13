# WO-508 — Single-instance safeguards for CasparCG: audit + the missing guard

**Status: DONE in repo (13.08.2026 — 4 smokes, suite 2078/2076/0). NOT deployed. Live instance count on .37 NOT verified — see §4.**
**Priority:** High (two mains = card/port contention = restart loop)
**Source:** owner `todos13.08.26`: *"i want you to double and triple check if there is only one instance of caspar running and there are appropriete safeguards for ensuring only one runs at a time (counting subprocesses of course)."*
**Related:** [WO-400](./400_WO_RUNSH_SUPERVISOR_REVIEW.md), [WO-398](./398_WO_runsh_fork_loop.md), [WO-407](./407_WO_SCREEN_CONSUMER_MICRO_STUTTER.md) (the pgrep self-match false alarm — measured again here, §3), [WO-507](./507_WO_DECKLINK_OUTPUT_ON_AN_INPUT_CARD_RESTART_LOOP.md) (the other restart-loop cause found the same day).

## 1. Audit — what already protects us

| layer | mechanism | verdict |
|---|---|---|
| second `run.sh` | `exec 9>>/tmp/caspar-runsh.lock; flock -n 9 \|\| exit 0` | ✅ solid |
| service stop kills children | `KillMode=control-group` on `casparcg-server.service` | ✅ |
| autostart suppression | `/run/highascg/inhibit-caspar-autostart` | ✅ |
| CEF children distinguished | `caspar_is_cef_child` (`--type=` marker), `caspar_list_main_pids` vs `caspar_list_all_pids` | ✅ the "counting subprocesses" part is already right |
| **a second casparcg BINARY** | **nothing** | ❌ **the hole** |

`run_caspar()` launched `"$CASPAR_BIN" "$CONFIG_PATH" &` with **no check for an existing main**. The
flock guards the supervisor, not the binary. A caspar started outside run.sh — by hand, or surviving
a previous boot — was never noticed, and a second main was started alongside it. Two mains fight for
AMCP `:5250`, the DeckLink cards and the screen consumers; the loser exits non-zero and the unit
restart-loops.

## 2. The guard

In `run_caspar()`, before launching: enumerate mains, and refuse if one exists.

- **Waits up to 5 s first** (100 ms poll). On a supervisor relaunch the pid we see is usually our own
  just-exited child still being reaped; refusing on that would break every legitimate restart.
- **Refuses rather than kills** — `exit 3`, logged. The other process may be the one currently ON
  AIR, and killing it automatically to replace it is not a decision a boot script should take. Exit
  3 lets systemd back off (`RestartSec=10`) with the reason in the journal.

## 3. The false positive this nearly shipped with — measured, not theorised

First cut used `caspar_list_main_pids` directly. Run live on this box it returned **five** mains
where only one existed:

```
mains: 252449 252469 252470 252472 4059273     ← only 4059273 is real
```

`caspar_is_main_process` matches on the **command line** (`*$CASPAR_BIN*$CONFIG_PATH*`), so any
process whose argv merely mentions both paths is counted — in this case the very shell running the
audit. That is WO-407's self-match false alarm, reproduced. Pattern matching is fine for a kill
sweep; it is **not** good enough to refuse a launch on, because a false positive leaves the box dark.

Hardened: every candidate is confirmed via `/proc/<pid>/exe`, and `$$` is skipped.

```
/proc/4059273/exe -> /home/casparcg/highascg/bin/casparcg   ← real
/proc/<shell>/exe -> /usr/bin/bash                          ← rejected
```

`caspar_list_main_pids` itself was left alone: its other callers are kill sweeps, where
over-matching is the safe direction.

## 4. What was VERIFIED, and what was NOT

Verified: `sh -n` clean; 4 smokes pin the guard's existence, the wait-before-refuse, the `/proc/exe`
confirmation + self-skip, and that CEF children still cannot trip it. Gate **2078/2076/0**.

**NOT verified — the owner's literal question.** *"Is only one instance running right now"* on
**192.168.0.37** could not be answered: SSH is key-denied from here and the HTTP API reports a single
caspar pid without a count. On **this** box (.30) the audit found exactly one real main. Run on .37:

```bash
pgrep -af casparcg | grep -v -- --type=      # mains only; expect exactly ONE
pgrep -af casparcg | grep -c -- --type=      # CEF children; several is normal
```

If more than one main appears, that is the bug this WO guards against and the second is safe to kill.

## 5. Work log

- 2026-08-13 — Audited the existing layers, found the missing binary-level guard, implemented it,
  caught and fixed a self-match false positive by measurement before shipping.
