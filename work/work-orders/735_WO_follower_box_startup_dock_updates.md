# WO-735 — A server box whose kiosk follows the master: start-up question, dock and Updates work on the box itself; releases carry the Godot client

**Status: IN PROGRESS — code, Godot tests 21510/0, live dock check and release `2026-10-24_174730` done (.4 sees it); owner's first .4 update from a client pointed at .4 pending**

Owner, 24.10, after the .4 upgrade to Ubuntu 26.04: *"lets run full tests to see if its any different"*, then *"the dock
didn't show up on the .4"* and *"create a realese so the .4 can be upgraded via github from client"*.

## Investigation

**.4 after the upgrade.** Ubuntu 26.04.1, kernel 7.0.0-38, NVIDIA 615.71.09 (RTX 2080 SUPER), node 24.22.1.
`highascg` is active and the kiosk renders (screenshot: it follows this box, the master, as designed by WO-670). But
**CasparCG never started.** `/tmp/caspar.log`: `[run.sh] waiting for the boot screen choice (…/caspar-screens-ready, up
to 240s)`. The hold file `~/.highascg/run/caspar-screens-hold` carries this boot's id, and the journal says
`[Boot screens] start-up launcher on every screen (startup.mode ask); Caspar held until it is answered`. So run.sh waits
with no backstop (WO-645) for a launcher that never appeared. No window other than the operator client exists
(`xdotool search`).

**Cause (one bug, three symptoms).** The box-local features decide on `Config.origin`, which on a follower box is the
master:
- `godot/client/app/boot_question.gd:17` — `if not Platform.is_local_origin(Config.origin): return`. The start-up
  question is never asked, so Caspar is held forever.
- `godot/client/app/operator_dock_model.gd:20` `wanted(origin)` is called with `Config.origin` from `shell.gd:111`, so
  **no dock** (the owner's report).
- `features/settings/updates_pane.gd` and `NuclearGate.post` (the dock launch, the update install) use plain `Api`.
  Settings → Updates on .4's kiosk would therefore have checked and **installed on the master**, the live box.

It is the same class as WO-732 P3a, which already resolves "this machine's own server" (`core/devices_target.gd`).
DevicesTarget probed the home server once, though. At boot the client can start before the server listens (WO-696),
so one failed probe would have left the box on the master again.

**Releases do not carry the kiosk client.** `scripts/lib/archive-common.sh` `archive_common_server_tar_members` has
no `godot/`. The kiosk runs `godot/client` from source (`run-client.sh`), so a GitHub update refreshes the server and
leaves the client as it was. The apply is an rsync merge filtered by `/etc/highascg/server-update-rsync-excludes.txt`,
which has no `/godot/` rule (checked on .4), so adding the member is enough. .4's sudoers allow
`highascg-webui-server-update.sh`. Its `BUILD_STAMP` (`2026-10-23_194203`) is newer than the last release
(`2026-10-22_214247`), so only a new release shows as an update.

## What was done

- `core/devices_target.gd`: the home probe retries every 2 s for up to `BOOT_WAIT_S` (90 s) while there is no
  transport (status 0). New `on_box()` = the target origin is loopback.
- `app/boot_question.gd`: waits for DevicesTarget, asks only when `on_box()`, and sends every request (and the
  picker's, via `picker.api`) to `DevicesTarget.api`.
- `app/operator_screen_picker.gd`: optional `api` (default the connected server).
- `app/shell.gd` `_add_dock()`: waits for DevicesTarget and decides with `DockModel.wanted(DevicesTarget.origin(), …)`.
  `operator_dock.gd` / `operator_dock_menu.gd` use `DevicesTarget.api` (list, icons, launch).
- `app/nuclear_gate.gd` `post(…, api = null)`: the dock launch and the update install pass `DevicesTarget.api`.
- `features/settings/updates_pane.gd`: check, status and install go to `DevicesTarget.api`. On a follower box this
  updates the box you are standing at; a laptop still updates the server it is connected to.
- `scripts/lib/archive-common.sh`: members gain `godot/client` and `godot/GODOT_VERSION`, minus `.godot/`, `export/`,
  `build/` and `*.uid` (regenerated per machine, as in .gitignore).
- `tests/test_devices_target.gd`: a pin that boot_question, the dock and the updates pane never use `Api.` or
  `Config.origin`, and that the dock launch and the update install pass the target.

Every other Settings pane (System, DeckLink, Tailscale, Nuclear…) still acts on the connected server, i.e. the master
on a follower box. That is the wider "Settings on a follower" question and is left for the owner.

## What was VERIFIED

- Godot `--check` boot OK; `--test` 21510 passed / 0 failed.
- Live, an isolated Xvfb client following .4 on this box: `[devices] this client follows http://192.168.0.4:4200: the
  Devices tab works on this machine (http://127.0.0.1:4200)`. Resting the pointer at the bottom edge reveals the dock
  with this machine's apps (HighAsCG, Firefox, …, ⋯). The old code gave this client no dock (origin .4).
- This box's kiosk was restarted (home, not following): the `HighAsCG dock` window exists, so nothing changed for it.
- Release `2026-10-24_174730` (built the WO-687 way, from a clean worktree of 4d36313b): server tarball 50.0 MB, 9901
  entries, 631 of them `godot/client/`, no `.godot`/`.uid`, no secrets. The three operator builds are attached.
  `.4` `/api/system/update/check` → `updateAvailable: true`. Since WO-736, every green push makes such a release.
- Full suite on .4 (Ubuntu 26.04, a throwaway copy of HEAD with its own `npm ci`): 3168 pass / 3 fail. The failures
  were the known export-only wo498, and two smoke-wo721 cases: bash 5.3 treats `BASH_SOURCE[0]` of a stdin script as
  unbound under `set -u`. That is a harness artifact (the real script always runs from a file) and was fixed in the
  smoke (dc6da8ea): 5/5 on bash 5.2 here and on 5.3 on .4. Godot on .4: `--check` OK, `--test` 21493 / 0.
- Pending owner: the first update of .4 from a client **connected to .4**. .4's running kiosk is still the old client,
  so its own Updates pane would target the master. After the update, restart .4's kiosk (or reboot). Expected: the
  launcher appears, Caspar starts on the answer, the dock appears.
