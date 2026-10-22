# WO-676 — Godot client crashes on every quit (glibc "corrupted size vs. prev_size in fastbins")

**Status: DONE (22.10, root cause found by bisect, box: 3 headless + 1 windowed quit clean, was 100 % crash)**

Found 22.10 while testing WO-670 P3b. The client restart (`OS.set_restart_on_exit` + `quit()`) never restarted: the old
process died on its way out, so the restart that the engine runs after a clean shutdown never happened. This also hit
the A/B host switch (WO-608, `app/connection_menu.gd`), which uses the same restart.

## Investigation

- Every quit crashes. `godot --path godot/client --quit-after 300 --` prints
  `corrupted size vs. prev_size in fastbins`, dumps core and exits 134.
- It is not the new code: it reproduced with `app/cluster_follow.gd` commented out, with and without `--tab=4`.
- It is not rendering, the display server or accessibility:
  - it crashes with `--headless` too;
  - it crashes with `--accessibility disabled`;
  - with `--verbose`, the last lines are `Accessibility: window 1 adapter destroyed.` and then the abort.
- Engine: Godot 4.7.2.stable.official.ed1daf0bf.
- The project's one GDExtension is `addons/hshm/hshm.gdextension` (the shm video surfaces), so it was the first
  suspect. **It is cleared:** the crash stays with the extension unloaded (`.gdextension` moved away and
  `.godot/extension_list.cfg` emptied for one run, both restored).
- gdb (owner installed it 22.10): the abort is in `free()` → `malloc_consolidate` from Godot's teardown
  (`__libc_start_call_main` → stripped engine frames). That is where the damage is found, not where it is done, so
  the backtrace alone does not name the culprit. Bisect instead, with a temporary probe scene that adds one class
  (`load(path).new()`), quitting headless after 30 frames:
  - autoloads alone and an empty scene: clean;
  - `app/shell.gd`: crash. Of its 17 parts, only `features/devices/devices_tab.gd` crashes;
  - none of the Devices tab's 17 parts crash alone, so it is something its `_ready` wires.
- **Root cause.** `devices_tab.gd:215` registered a lambda (it captures the tab) in
  `ClientPrefs._listeners`. That is a `static var` Array of Callables in `core/client_prefs.gd:14`, and it was never
  removed. At quit, the tab is freed first; the static array, freed later with the script, still holds the bound
  callable, and that heap corruption aborts the exit. With the `listen` call disabled, the full client quit cleanly 2/2
  (was 100 % crash).
- Only one other static holder of Callables exists: `features/live/look_thumb.gd:11` `_waiters`. It is transient (it
  empties when a thumbnail fetch ends), so a quit during a fetch is the only window. Left as is.
- Effect while running: none seen. The GUI works until it quits. The crash costs only what runs after quit: the engine's
  restart-on-exit, and anything saved in `_exit_tree` / `NOTIFICATION_WM_CLOSE_REQUEST` after the corruption point.

## What was done

- `core/client_prefs.gd`: `unlisten(fn)`, plus a note on `listen()` that a node-bound listener must unlisten when its
  node leaves the tree.
- `features/devices/devices_tab.gd`: keeps its listener and unlistens on `tree_exiting`.
- `app/connection_menu.gd` `restart()`: starts the new client with `OS.create_process()` BEFORE `quit()`, and falls back
  to `set_restart_on_exit` only when the spawn fails. Used by the A/B switch and by WO-670 P3b's follow.

## What was VERIFIED

- After the fix:
  - `--headless --quit-after 100`: clean 3/3 (before: crash every run, from 2 frames on);
  - windowed with `--tab=4` (Devices built and shown) `--quit-after 300`: clean;
  - Godot 20923/0, `--check` OK.
- Box, 22.10, WO-670 P3b test:
  - with the old restart, the master follow wrote the new origin, then crashed, and no new process came up;
  - with the spawn-first restart, a new process came up each time (12:09:21 to the stub, 12:09:33 back), while the old
    one still crashed on its way out.

## Next

- Nothing open. The spawn-first restart stays: it was box-tested with WO-670 P3b, and an exit crash can never cost a
  restart again.
