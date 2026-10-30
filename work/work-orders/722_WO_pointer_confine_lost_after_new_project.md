# WO-722 — Pointer confine is lost after a New project and never comes back

**Area:** devices-config, os-iso
**Status: DONE (24.10.26: offline smokes + live on .4 after release 212858Z — confine starts on the restart and an
unrelated save leaves it alone) — replaying the New-project sequence itself = owner QA (this box after its server
restart, or .4).**

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

### Root cause (24.10 evening, journal 07:55:08–07:55:20, confirmed)

- **There was only one recycle, and it saw the wrong config.**
  - New project saved the config once, at `.550` (applyHardwareConfigToCtx → `cm.save`). `emit('change')` is
    synchronous, so index.js's listener (`index.js` `configManager.on('change')`) ran the subsystem recycle and
    `syncOperatorPointerConfine` against `new_project_1`'s hardware config: `Layout plan: no assigned outputs` →
    `No operator monitor rect — not started`.
  - `.608` "Loaded hardware configuration" is that same apply returning, not a later config.
- **That sync killed the helper.** `syncOperatorPointerConfine` does `if (!r.ok) stopPointerConfine()`, and
  `stopBarrierProc` runs `pkill -f confine-pointer-barriers.py` without logging. That is what ended helper 570675 with
  no `stopping` / `SKIP` line, which answers the open question above.
- **Nothing looked again.** Two project loads followed: `untitled` at 07:55:15, then `godot_test` at 07:55:20, which
  has the operator cable. Each logged `Applied file change; subsystem recycle skipped (… signature unchanged)`, and
  that branch of the listener returns before the confine sync. The 8 s watchdog was stopped by the same
  `stopPointerConfine`, so the box stayed unconfined until the next restart.
- **Today's restarts (19:14, 20:09, 20:30) re-confined it at boot:** `RUN — operator_monitor_port_3`, barriers on
  DP-5. So the box is confined now, but the bug is in the code.

## What was done

- **`src/system/pointer-confine.js`:**
  - `syncOperatorPointerConfine` records the verdict it acted on (`lastSyncKey`: reason, or '' when not wanted),
    whether its start is still running, and whether that start failed.
  - A start that fails with `no_operator_monitor` retries up to 3 times, 3 s apart (`noRectRetriesLeft`). This covers
    a reload caught mid-way when no further config change comes.
  - New `confineResyncNeeded(verdict, lastKey, lastFailed)` (pure) and `resyncPointerConfineIfNeeded(config, opts)`.
    It re-syncs only when the wanted verdict changed, or when confine is wanted and the last sync failed to start it.
    Otherwise it is X-free: a sync recomputes the layout through xrandr, which freezes X input for about 180 ms
    (WO-397), and most config saves have nothing to do with confine. A deliberate stop (the WO-638 operator-monitor
    prompt releases confine) does not count as failed, so a save during the prompt does not re-confine.
- **`index.js`:** the "recycle skipped" branch calls `resyncPointerConfineIfNeeded` before it returns (one line,
  marked WO-722).
- **Not changed:** the reload sync still stops a running helper when there is no rect. Holding a fence on a rect that
  no longer resolves is the failure mode WO-308 / e2ab1a8 fixed. The retry and the resync bring it back within
  seconds.

## What was VERIFIED

- `tools/smoke/smoke-wo722-confine-resync.test.js` (new, in FILES), 4 tests:
  - the 07:55 sequence as verdicts: a failed reload sync → the next skipped-recycle save re-syncs; a running confine →
    an unrelated save does nothing; verdict changes → sync;
  - the index.js hook sits between the skip log and its return;
  - the bounded retry is pinned;
  - under `node --test` the resync runs nothing (WO-720).
- With the existing confine smokes (WO-720, WO-397, WO-308, geometry-follow): 28/28.
- Gates: see the commit. Live: pending (below).
- **Live on .4** (release 212858Z installed from .4's kiosk at 23:35, WO-735):
  - The restart: `[Pointer confine] RUN — operator_monitor_port_2`, then `XFixes barriers on HDMI-0 @ 0,0 1920x1080`.
    The helper `confine-pointer-barriers.py HDMI-0` was running (PID 137779).
  - An unrelated save, twice (Settings → Defaults → Loop always on, then off). 23:35:53: `subsystem recycle skipped`
    and **no** confine line; the helper was still PID 137779. The resync stays quiet when nothing changed and the
    last start worked.
  - The first of those saves (23:35:50) took the full reload path, which was a separate bug, now
    [WO-747](./747_WO_first_save_after_boot_recycles_everything.md). Its confine sync was a no-op too (same helper PID).
- Not replayed live: New project (no operator cable) → load a project with the cable. That is the path the fix
  changes. Its logic is the smoke's first case; seeing it on the box = owner QA. It would replace the show on either
  box.
