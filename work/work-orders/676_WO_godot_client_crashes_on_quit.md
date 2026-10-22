# WO-676 — Godot client crashes on every quit (glibc "corrupted size vs. prev_size in fastbins")

**Status: OPEN — worked around for restarts (WO-670 P3b: the new process starts before the old one quits); the crash itself is not fixed**

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
- The project's one GDExtension is `addons/hshm/hshm.gdextension` (the shm video surfaces), which makes it the first
  suspect: heap corruption at teardown fits a native object freed twice, or written after free, when the extension
  unloads. Not confirmed: `gdb` and `coredumpctl` are not installed on the box.
- Effect while running: none seen. The GUI works until it quits. The crash costs only what runs after quit: the engine's
  restart-on-exit, and anything saved in `_exit_tree` / `NOTIFICATION_WM_CLOSE_REQUEST` after the corruption point.

## What was done

- `app/connection_menu.gd` `restart()`: starts the new client with `OS.create_process()` BEFORE `quit()`, and falls back
  to `set_restart_on_exit` only when the spawn fails. Used by the A/B switch and by WO-670 P3b's follow.

## What was VERIFIED

- Box, 22.10, WO-670 P3b test:
  - with the old restart, the master follow wrote the new origin, then crashed, and no new process came up;
  - with the spawn-first restart, a new process came up each time (12:09:21 to the stub, 12:09:33 back), while the old
    one still crashed on its way out.

## Next

- Ask the owner to install `gdb` (`sudo apt install gdb`), then take a backtrace of the abort:
  `gdb -batch -ex run -ex bt --args ~/.local/opt/godot/godot --headless --path godot/client --quit-after 300 --`.
- Bisect by disabling hshm (rename the .gdextension) and quitting headless.
