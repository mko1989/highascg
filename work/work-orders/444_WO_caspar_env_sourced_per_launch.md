# WO-444 — caspar-env sourced once at supervisor start; Apply-time changes never reached Caspar

**Status: DONE (2026-08-06 — suite 1865/0/2; run.sh replaced atomically. ONE owner command arms it: `sudo systemctl restart casparcg-server` — after that every Apply works)**

Owner: "how can i check if the gl sync is applied?" — checked live, and it was NOT, despite
the owner's 14:03 Apply doing everything WO-440 promised.

## Investigation (live evidence)

- `~/.config/highascg/caspar-env` written **14:03:23** with `CASPAR_GL_SYNC_DISPLAY=DP-0`
  (the WO-439 tick resolution — the Apply pipeline worked).
- Caspar relaunched **14:03:29** (the WO-440 forced restart worked).
- The new caspar process env: **no `__GL_SYNC_DISPLAY_DEVICE`**. The supervisor
  (`run.sh`, `casparcg-server.service` MainPID, up since 09:49) sources caspar-env ONCE at
  script top — 09:49, when the file had no var — and `run_caspar()` respawns the binary
  inside that stale environment. WO-407's "read at caspar launch" was actually
  "read at SUPERVISOR launch"; every env-only change was one service-restart behind.

## What was done

- `run.sh`: sourcing moved into a `source_caspar_env()` helper called **inside
  `run_caspar()`** (per launch) and once at startup. It `unset`s `CASPAR_GL_SYNC_DISPLAY`
  before sourcing (shell vars persist across sourcing — a line REMOVED from the file must
  also clear the export) and unsets `__GL_SYNC_DISPLAY_DEVICE` when the file sets nothing
  (auto=off must actually turn it off).
- Replaced via `cp` → edit copy → `sh -n` → `mv -f` (atomic rename): the RUNNING supervisor
  keeps executing its already-parsed old inode; in-place editing a live shell script risks
  the interpreter re-reading shifted offsets.
- Smoke `tools/smoke/smoke-wo444-caspar-env-per-launch.test.js` (curated list): run_caspar
  sources per launch; clear-before-source and clear-on-absent semantics pinned.

## Verified

- Suite **1867 tests, 1865 pass, 0 fail, 2 skip**; `sh -n` clean.
- NOT yet live: the running supervisor still executes the pre-fix code (parsed at 09:49).
  Session permission layer blocked `sudo systemctl restart casparcg-server` — **owner runs
  it once**; verify with:
  `tr '\0' '\n' < /proc/$(pgrep -f 'bin/casparcg /home' | head -1)/environ | grep GL_SYNC`
  → expect `__GL_SYNC_DISPLAY_DEVICE=DP-0`. From then on, every Apply's caspar restart
  picks up env changes with no service restart.

## Relationship

Completes the WO-407 → WO-439 → WO-440 chain: tick resolution fixed (439), Apply always
restarts (440), and now the restart actually carries the env (444).
