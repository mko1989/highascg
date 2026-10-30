# WO-721 — "Install to disk" greyed out on the live ISO; Calamares' bridge release was a no-op

**Area:** os-iso
**Status: DONE (24.10.26) in the repo: the WO-721 smoke 5/5 (0/5 on the old code), and the fix script run against
the shipped ISO's own settings.conf. Reaching a live USB needs a new ISO produce, which is owner QA. The exact
runtime cause of the grey button in the 24.10 live session is not recoverable (its journal was in RAM); the pane now
states it.**

Owner, 24.10: *"Install to disk calamares Is greyed out when running the iso. I triggered install via terminal."*

## Investigation

Evidence: the ISO the owner booted, `Ventoy/highascg-nvidia-595_amd64_2026-10-23_1946.iso`, built 23.10 19:46. Its
`live/filesystem.squashfs` was extracted read-only with xorriso and inspected with `unsquashfs`. The second source is
the session log Calamares mirrored to the stick (WO-417):
`HIGHASCGEXF/logs/calamares-session-highascg5867.log` (live host `highascg5867`, started 07:52:24, ended
`completion: succeeded` at 09:58:12). **The terminal install itself worked.**

### A. The button: what makes it grey

- `godot/client/features/settings/nuclear_pane.gd` creates the button with `disabled = true`. `refresh()` enables it
  only when `GET /api/system/setup` succeeds AND returns `calamares.installed == true` and
  `calamares.sudoLaunchAvailable != false`.
- When the request fails, `refresh()` returns early. The button stays grey and only the Caspar line changes
  ("unavailable"); nothing on screen says why.
- When it succeeds but a check is false, the reason is put ONLY in `tooltip_text`, which a kiosk operator has to
  discover by hovering.
- **Every precondition is present in the ISO squashfs:**
  - `/usr/bin/calamares` (0755)
  - `/usr/local/bin/launch-calamares.sh` (0755)
  - `/etc/sudoers.d/highascg` (0440 root) with `casparcg ALL=(root) NOPASSWD: /usr/local/bin/launch-calamares.sh`
  - `/etc/sudoers` is stock with `@includedir /etc/sudoers.d`
  - `casparcg` is in `sudo`
  - `highascg.service` runs as `User=casparcg`
  - `eggs produce --clone` keeps that user
  - On this box the same API answers `installed: true, sudoLaunchAvailable: true` in 0.09 s.
- So the failure was **at runtime in the live session**, and its journal died with the RAM session. What can be
  proven is that the path is fragile in ways a live USB hits:
  - `routes-system-setup.js` `GET /api/system/setup` runs blocking subprocesses in series:
    - `eggs calamares --help` (timeout 8 s; penguins-eggs is a Node CLI, so a cold start off a USB squashfs is slow)
    - `command -v calamares` (4 s)
    - `sudo -n -l` (4 s)
    - two `systemctl is-active` calls (5 s each)
  - The worst case is about 22 s. The Godot `Api` gives up at 15 s (`TIMEOUT_S`), so the button stays grey with no
    reason. While it runs, `execFileSync` also blocks the server's whole event loop.
  - The result of the `eggs calamares --help` probe (`eggsAvailable` / `binary` / `launchable`) is read by no client
    (rg over `godot/client`, `client`, `src`). It costs up to 8 s for nothing.
  - `calamaresSudoLaunchAvailable()` greps the text of `sudo -n -l` for `launch-calamares.sh`. That is a proxy: a
    user allowed through a broader rule (an alias, `ALL`) reads as "not configured" even though sudo would allow the
    command. `sudo -n -l <command>` asks sudo the actual question (exit 0 = allowed).

### B. Calamares' `shellprocess@release_bridge` ran without a script (WO-481 never worked)

- Session log lines 93–97:
  - `No config file for "shellprocess" found anywhere at /etc/calamares/modules/shellprocess.conf …`
  - `No script given for ShellProcessJob "shellprocess@release_bridge"`
- `shellprocess@release_bridge.conf` IS in the squashfs, and the step IS in the exec sequence (before `partition`).
- But the squashfs `settings.conf` `instances:` list has no `id: release_bridge` entry. Calamares only maps
  `module@id` to a `config:` file through an instance entry; without one it loads the module's default
  `shellprocess.conf`.
- WO-481's `fix-calamares-shellprocess.sh` inserted only the sequence line, so on every ISO since WO-481 the step has
  been an empty job.
- This install succeeded anyway, most likely because the target disk did not carry a mounted bridge. On the
  bridge-on-target layout WO-475 describes, the install would fail as before unless it was started through
  `launch-calamares.sh`, which releases the bridge itself. Every other launch path is unprotected: a terminal
  `calamares`, or a desktop entry.

### C. (found during the gates) The WO-704 DKMS-cache smoke fails whenever an operator stick is plugged in

- After the HIGHASCGEXF stick was plugged into this box at 08:01, `test:ci` failed every time (5/5 alone) in
  `smoke-wo704-decklink-dkms-cache` "no stick mounted → miss".
- That case cleared `DECKLINK_DKMS_CACHE_ROOT`, so `decklink_dkms_cache_root()` walked the real
  `/home/casparcg/exfat` and found the stick's `decklink/dkms-cache` (filled at 07:50 by the live ISO session).
- The test only read it: restores go to the sandbox tree, and no test saves with an empty root.

## What was done

- **B** — `tools/eggs/live-usb/fix-calamares-shellprocess.sh`:
  - Declares `- id: release_bridge / module: shellprocess / config: shellprocess@release_bridge.conf` right under
    `instances:`.
  - Has two separate idempotency checks, each anchored to its own line: the instance id, and the sequence entry. The
    old check grepped `shellprocess@release_bridge` anywhere in the file, which the new `config:` line would satisfy,
    hiding a missing step.
  - Warns if eggs ever drops the `instances:` key.
- **B gate** — `patch-iso-squashfs-calamares.sh` reads `settings.conf` back out of the REBUILT squashfs and exits 1
  unless it both declares and schedules the step. The ISO the owner booted fails this gate.
- **A server** — `src/api/routes-system-setup.js`:
  - `detectCalamaresStatus` no longer spawns `eggs calamares --help`; `eggsAvailable` is now "eggs is executable".
    The JSON shape is unchanged, and no client reads the field.
  - `calamaresSudoLaunchAvailable` asks `sudo -n -l /usr/local/bin/launch-calamares.sh` (exit 0 = allowed) instead of
    grepping the whole listing.
  - On this box the route's Calamares block takes 12 ms with the same answer.
- **A client** — `godot/client/features/settings/nuclear_pane.gd`:
  - A visible line under the button carries the reason (it also stays as the tooltip).
  - A failed or abandoned status check now ENABLES the button and says "Couldn't check the installer (…) — you can
    still try". `POST /api/system/setup/install` → `launchCalamaresAsync` re-checks every precondition and answers
    with the reason, which `_run` puts on screen. A slow probe can therefore never lock the installer again.
  - The web `settings-modal.js` keeps its old behaviour. The kiosk is the Godot client.
- **C** — `scripts/lib/decklink-dkms-cache-lib.sh`: the mount list is overridable through
  `DECKLINK_DKMS_CACHE_MOUNTS`, a test seam like the existing `DECKLINK_DKMS_TREE` / `DECKLINK_DKMS_ARCH`. The
  default is unchanged. The WO-704 smoke points it at a path that does not exist.
- **Test** — new `smoke-wo721-install-to-disk` (5 tests), added to the `run-offline-tests.js` FILES list.
  - It **executes** the fix script against a temp root: fresh eggs settings, and the shipped WO-481 state.
  - It stubs `child_process` and `fs` to prove there is no eggs spawn and that the sudo question names the launcher.
  - It pins the build gate and the pane.

## What was VERIFIED

- **B against the real artifact:**
  - The patched script, run on a scratch root holding the 23.10 19:46 ISO's own `settings.conf` (only its uid guard
    removed), added exactly the 3 instance lines. A second run reported both already present and produced no diff.
  - On an eggs-fresh file (step line removed) it inserted both. `python3 yaml.safe_load` shows instance
    `{id: release_bridge, module: shellprocess, config: shellprocess@release_bridge.conf}` and exec beginning
    `[shellprocess@release_bridge, partition, mount]`.
  - The new build gate FAILS on the 19:46 ISO's squashfs and PASSES on the patched settings.
- **A:** `detectCalamaresStatus()` on the box returns `installed: true, sudoLaunchAvailable: true` in 12 ms (it ran up
  to 8 s+ before). `sudo -n -l <launcher>` exits 0, and exits 1 for a command not in sudoers.
- **Tests:**
  - The WO-721 smoke passes 5/5, and 0/5 with the four source files stashed.
  - `xvfb-run -a npm run test:ci`, lint (0 errors), format:check, max-file-lines (0 over), Godot units 21462/0, and a
    sandbox boot check (status 0, pane compiles) all pass.
- **C:** the WO-704 smoke passes 7/7 with the stick still mounted; it failed every time before. Full `test:ci` after
  all of this: 3070 tests, 3068 pass, 0 fail.
- **NOT proven:** which runtime condition greyed the button in the 24.10 live session; its server journal lived in
  RAM. After this change the pane states the reason on screen, or stays usable when the check fails.
- **Owner QA:** the fixes reach an ISO only through a new produce:
  `sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh` (the gate aborts it if the step is
  missing again). On the next live boot:
  1. Settings → Nuclear → the Install button is enabled, or the line under it says why.
  2. Start the install from the button.
  3. The session log on HIGHASCGEXF no longer says "No script given for ShellProcessJob".
