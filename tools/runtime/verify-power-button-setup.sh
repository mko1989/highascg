#!/usr/bin/env bash
# Check-only: power button wiring for eggs produce / stick boot.
#   sudo bash tools/runtime/verify-power-button-setup.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FAIL=0

fail() { echo "ERROR: $*" >&2; FAIL=$((FAIL + 1)); }
ok() { echo "OK: $*"; }
warn() { echo "WARN: $*" >&2; }

echo "==> Power button setup verify"

if dpkg-query -W -f='${Status}' evtest 2>/dev/null | grep -qE '(install|hold) ok installed'; then
	ok "package evtest"
else
	fail "missing evtest — sudo bash ${REPO_ROOT}/scripts/setup/14-power-button-network-reset.sh"
fi

LOGIND_DROP=/etc/systemd/logind.conf.d/99-highascg-power.conf
if [[ -f "$LOGIND_DROP" ]] && grep -q '^HandlePowerKey=ignore' "$LOGIND_DROP"; then
	ok "logind HandlePowerKey=ignore"
else
	fail "missing ${LOGIND_DROP} — logind will steal the power key before HighAsCG handler"
fi

LISTEN_DST=/usr/local/lib/highascg/highascg-power-button-listen.sh
if [[ -x "$LISTEN_DST" ]]; then
	ok "listener script installed"
else
	fail "missing ${LISTEN_DST} — sudo bash ${REPO_ROOT}/scripts/setup/14-power-button-network-reset.sh"
fi

if systemctl is-enabled --quiet highascg-power-button.service 2>/dev/null; then
	ok "highascg-power-button.service enabled"
else
	fail "highascg-power-button.service not enabled"
fi

if systemctl is-active --quiet highascg-power-button.service 2>/dev/null; then
	grab_dev="$(ps -o args= -C evtest 2>/dev/null | sed -n 's/.*--grab \([^ ]*\).*/\1/p' | head -1 || true)"
	if [[ -n "$grab_dev" ]]; then
		if grep -B5 "$grab_dev" /proc/bus/input/devices 2>/dev/null | grep -qE 'Power Button|PWRBN|PNP0C0C/button'; then
			ok "listener active on ${grab_dev} (power button device)"
		elif grep -B5 "$grab_dev" /proc/bus/input/devices 2>/dev/null | grep -qiE 'sleep|lid|PNP0C0E'; then
			fail "listener on ${grab_dev} looks like lid/sleep — reinstall listener (wrong device)"
		else
			warn "listener on ${grab_dev} — could not confirm ACPI power button name"
		fi
	else
		warn "service active but evtest --grab device not found in process list"
	fi
else
	fail "highascg-power-button.service not active — power key may do nothing (HandlePowerKey=ignore)"
fi

if command -v evtest >/dev/null 2>&1; then
	pwr_n="$(awk '/^N: Name="Power Button"/ { c++ } END { print c+0 }' /proc/bus/input/devices)"
	if [[ "$pwr_n" -gt 0 ]]; then
		ok "ACPI reports ${pwr_n} Power Button input node(s)"
	else
		warn "no Name=\"Power Button\" in /proc/bus/input/devices (laptop may use PWRBN only)"
	fi
fi

echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "Power button verify FAILED (${FAIL} error(s))." >&2
	echo "Fix: sudo bash ${REPO_ROOT}/scripts/setup/14-power-button-network-reset.sh" >&2
	exit 1
fi
echo "Power button verify passed."
exit 0
