# WO-638 — On every boot: choose which screen is the operator's, the rest become destinations

**Area:** os-iso, devices-config
**Status: DONE (2026-10-21) — offline 3096/0 incl. new smoke (19 cases), Godot --test 20621/0 + --check; box: three simulated boots (Caspar stopped, outputs stacked at 0,0, this boot's record cleared, node + Caspar restarted): prompts on both screens with Caspar held, owner clicked DP-0 (Caspar released after 31 s, PGM on DP-4, client on DP-0); API pick DP-4 moved the PGM cable gpu_p2→gpu_p0 and wrote casparcg.config before Caspar's first start; DP-0 restored the same way. A real power-cycle boot is owner QA. Parent: [WO-609](./609_WO_godot_cutover_packaging_kiosk_decommission.md) (Godot cutover). Builds on [WO-290](./deprecated/290_WO_FRESH_SYSTEM_MONITOR_PICKER.md) / [WO-599](./599_WO_godot_client_foundation.md) T4 (the picker), [WO-412](./412_WO_SYNC_TICK_DRIVES_CASPAR_AND_OPGUI_CABLE_IMPLIES_MONITOR.md) (cable ⇒ flags).**

Owner, 21.10: *"we need to figure out a good way to start the system. meaning how to on a fresh boot with different
gpu outputs than last time choose which screen should be the operator which a destination."* Then: *"id like there to
be a popup choose this monitor as operator for 120s on each screen."* Then: *"this needs to either be able to display
over screen consumers that are always on top enabled or delay the start of casparcg till that moment."*

## Investigation

**Live on the box, 21.10 19:04 boot.** Two identical monitors (EDID `NOV P80`, the same serial `16843009` on both) on
DP-0 (gpu_p0) and DP-4 (gpu_p2). The saved state wired the operator to gpu_p1 (DP-2/3) and PGM to gpu_p3 (DP-6/7):
`config/device_graph.json` edges, `casparServer.screen_2_operator_monitor`. Both saved jacks were dark. Journal:

```
[startup] gpu physical mapping: gpu_p0:DP-0/DP-1=>DP-0(up) | gpu_p1:DP-2/DP-3=>-(down) | gpu_p2:DP-4/DP-5=>DP-4(up) | gpu_p3:DP-6/DP-7=>-(down)
[OS-Config] Layout screen_1: id=DP-0 … pos=0,0
[OS-Config] Layout operator_gui_1: id=DP-0 … pos=1920,0
[OS-Watchdog] mismatch DP-0+DP-4 overlap: expected=unique positions actual=0,0
[OS-Watchdog] Layout still wrong after 12 attempts — operator may need Apply OS
```

So PGM and the operator both fell back to the first lit output (DP-0). DP-4 was never placed; X left it mirrored at
0,0. Caspar's always-on-top PGM window and the Godot client shared DP-0.

How the choice works today (survey, file:line):
- The choice is **positional**: `casparServer.screen_N_operator_monitor` (N = GPU slot + 1) plus the device-graph cable
  `dst_in_<operator dest> → gpu_pN`. No EDID or connector identity is checked. Identical EDIDs, as on this box, make
  EDID useless as a key anyway. `src/utils/operator-monitor-resolve.js:40-150` uses the flag as-is, even when its jack
  is dark.
- Boot X layout = a static replay of `~/.config/highascg/apply-layout.sh`, written only on Apply
  (`src/utils/os-config-persist.js`). `src/bootstrap/os-layout-watchdog.js` can only re-apply the same stale plan.
- casparcg.config screen consumers are regenerated only on Apply (`src/api/routes-caspar-config.js`).
- The WO-290 picker (`src/system/operator-monitor-picker.js`) is unreachable under the native client:
  `shouldAutoLaunchOperatorGui` returns `native_client_shm` first, and it also refuses once any flag is set. The WO-599 T4
  Godot picker (`godot/client/app/operator_screen_picker.gd`) auto-opens only on a fresh box with no `--screen`, but the
  interim autostart (WO-609) passes `--screen=0`. Mirrored outputs also break its origin-based screen→output match.
- Caspar starts from `casparcg-server.service` → `run.sh` as soon as X is up, so its always-on-top screen consumers
  are mapped before any prompt could be shown.

## What was done

**`src/system/boot-screen-assignment.js` (new).** The question is asked once per kernel boot id (stored in
persistence `bootScreenAssignment`), and only when two or more GPU jacks are lit. `operatorTools.bootScreenPicker:
false` turns it off.
- `prepare`: if outputs overlap (X's default for unplanned heads), lay them out left to right in slot order
  (`xrandr --auto --right-of`). This gives every screen its own prompt. It then invalidates the xrandr cache; a stale
  cache made the full apply think the canvas was still 1920 wide and restart nodm (box, 19:26).
- `resolve(name | default)`: the default is the saved operator jack if it is lit, otherwise the first lit jack that no
  destination keeps. The operator choice is WO-290's `applyOperatorMonitorChoice` (flag + cable).
  `planDestinationCables` groups destination cables by jack. A cable on a lit jack that isn't the operator's stays. A
  cable on a dark jack, or on the operator's jack, moves to the next free lit jack (PGM + PRV move together, and edge
  properties ride along). The plan is computed on the **original** cables, because `applyOperatorMonitorChoice` drops
  any cable on the picked jack ("one monitor, one jack"). Planning after it deleted the PGM cable when the operator
  took PGM's jack (box, 19:32 — caught on the box, regression test added).
- X is always laid out per the plan **before** the answer returns, even when nothing moved; the prepare spread need
  not match the plan (box, 19:29: "nothing changed" skipped the layout, so PGM opened on the operator monitor).
  - While Caspar is held: write casparcg.config + live layout (no restart).
  - If Caspar is already up (gate timed out, or it started before this code): layout, then the normal full apply in
    the background, only when cables moved.
- **Caspar start gate.** `run.sh` holds the first launch of a boot until `~/.highascg/run/caspar-screens-ready` holds
  this boot's id. Node writes the file immediately when there is nothing to ask, otherwise after the answer is laid
  out. `CASPAR_SCREEN_GATE_SEC` (default 240, 0 = off) is the backstop; relaunches never wait. Node takes the default
  itself after 200 s if no client answers (Godot not running). Owner's choice of the two options: delay Caspar rather
  than fight always-on-top stacking. Its consumers also come up on the final layout, with no restart.
- `index.js`: `startBootScreenGate` at start-up. The OS layout watchdog sits out a boot that asks, since it can only
  replay the stale plan.
- `src/api/routes-operator-screen.js`: GET carries `boot { pending, defaultName, timeoutS }`. POST
  `{boot:'prepare'}` / `{boot:'resolve', name?, how?}`, where `how` = now | timeout (logged: clicked / default_now /
  timeout / server_fallback).

**Godot client.** `operator_screen_picker.gd` `open_boot()`:
- calls prepare, then shows one prompt per screen with a live countdown ("DP-0 becomes the operator screen in 111 s");
- Esc / "Use DP-0 now" takes the default immediately; the timer takes it at 120 s;
- after the answer it re-reads the outputs and moves onto the operator screen **by output name**, because the layout
  may have moved the screen indices.

`main.gd` `_screen_question` asks even when `--screen` is given (the server decides when). The plain fresh-box prompt
stays as before.

**Autostart.** `scripts/setup/09-openbox-autostart.sh` and the box's `~/.config/openbox/autostart` dropped
`--screen=0`, so the client follows the server's operator monitor.

Not done / alternatives rejected:
- EDID-keyed memory of "which monitor was the operator": identical EDIDs on this box, and the owner asked for an
  explicit choice every boot.
- Override-redirect prompts over Caspar: Godot popup windows close on outside clicks, and stacking against
  always-on-top windows is WM-dependent.

## What was VERIFIED

- Offline: `tools/smoke/smoke-wo638-boot-screen-assignment.test.js` 19/19 (the PGM-on-picked-jack case fails with
  the old ordering; checked by reverting the line). Full offline suite 3096/0; line limit 0 over; eslint 0 errors
  (216 warnings, unchanged); prettier tools/ci clean. Godot `--test` 20621/0, `--check` boot OK.
- Box, simulated boot 1 (19:31; Caspar stopped, outputs stacked, record + gate cleared, node and Caspar restarted,
  client relaunched):
  - `/tmp/caspar.log`: `waiting for the boot screen choice … up to 240s`.
  - Screenshot: one prompt on each monitor, countdown running, no Caspar window.
  - The owner clicked DP-0: `config + layout written before Caspar starts` → `Caspar start released` →
    `run.sh … released after 31s`.
  - xrandr: DP-4 0,0 (PGM), DP-0 +1920 (operator). Client window at x 1922. Screenshot: PGM test card on DP-4, GUI on
    DP-0.
- Box, simulated boot 2 (19:33, API): pick DP-4 → `moves gpu_p2→gpu_p0`. casparcg.config written with the PGM screen
  consumer before Caspar started (released after 8 s). xrandr: DP-0 0,0 (PGM), DP-4 +1920.
- Box, simulated boot 3 (19:34): pick DP-0 → `moves gpu_p0→gpu_p2`, back to the owner's layout. A client launched
  with no `--screen` placed itself on DP-0.
- Earlier failures on the way, all fixed above:
  - 19:26: nodm restart from the stale xrandr cache. It killed the session's Godot; Openbox relaunched it.
  - 19:29: the spread was left in place, putting PGM on the operator monitor.
  - 19:32: the PGM cable was dropped. The owner's cables were restored by hand while node was down, before test 2.
- **Owner QA:** a real power-cycle boot (Openbox autostart → client → prompts → Caspar start), and the 120 s
  unattended timeout path. The timeout is unit-tested and the server fallback is in place, but both live answers came
  from clicks.

## Follow-up 21.10 (evening): client landed on the PGM screen

A relaunch without `--screen` put the client on DP-4 (PGM). `GET /api/system/operator-display` answered from the
layout plan, `DP-0 @ 0,0`, re-planned after the PGM cable was removed at 19:45 and never applied. X still had DP-4
at 0,0 and DP-0 at +1920. `main.gd` matched the screen by position. It now first moves the rect to the live place
of its `sysId` output, taken from `/api/system/operator-screen` outputs (`window_placement.gd` `live_rect`;
`tests/test_window_placement.gd` `test_live_rect`). Box: after relaunch, the window is at 1922,32 (DP-0).
