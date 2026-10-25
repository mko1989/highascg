# WO-750 — In Devices the top bar's connection eyes are gone (the tab was wider than the screen)

**Status: DONE (25.10.26 — live on this box's kiosk: Devices tab fits 1920 px, clock + both eyes visible, the Inspector whole; Godot 21656/0, boot check OK.)**

Owner, 25.10: *"in devices there are no connection eyes... in the top bar right side"*

## Investigation

- Kiosk screenshot, Devices tab (this box, 09:20):
  - the top bar ends after FTB; the clock, the activity icon and both eyes are missing;
  - the Inspector is cut at the right edge ("Sele…", "Save pr…", "Enable GPU in CEF te…").
  - On the Live tab the same window shows all of them.
- So in the Devices tab the window content was wider than the screen and everything at the right edge was
  pushed off, the top bar's right end included.
- Measured on the screenshot:
  - the center column ran 295 → 1750 px (1455). On Live it ends at 1536 (1241).
  - Devices has three columns: destinations ≈ 275, mapping nodes ≈ 195, rear panel + servers ≈ 870.
  - The widest thing in the right column was the servers controls row (`cluster_panel.gd` `_build_master_row`,
    an `HBoxContainer`): Auto failover · This client follows the master · Linked servers may press here ·
    Share the show · Make this server master = 869 px, exactly the column's width. The rear panel stretches to it.
- WO-746 added "Share the show" (≈ 135 px) to that row on 25.10. Without it the row is ≈ 735 px, still about
  80 px too wide, which is enough to push the eyes (the last 60 px of the bar) off. So the row made the overflow,
  and WO-746 made it worse.

## What was done

- `godot/client/features/devices/cluster_panel.gd`: the controls row is an `HFlowContainer`: same controls, same
  order; it wraps onto a second line when the column is narrow.
  - Why not shorten labels or drop a control: the labels say what each one does (minimalism is fewer things, not
    cryptic ones), and a flow row stops this row from ever setting the tab's width again, whatever is added to it.

## What was VERIFIED

- Live, this box's kiosk restarted on the change (WO-730 way), Devices tab at 09:27:
  - the top bar shows the clock (09:27:58), the activity icon and both eyes;
  - the Inspector is whole ("Select an item");
  - the servers row wraps after "Linked servers may press here".
- Godot 21656 passed / 0 failed; `run-client.sh --check` boot OK.
- .4's kiosk gets the change with the next release.
