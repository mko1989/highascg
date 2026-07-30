# WO-400 — run.sh / supervisor-lib review: ~40 % of the lib is dead, the give-up path never fires

**Status: OPEN — review complete (the owner's ask); cleanup plan below staged for a quiet window together with WO-398**
**Source:** owner 30.07.26: "do a good review of the run.sh i fear there maybe a lot of unneeded code."
**Files:** `run.sh` (177 lines), `tools/runtime/casparcg-supervisor-lib.sh` (274 lines), `/etc/systemd/system/casparcg-server.service`, `tools/runtime/caspar-systemd-{control,cleanup}.sh`, `tools/runtime/caspar-kill-main.sh`.
**Related:** WO-398 (the 1 Hz `ss|grep` hang-detector poll — folds into this cleanup), WO-337 (operator fast-relaunch marker).

---

## 1. How it actually runs (verified live)

`casparcg-server.service` (systemd, `CASPAR_SYSTEMD_SERVICE=1`, `Restart=on-failure`/10 s,
`StartLimitBurst=8` per 300 s) → `run.sh` (its own infinite relaunch loop with inline crash
damping) → `casparcg`. That is **three stacked supervision layers** — and the lib contains a
fourth (`caspar_crash_loop_backoff`) that is **never called**.

## 2. Findings

### 2.1 Dead code (verified: zero callers anywhere in run.sh / tools/ / src/)

| symbol | lines | note |
|---|---|---|
| `caspar_crash_loop_backoff` | ~60 | The designed crash-loop policy: exponential backoff, hard-fail extra sleep, give-up → **writes the inhibit file**. Referenced ONLY by a run.sh comment that falsely claims it "still provides for real crashes". |
| `caspar_crash_is_hard_fail_code` | 7 | Only used by the dead backoff fn. Its hard-fail list (134/139/**136/11**) has drifted from run.sh's inline equivalent (`case 134\|139`) — two sources of truth, both partial. |
| `caspar_crash_state_file` | ~16 | Only the dead backoff fn writes this state. The unit still ships `Environment=CASPAR_CRASH_STATE=…`, and `caspar-systemd-control.sh` dutifully calls `caspar_crash_loop_reset` to reset a file nothing writes. |
| `caspar_prepare_restart_after_exit` | 7 | Zero refs. |
| `caspar_kill_main_processes` | 9 | Zero refs (`caspar_kill_all_processes` is what everything uses). |
| `caspar_supervisor_running` | 10 | Zero refs; its comment describes an Openbox-autostart world and a `tools/runtime/casparcg-run.sh` path — neither is how this box runs (systemd unit is the launcher). |

Plus dead env knobs riding along: `CASPAR_CRASH_LOOP_WINDOW_SEC/MAX/GIVEUP`,
`CASPAR_RESTART_SLEEP_MAX` (all read only inside the dead fn).

### 2.2 The behavioral gap the dead code hides (worse than hygiene)

run.sh's inline damping (`_restarts` ≥18 → `exit $ec`) is supposed to be the give-up. But under
systemd, a nonzero exit → `Restart=on-failure` relaunches run.sh 10 s later with a **fresh
`_restarts=0`** — the give-up is a 10 s pause, not a stop. And `StartLimitBurst=8/300 s` can
never trip on this path either: reaching 18 inline restarts takes > 300 s, so each systemd
restart lands in a fresh rate window. Net: **a permanently crashing Caspar loops forever** with
damping, and the designed terminal state (inhibit file → autostart stops, operator investigates)
is unreachable because the only function that writes it is dead. The node side and
`caspar-systemd-control.sh` still honor/clear the inhibit file — the mechanism is wired
everywhere except where it gets set.

### 2.3 Duplication / redundancy

1. **Two crash-damping engines** (inline `_restarts` block vs dead lib fn) — see above.
2. **Two stop routines:** run.sh `stop_caspar_if_running` ≈ lib `caspar_ensure_fully_stopped`
   (both TERM → 2 s → KILL; the lib one also waits the port free and is what the systemd
   cleanup + kill-main scripts use).
3. **Two grace sleeps per relaunch:** `caspar_wait_amcp_port_free` sleeps `CASPAR_RESTART_GRACE_SEC`
   at its end AND run.sh's loop sleeps the same grace right after — every relaunch pays 2+2 s on
   top of `CASPAR_RESTART_SLEEP` 5 s, and the WO-337 one-shot skip flag must be coordinated
   across BOTH files to work (`CASPAR_SKIP_GRACE_ONCE` set in run.sh, read in the lib — fragile).
4. **Two CEF-cache-clear triggers:** inline `case 134|139` in run.sh vs the dead
   `caspar_prepare_restart_after_exit` (which used the drifted 4-code list).
5. `pgrep -f "casparcg-server"` legacy-binary patterns next to `${CASPAR_BIN}` patterns — the
   box has shipped `bin/casparcg` for its whole history; harmless but doubles every pgrep.
6. The non-systemd `RESTART_CODES` branch (`137 143 130`) — unreachable on this box (unit always
   sets `CASPAR_SYSTEMD_SERVICE=1`); portability code, keep or cut consciously.

### 2.4 Constant-churn (WO-398, restated for completeness)

`run_caspar`'s hang detector runs `ss -tlnp | grep` + `sleep 1` every second forever
(~260 k forks/day) for a 90 s reaction budget. Also `-p` on that `ss` adds process-table cost
and is unused by the grep — `ss -tln` suffices.

## 3. Cleanup plan (staged — live Caspar restart path, do in a quiet window with WO-398)

1. Delete the six dead symbols + dead env knobs; drop `Environment=CASPAR_CRASH_STATE` from the
   unit (or keep and make it live per #2).
2. **Restore the give-up semantics** — pick ONE damping engine. Recommended: run.sh calls
   `caspar_crash_loop_backoff` (the richer, documented policy, single source of truth, writes
   the inhibit file at give-up) and the inline `_restarts` block is deleted. `Restart=on-failure`
   then only covers run.sh itself dying, which is what it should mean.
3. Unify stops: replace `stop_caspar_if_running` with `caspar_ensure_fully_stopped`.
4. One grace site: remove the trailing grace from `caspar_wait_amcp_port_free`; run.sh owns the
   grace and the WO-337 skip flag entirely.
5. WO-398: healthy-state hang poll every 10 s (seconds-accounted), 1 s only while a stall
   counts; `ss -tln`.
6. Verify: shellcheck both files; sandbox crash-loop rehearsal (`CASPAR_ROOT=$(mktemp -d)`,
   `CASPAR_BIN=/bin/false`, tiny sleeps via env) asserting backoff sleeps grow and the inhibit
   file appears at give-up; on-box quiet-window restart + `journalctl` watch; fork capture
   showing ~3 forks/10 s instead of 3/s.

Expected shrink: lib 274 → ~170 lines, run.sh 177 → ~150, minus three env knobs and one unit
line — and a crash loop that actually terminates in the designed inhibit state.

## 4. What was VERIFIED

- Review findings verified live (callers grepped across run.sh/tools/src; unit + launcher
  confirmed via systemd; PPID 1 → `casparcg-server.service` ExecStart). No changes applied yet.
