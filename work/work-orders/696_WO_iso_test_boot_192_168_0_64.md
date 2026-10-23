# WO-696 — 22.10 ISO test boot on a second machine (192.168.0.64): host's project, Caspar never started, no SSH

**Status: IN PROGRESS (2026-10-23) — 3 causes found (evidence below); SSH fix in the repo; Caspar gate: needs the client
log from .64; stick adoption: owner decision**

Owner, `next.md` 23.10: *"ive ran an iso built yesterday and first issues i saw where. project loaded in highascg was a
project i was running on the host machine. casparcg did not start at all. the gui started. you can connect to that
machine on 192.168.0.64 user casparcg password highascg"*

## Investigation (read-only: .64's HTTP API; SSH to .64 is down — finding 1)

### 1. SSH never starts on the live ISO

- `ssh casparcg@192.168.0.64`: first `kex_exchange_identification: Connection reset by peer`, then port 22 refused —
  socket-activated sshd failing, then ssh.socket giving up.
- The ISO ships without `/etc/ssh/ssh_host_*` (WO-669, `penguins-eggs-exclude-highascg-fragment.list:315`) and relies
  on the drop-in `/etc/systemd/system/ssh.service.d/05-host-keys.conf` (`ExecStartPre=/usr/bin/ssh-keygen -A`).
- `systemctl cat ssh.service` on the build host: the unit's own `ExecStartPre=/usr/sbin/sshd -t` (line 10) comes
  BEFORE the drop-in's keygen (line 30) — a drop-in's ExecStartPre is appended. `sshd -t` fails with no host keys, so
  the keygen never runs. WO-669 verified the exclude, never a live SSH login.

### 2. The "host machine's project" came from the stick's exFAT, written by this box today

- .64 `GET /api/project/list`: every project has `source: usb` (`/home/casparcg/exfat/projects/`); `new_project_1`
  `savedAt 2026-10-23T10:30:04Z` — after the ISO was built (22.10) and before .64 booted (11:02).
- This box's journal: 10:17:08 the stick (`sda1` Ventoy, `sda2` VTOYEFI, `sda3` HIGHASCGEXF) was plugged in;
  10:17:11 `highascg-exfat-arrive.service` + `home-casparcg-exfat.mount` mounted **the stick's HIGHASCGEXF as this box's
  `~/exfat`** (WO-47 hotplug: `What=/dev/disk/by-label/HIGHASCGEXF`); 10:18:32 `[exfat-sync] push to volume(s)
  copied=138` (config + projects onto the stick); then `[project] pushed new_project_1.json → USB` on every save
  (10:19:01 … 10:30:04).
- .64 at boot (11:02): `[exfat-sync] … copied=24` pulled them in. The ISO itself is clean (`write-iso-default-config.js`
  resets `projects/` to the starter show; the starter is also named "New project 1", which made it look like the ISO).
- So: any WO-47 operator stick plugged into a RUNNING box (e.g. to copy a new ISO onto Ventoy) becomes that box's data
  volume and leaves with the box's projects + config. Design question for the owner (below).

### 3. Caspar held for ever: the start-up launcher was never answered

- .64 log 11:02:02 `[Boot screens] start-up launcher on every screen (startup.mode ask); Caspar held until it is
  answered` (WO-645: `ask` holds Caspar with no backstop until "Start operator here" / "Run headless").
- `GET /api/system/operator-screen` on .64 (11:2x): `boot { pending: true, launcher: true, timeoutS: 0, defaultName:
  HDMI-0 }` — still unanswered; AMCP watchdog `no casparcg main process (waiting for run.sh)` from 11:02:32 on; a
  full apply at 11:12:12 also waited for run.sh (`caspar=stopped`), because run.sh is held, not crashed.
- A WS client connected at 11:02:13 (the Godot client), yet the owner saw "the gui", not the launcher.
  `godot/client/app/boot_question.gd`: when `open_boot()` returns false the main window is restored ("show the GUI
  rather than nothing") — **and the gate stays held**. `operator_screen_picker.gd:45–60` returns false when the
  outputs GET fails or when native sub-windows are refused. Which branch ran on .64 needs `~/.highascg/log/godot-client.log`
  there (SSH down — finding 1). Either way the GUI must never come up while the gate it should answer stays closed.

## What was done

- `tools/eggs/live-usb/systemd/ssh.service.d-05-host-keys.conf.example`: `ExecStartPre=` (clear) → `ssh-keygen -A` →
  `sshd -t`. `tools/smoke/smoke-wo696-ssh-host-keys-dropin.test.js` pins the order (CI list). The build host needs the
  new copy installed (root): `sudo install -m 0644 ~/highascg/tools/eggs/live-usb/systemd/ssh.service.d-05-host-keys.conf.example /etc/systemd/system/ssh.service.d/05-host-keys.conf && sudo systemctl daemon-reload`
  before the next produce (or `prepare-eggs-clone-with-exfat.sh` reinstalls it).

## Verified

- smoke-wo696 1/1; `systemd-analyze verify` of `ssh.service` + the new drop-in: clean.
- NOT verified: SSH on a live boot (needs the next ISO); findings 2 and 3 not fixed yet.

## Open

- Owner: on .64, `sudo ssh-keygen -A && sudo systemctl reset-failed ssh.service ssh.socket && sudo systemctl restart ssh.socket`
  restores SSH there now, then the client log can be read.
- Owner decision (finding 2).
- Finding 3 fix after the .64 client log.
