# WO-722 — Pointer confine is lost after a New project and never comes back

**Status: OPEN (24.10.26). The investigation is from the live journal; nothing is changed yet. The owner decides
whether to restore confine on the running box (a server restart re-runs it).**

Found while working WO-721. Nobody reported it; the mouse is simply no longer held on the operator monitor.

## Investigation

- **The box right now (08:45 UTC):**
  - No `confine-pointer-barriers.py` is running. The last helper is PID 570675, started 23.10 22:14:13; the pid file
    and the helper log are untouched since then.
  - The helper never logged "Pointer confine released", so it did not exit on its own.
  - The config is correct for confine:
    - `caspar_server.json` `screen_3_operator_monitor: true`
    - `screen_destinations.json` has `dst_operator_gui` (operator_gui)
    - `device_graph.json` edge `dst_in_dst_operator_gui → gpu_p2` (port 3 — WO-718 kept the cable)
    - DP-3 is connected (sysfs).
- **What happened: a New project at 24.10 07:55:08 on the live server** (PID 457387, started 23.10 19:51, so it
  includes WO-718). The journal, in order:
  - `.550` `[Config] Saved modular config` → `Reloading subsystems...`
  - `.605` `[OS-Config] Layout plan: no assigned outputs`
  - `.606` `[Pointer confine] No operator monitor rect — not started`
  - `.608` `[project] Loaded hardware configuration (v2)` — the graph WITH the operator cable arrives only now
  - `.615` `[project] activated new_project_1`
- **Hypothesis (to prove before fixing):**
  - Confine is re-evaluated during the subsystem reload, from the config BEFORE the project's hardware configuration
    is applied. At that moment the layout plan has no outputs, so there is no rect.
  - In that branch `startPointerConfine` (`src/system/pointer-confine.js`, the `if (!rect)` early return) neither
    restarts nor starts the 8 s watchdog.
  - Nothing re-runs confine after `.608`, so the box stays unconfined until the next server restart, even though the
    final config wants confine on port 3.
  - Still unexplained: what ended helper 570675. No `RUN` / `stopping` line was logged, and an operator-monitor-off
    verdict would have logged `SKIP` before `stopPointerConfine`. Candidates: the reload's display-session apply
    (`x-display-session-runtime.js` `buildConfineCursorShellLines` pkills in its not-desired branch), or the New
    project path.
- **Next step:** reproduce in the WO-719 sandbox. Pointer confine is gated off there, so the test has to assert on
  the sequence of `syncOperatorPointerConfine` calls / verdicts during New project, not on a real helper. Then
  re-evaluate confine once the project's hardware config is applied.

## What was done

## What was VERIFIED
