# WO-919 — WO-918 follow-ups: the findings the 01.11 fix round left open

**Area:** godot-client, engine, devices-config, mapping
**Status: OPEN**

Owner, 01.11.26 (after the WO-918 re-test): "Continue. Add work orders for this."

Parent: [WO-918](./918_WO_gui_project_and_destination_test_sweep.md). Each item's reproduction and evidence is in WO-918
under the same number; it is not repeated here.

## Investigation (from WO-918 and its re-test)

- **F2** Devices "Server ▾" compare says "matches" while its "Module expects" column shows the RUNNING layout, not the
  loaded project's.
- **F4** Loading an old project whose PGM1 is cabled to a down output (frontex → DP-2), then Apply: nodm restarts the
  whole :0 session, xrandr fails, Caspar's 5760x1728 window buries the GUI, the old operator destination's
  `videoOutput=screen` opens a screen consumer on DP-4, and a header Load gives no hardware-mismatch warning
  (`hardware_reconcile.gd` only runs on boot/reconnect).
- **F6** Load (and Apply) re-stamp `savedAt`, so the Load list's "Saved" column stops meaning "last edited".
- **F11** New project leaves the old show on air (PRV ch3 keeps playing); Visuals "Send" re-sends to 2-1 after New
  project and after Caspar restarts.
- **F13** A stale "Live audio input 1 · HOST · ch 7" card stays in Devices after New project.
- **F20** Connected but uncabled outputs keep their old xrandr position: after Apply DP-6 overlapped DP-0 (+1920+0).
  On this box DP-6 is the second operator monitor — [WO-920](./920_WO_operator_gui_second_monitor_dot.md) gives it a
  cable; the general rule for any uncabled head is still open here.
- **F26** After a node restart in the F20 overlap, OS-Watchdog retries xrandr 12× in ~15 s, then logs "Layout still
  wrong … operator may need Apply OS" — journal only, the GUI shows nothing.
- **N1** The header notice is clipped at 200 px; the restart / switched / name-taken texts are only readable in the
  tooltip.
- **N2** A destination edit made just before another client switches shows is never stamped into the old show (its
  autosave is correctly refused as `not_active`), so loading that show later brings the removed destination back.
  Decision needed: write a stale client's last edit into ITS show's file (rev-checked) instead of dropping it.
- **N3** Live-thumbnail PRINT frames (`media/2026…T….png`) appear in the Sources media list while they exist.
- **N4** Trash entries duplicate between `~/bridge/projects/_trash` and `projects/_trash` (a rename left two
  `untitled_2-*` dirs in each), and the `-replaced` backups replicate to the bridge.
- **N5** A rename leaves the old, empty `media/projects/<old slug>/` folder.
- The web client still uses the legacy autosave path (no `editingSlug`) and does not follow `project.activated`.

## What was done

Nothing yet.

## What was verified

Nothing yet.
