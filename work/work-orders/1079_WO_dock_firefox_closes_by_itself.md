# WO-1079 — Firefox opened from the dock closes by itself

**Area:** godot-client
**Status: IN PROGRESS (15.11.26 — cause proven from the journal, fix committed; NOT live: show on, the node server was not restarted)**

Owner 15.11 (on show): "When I run Firefox from the dock, it will sometimes close by itself and then running it again
brings a whole new window."

## Investigation (read-only, show on)

- `highascg.service` is `KillMode=mixed`: on every node restart systemd SIGKILLs the whole cgroup.
- The running Firefox (pid 4067334) is in `0::/system.slice/highascg.service` (`/proc/<pid>/cgroup`).
- Journal + `/tmp/highascg-operator-firefox.log`: every Firefox launch is followed by a node restart before the next
  launch — 15.11: launched 09:03 → restart 09:22 → launched again 09:32; 07:18:13 → restart 07:18:26; 07:22 → restart
  07:25. 14.11: launched 10:48 → restart 14:12, then eight more restarts until 22:00. All restarts were mine
  (deploying fixes). A SIGKILLed Firefox on its own profile comes back as a new, empty window.
- Zoom (WO-1012) and the file manager were already started through `userScopeArgv` (`systemd-run --user --scope`).
  Live proof that this survives: Thunar pid 2076766, started from the dock 14.11 09:18, cgroup
  `user@1000.service/app.slice/run-p2076766-….scope`, still running after 12 node restarts.
- This is also the likely story behind WO-1077's evening of 14.11 (Firefox gone after my restarts).

## What was done

- `src/api/system-hardware-gui.js` `spawnGuiDetached`: the user scope is no longer limited to Zoom and the file
  manager — every app the dock or Settings starts (Firefox, MagicQ, nvidia-settings, Desktop Video, any `app:` entry)
  runs outside the service's cgroup. `systemd-run --scope` execs the command, so pid, env and exit event are unchanged;
  without a user manager the plain argv is used as before.

## Verified

- `tools/smoke/smoke-wo628-operator-dock.test.js` (14 tests) incl. the new WO-1079 case; zoom / os-password / wo886
  smokes unchanged and passing.
- Mechanism on the box with the service's kind of environment (no restart, nothing opened on screen):
  `env -i … systemd-run --user --scope --collect --quiet -- sh -c 'cat /proc/self/cgroup'` →
  `user@1000.service/app.slice/run-….scope`.
- NOT verified live: the running node still has the old code. After the next restart, check that a dock-launched
  Firefox shows a `user@1000.service` cgroup and survives one more restart.

## Open

- The Firefox open right now is still inside the service's cgroup: the next node restart will close it once more.
