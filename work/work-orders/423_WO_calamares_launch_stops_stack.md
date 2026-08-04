# WO-423 — Settings → "Install to disk" stops CasparCG + HighAsCG so only the installer is on screen

**Status: DONE in repo (2026-08-04 — smoke green, suite 1823/0/2). NOT yet live on this box: the installed copy `/usr/local/bin/launch-calamares.sh` is root-owned — owner one-liner below. Matters before the next `eggs produce` too (the ISO clones the INSTALLED copy, not the repo).**

Owner 04.08: "when starting the calamares install from the settings modal i want both casparcg
and highascg to stop (close). so only the installer is on the screen."

## Investigation

The Settings modal's "Install to disk (Calamares)" button posts `/api/system/setup/install`
(WO-73), which spawns `sudo -n /usr/local/bin/launch-calamares.sh` (repo source:
`tools/runtime/launch-calamares.sh`). Nothing stopped the stack — Caspar's fullscreen
consumers and the GUI stayed on the glass under/over the installer.

The trap: the API spawns the launcher from INSIDE `highascg.service`'s cgroup. A naive
`systemctl stop highascg` in the script kills the script itself mid-run (default
KillMode=control-group).

## What was done

`tools/runtime/launch-calamares.sh`:
1. After the root check, the script re-execs itself into a transient systemd unit
   (`systemd-run --collect`, guarded by `HIGHASCG_CAL_SCOPED` against recursion, DISPLAY/
   XAUTHORITY passed through) — escaping the highascg cgroup, so the stop below cannot take
   it down. The API's spawn gets an immediate clean exit.
2. Right before launching the installer (after display wait / branding / storage probe, to
   keep the dead window short): `systemctl stop casparcg-server casparcg-scanner highascg`.
3. `calamares -d` now runs un-exec'd; when it exits (finished OR cancelled) the script
   restarts all three services — a cancelled install brings the box straight back, and after
   a real install the reboot supersedes it anyway.

`client/components/settings-modal.js` — the confirm dialog now warns that CasparCG and the
GUI close and restart when the installer exits.

## What was VERIFIED

- `bash -n` clean; smoke (`smoke-wo423-wo424-install-and-update.test.js`) pins the ordering:
  re-exec BEFORE the stop, stop BEFORE the launch, restart AFTER; both service names present;
  client warning present. Suite 1823/0/2; client rebuilt + kiosk reloaded.
- NOT verified live: an actual launch (would stop playout). Owner QA = press the button on
  the live stick or after installing the updated script.

## Owner action to make it live on this box (and in the next ISO)

```
sudo install -m 0755 -o root -g root /home/casparcg/highascg/tools/runtime/launch-calamares.sh /usr/local/bin/launch-calamares.sh
```
