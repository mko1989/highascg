# WO-332 — Power button functions

**Source:** todos24.07.26 — "Power button functions."
**Status: OPEN — scope check with owner first.** Written 2026-07-24 from a read-only
survey. A LOT already exists; the todo most plausibly means "make the button's functions
configurable / add the missing UI pieces", but confirm before building.

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
