#!/usr/bin/env bash
# Verify produce-host wiring for reliable stick/live boot (highascg start + UI drop).
#
#   sudo bash tools/eggs/live-usb/verify-highascg-stick-boot.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
AUTOSTART="/home/${USER_CASPAR}/.config/openbox/autostart"
FAIL=0

fail() {
	echo "ERROR: $*" >&2
	FAIL=$((FAIL + 1))
}
ok() {
	echo "OK: $*"
}

UNIT=/etc/systemd/system/highascg.service
UPDATE_SH=/usr/local/lib/highascg/highascg-exfat-server-update.sh
APPLY_SH=/usr/local/lib/highascg/highascg-apply-server-drop.sh

echo "==> Stick / live boot robustness verify"

[[ -f "$UNIT" ]] || fail "missing ${UNIT} — run prepare-eggs-clone-with-exfat.sh"
if [[ -f "$UNIT" ]]; then
	if grep -q '^Wants=.*highascg-exfat-server-update' "$UNIT"; then
		fail "highascg.service Wants server-update (systemd deadlock on manual start) — re-run write-highascg-systemd-unit.sh"
	else
		ok "highascg.service has no Wants= server-update (deadlock-safe)"
	fi
	if grep -q 'highascg-exfat-boot.service' "$UNIT"; then
		ok "highascg.service After= exfat-boot"
	else
		fail "highascg.service missing After= highascg-exfat-boot.service — re-run write-highascg-systemd-unit.sh"
	fi
fi

[[ -x "$UPDATE_SH" ]] || fail "missing ${UPDATE_SH} — run install-exfat-systemd-units.sh"
if [[ -f "$UPDATE_SH" ]] \
	&& grep -q 'start --no-block' "$UPDATE_SH" \
	&& grep -qE 'SERVICE=highascg\.service|start --no-block.*highascg' "$UPDATE_SH"; then
	ok "server-update uses --no-block start for highascg"
else
	fail "${UPDATE_SH} missing --no-block highascg start — reinstall from repo"
fi

[[ -x "$APPLY_SH" ]] || fail "missing ${APPLY_SH}"
if [[ -f "$APPLY_SH" ]] && grep -q 'drop_on_operator_stick_exfat' "$APPLY_SH"; then
	ok "apply script retains drops on LABEL=HIGHASCGEXF"
else
	fail "${APPLY_SH} missing HIGHASCGEXF retain logic — reinstall from repo"
fi

[[ -f /etc/highascg/server-update-retain-drop ]] && ok "server-update-retain-drop marker" \
	|| fail "missing /etc/highascg/server-update-retain-drop — touch in prepare-eggs-clone"

[[ -f "${HIGHASCG_ROOT}/dist-web/index.html" ]] && ok "dist-web built for stick seed" \
	|| fail "missing dist-web — sudo bash ${HERE}/ensure-dist-web-for-stick-seed.sh"

# WO-498: nginx removed — the operator UI is served directly on :4200.

if systemctl cat highascg-exfat-server-update.service 2>/dev/null | grep -q 'TimeoutStartSec=300'; then
	ok "server-update TimeoutStartSec=300"
else
	fail "highascg-exfat-server-update.service missing TimeoutStartSec=300 — reinstall exfat units"
fi

if grep -q 'WorkingDirectory=/home/casparcg/highascg' /etc/systemd/system/casparcg-scanner.service 2>/dev/null; then
	ok "casparcg-scanner WorkingDirectory set"
else
	fail "casparcg-scanner missing WorkingDirectory — sudo bash ${REPO_ROOT}/scripts/setup/13-caspar-systemd-units.sh"
fi

if [[ -f /etc/systemd/system/casparcg-server.service ]] \
	&& systemctl is-enabled --quiet casparcg-server.service 2>/dev/null \
	&& [[ -f "$AUTOSTART" ]]; then
	if grep -vE '^\s*#' "$AUTOSTART" | grep -q 'casparcg-scanner'; then
		fail "Openbox autostart still starts casparcg-scanner — sudo bash ${REPO_ROOT}/scripts/setup/sync-caspar-supervisor-wiring.sh"
	elif grep -vE '^\s*#' "$AUTOSTART" | grep -qE 'exec \./run\.sh|\./run\.sh >>'; then
		fail "Openbox autostart still starts run.sh — sudo bash ${REPO_ROOT}/scripts/setup/sync-caspar-supervisor-wiring.sh"
	else
		ok "Openbox autostart does not duplicate systemd Caspar"
	fi
else
	ok "Openbox autostart does not duplicate systemd Caspar (or legacy mode)"
fi

_run_ct="$(pgrep -cf 'run\.sh' 2>/dev/null || echo 0)"
if [[ "${_run_ct:-0}" -le 1 ]]; then
	ok "at most one run.sh supervisor (${_run_ct})"
else
	fail "multiple run.sh supervisors (${_run_ct}) — sync wiring and restart casparcg-server"
fi

echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "Stick boot verify FAILED (${FAIL} error(s))." >&2
	exit 1
fi
echo "Stick boot verify passed."
exit 0
