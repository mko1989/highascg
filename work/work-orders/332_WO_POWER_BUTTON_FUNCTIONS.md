# WO-332 — Power button functions

**Source:** todos24.07.26 — "Power button functions." Owner note 2026-07-24: "the hold 3s
to poweroff doesnt work. i need to hold it way longer to get the hard power off instead."

**Status: ROOT CAUSE FOUND + FIXED IN REPO 2026-07-24 — AWAITING ROOT INSTALL (needs
owner's sudo password).**

## Root cause of the dead 3s hold (verified live on the box)
The listener design is correct (timer fires DURING the hold, not on release), the service
is running, the device is right, logind ignores the key — but the journal shows ZERO
press events ever handled. `evtest --grab` block-buffers its stdout when piped (not a
TTY), so the bash `read` loop received nothing until ~4KB accumulated: presses were
silently swallowed, and only the FIRMWARE's own long-hold hard-off ever worked — exactly
the owner's symptom.

Fixed in `tools/runtime/highascg-power-button-listen.sh`:
1. `stdbuf -oL -eL evtest` — line-buffered, events arrive immediately.
2. `now_ms()` used `date +%s%N` read as ONE field → s*1000 overflowed 64-bit → garbage
   held_ms on the release path. Now `date '+%s %N'`.
3. One journal line per press for future diagnosability.

## To activate (root; casparcg has no NOPASSWD for this)
```
sudo install -m 755 /home/casparcg/highascg/tools/runtime/highascg-power-button-listen.sh \
  /usr/local/lib/highascg/highascg-power-button-listen.sh
sudo systemctl restart highascg-power-button.service
```
Then verify: short-press the button → journal shows "press" + "short press — network
reset" within a second (`journalctl -t highascg-power -f`); hold 3 s → clean poweroff.
While testing, consider adding `systemctl restart highascg-power-button.service` (and the
install path) to sudoers NOPASSWD so future sessions can deploy this without you.

## Verified current state (2026-07-24, source + system read)

Physical button (ACTIVE on this box):
- `highascg-power-button.service` (enabled, running) executes
  `/usr/local/lib/highascg/highascg-power-button-listen.sh` (source:
  `tools/runtime/highascg-power-button-listen.sh`, 167 lines) on /dev/input/event1.
  Short press (<3 s) → network reset (`highascg-network-reset.sh`, DHCP renew); hold
  ≥3 s → `systemctl poweroff --force --no-block` (listener ~95-97). Threshold via
  `HIGHASCG_POWER_HOLD_SEC`. Installed by `scripts/setup/14-power-button-network-reset.sh`;
  verified by `tools/runtime/verify-power-button-setup.sh`.
- logind drop-in `/etc/systemd/logind.conf.d/99-highascg-power.conf`:
  `HandlePowerKey/SuspendKey/HibernateKey = ignore` — the listener owns the key.

App side:
- Graceful SIGTERM shutdown: `src/bootstrap/shutdown.js` (subsystem teardown, 8 s failsafe).
- Nuclear tab (Settings): reboot host, restart nodm, Calamares install, Caspar
  stop/start/restart (`client/components/settings-modal-templates.js` ~299-327, handlers in
  `settings-modal.js` ~131-200), all behind the nuclear-password gate
  (`routes-system-setup.js` ~186-199).
- Endpoints exist for reboot/restart-app/restart-wm/caspar control (`src/api/router.js`
  ~164-170). **No `/api/system/setup/shutdown` (poweroff) endpoint and no UI Shutdown
  button** — poweroff is ONLY reachable from the physical button hold.

## Gaps (candidate scope — owner picks)

1. **UI Shutdown button** (pairs with existing Reboot): `POST /api/system/setup/shutdown`
   → `systemctl poweroff` via the existing sudo wrapper pattern
   (`caspar-systemd-control.sh` style), nuclear-password-gated, confirmation dialog.
   The graceful path matters: node gets SIGTERM from systemd on poweroff, which already
   flushes persistence — verify ordering (autosave flush BEFORE Caspar dies).
2. **Configurable button behavior from the UI**: expose short-press action
   (network-reset | none | custom), hold action (poweroff | reboot | none) and hold
   threshold as settings; regenerate the listener env file + restart
   `highascg-power-button.service` on apply — same apply pattern as other device settings.
3. **Status/diagnostics surface**: show power-button service health (device found,
   listener active — reuse `verify-power-button-setup.sh` checks) in the Devices view,
   so a dead listener isn't discovered during a show.
4. **Graceful poweroff on hold** (today it's `--force`): consider dropping `--force` so
   units get their TimeoutStopSec — but ONLY if tested; a wedged unit must not block
   shutdown forever (keep a force fallback after N seconds in the listener).

## Verify at pickup
Ask the owner which of 1-4 "Power button functions" means (probably 1+2). Also confirm
short-press = network reset is still wanted — it's an unusual binding an operator can
trigger accidentally.

## Acceptance (for whichever scope is picked)
- Shutdown button: press → confirm → box powers off cleanly; project autosave present on
  next boot; button gated by nuclear password exactly like Reboot.
- Config UI: changing hold action/threshold survives listener restart and reboot; the
  verify script still passes; misconfig (e.g. no action) can't brick the physical button
  into a no-op poweroff-less state without a loud UI warning.
- Diagnostics: unplugging/renaming the input device shows unhealthy state in UI within
  one poll cycle.
- Offline tests for the settings normalization + endpoint auth in tools/smoke/;
  `npm run test:ci` → 0 fail. Listener/systemd changes verified with
  `tools/runtime/verify-power-button-setup.sh` on the box.

## Constraints
- The physical button is the box's last-resort recovery control — never leave a state
  where NO gesture can power the machine off (hold must always do something terminal).
- sudoers: extend the existing NOPASSWD wrapper, don't grant broad systemctl to node.
