# WO-924 — "Start operator here" started the GUI on another screen (the launcher read a stale boot xrandr snapshot)

**Area:** os-iso, godot-client
**Status: DONE (02.11.26 — root cause from Xorg.0.log + boot snapshot; smoke 20/20; the live boot path runs at the next boot)**

Owner, 02.11.26: "ive clicked start operator here and it started on another screen..."

## Investigation

- The box booted 01.11 18:20 with the start-up launcher (WO-645, `startup.mode ask`). It waited all night;
  run.sh: `boot screen gate: released after 46939s` (02.11 07:27:11).
- Node recorded the click as **DP-6** (`.highascg-state.json` `bootScreenAssignment`: `name DP-6, port 4, how clicked`),
  laid X out with DP-6 at 0,0 (`DP-0 is not in the plan and overlaps it — moved +0+0 → +7680+0`), and the Godot
  window went to DP-6 at 0,0. Everything after the click did what it was asked to do. The **name the click carried** was wrong.
- `/var/log/Xorg.0.log` shows the X layout during the whole question (from ~18:20:19 until the click at 47230 s):
  `DP-6 … +0+0, DP-0: 1920x1080_50 … +0+0, DP-4 … +5760+0`. **DP-0 and DP-6 were stacked at 0,0.**
- The WO-638 step `prepare` (`src/system/boot-screen-assignment.js`) exists to spread such stacked heads before the
  prompts open, but the journal has no `[Boot screens] stacked outputs …` line. So it did not detect an overlap.
- Cause: `prepare` read the outputs through the cached xrandr probe (`hardware-info-xrandr.js`). Node's first probe at
  18:20:09 failed (X not up yet). A failure caches for the 30 s `XRANDR_FAILURE_BACKOFF_MS` and returns the **boot snapshot**
  `data/runtime/boot-xrandr-query.txt`, captured 18:20:16 (mid-modeset): `DP-6 +0+0`, `DP-0 3840x1792+1920+0`,
  `DP-4 +5760+0`. That snapshot has no overlap (`outputsOverlap` → false; true for the real X layout, checked on the box).
  Godot asked at ~18:20:30, inside the backoff.
- Consequence in the client (`operator_screen_picker.gd` → `operator_screen_model.gd` `match_outputs`): matching is by
  screen position. Both Godot screens at 0,0 matched the output the server placed at 0,0, which was **DP-6**. Two prompts
  were stacked in the same place, mirrored on the DP-0 and DP-6 displays, and both were labelled DP-6. A "Start operator
  here" click on the DP-0 display therefore resolved DP-6.

## What was done

- `src/system/boot-screen-assignment.js` `prepare()`: calls `d.invalidate()` (clears the xrandr cache, the failure backoff
  and the EDID cache) **before** `listOutputs`. The read is then live X. The client's `GET` right after prepare
  rides that fresh cache, so the prompt labels match the real layout too. The fix stays in prepare, not in the
  2 s `_watch` GET path, because that path is polled and must stay cached (WO-397).
- `tools/smoke/smoke-wo638-boot-screen-assignment.test.js`: the spread case now counts 2 invalidates (before the read and
  after the spread). A new case pins the order `invalidate → list`.

## What was verified

- `node --test tools/smoke/smoke-wo638-boot-screen-assignment.test.js`: 20/20 pass. `check-max-file-lines`: 0 over 500.
- On the box: `outputsOverlap` is true for the X layout at 01.11 18:20 and false for the boot snapshot (the measured failure).
- Not re-run live: making the bug happen again needs a real boot (X still mid-modeset when node starts). Stacking heads
  by hand would not reproduce the stale cache. The next boot exercises the path. If prepare spreads, the journal shows
  `[Boot screens] stacked outputs laid out left to right: …`.
- To fix today's placement, the owner re-picks the screen with "Make this the operator screen" (Settings). X is spread
  now, so that picker labels every screen correctly.
