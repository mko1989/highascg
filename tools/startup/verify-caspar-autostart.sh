#!/usr/bin/env bash
# Why Caspar did not auto-start — read-only checks for booted stick.
#
#   bash ~/highascg/tools/startup/verify-caspar-autostart.sh
set -euo pipefail

PLAYOUT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
FAIL=0

ok() { echo "OK: $*"; }
warn() { echo "WARN: $*" >&2; }
bad() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

echo "=== Caspar autostart (systemd WO-73 — Openbox no longer starts run.sh) ==="

for u in casparcg-scanner.service casparcg-server.service; do
	if systemctl cat "$u" &>/dev/null; then
		en="$(systemctl is-enabled "$u" 2>/dev/null || echo ?)"
		ac="$(systemctl is-active "$u" 2>/dev/null || echo ?)"
		if [[ "$en" == "enabled" ]]; then ok "${u} enabled"; else bad "${u} not enabled (${en})"; fi
		if [[ "$ac" == "active" ]]; then ok "${u} active"; else bad "${u} not active (${ac})"; fi
	else
		bad "${u} not installed — run: sudo bash scripts/setup/sync-caspar-supervisor-wiring.sh"
	fi
done

if [[ -f /run/highascg/inhibit-caspar-autostart ]]; then
	bad "inhibit file present — Nuclear Stop was used; run: sudo /usr/local/bin/caspar-systemd-control.sh start"
else
	ok "no inhibit file (/run/highascg/inhibit-caspar-autostart)"
fi

for p in run.sh bin/casparcg config/casparcg.config; do
	[[ -e "${PLAYOUT}/${p}" ]] && ok "exists: ${p}" || bad "missing: ${PLAYOUT}/${p}"
done

if systemctl is-active nodm.service &>/dev/null; then
	ok "nodm active (X :0)"
else
	bad "nodm not active — casparcg-server needs DISPLAY=:0"
fi

if sudo -u casparcg env DISPLAY=:0 XAUTHORITY=/home/casparcg/.Xauthority xdpyinfo -display :0 >/dev/null 2>&1; then
	ok "X display :0 for casparcg"
else
	bad "X :0 not ready — Caspar screen consumers cannot start"
fi

after="$(systemctl show casparcg-server.service -p After --value 2>/dev/null || true)"
if grep -q nodm <<<"$after"; then
	ok "casparcg-server After= includes nodm"
else
	bad "casparcg-server After= missing nodm — re-run: sudo bash scripts/setup/13-caspar-systemd-units.sh"
	echo "       After=${after}" >&2
fi

echo ""
echo "Recent casparcg-server journal:"
journalctl -u casparcg-server.service -b --no-pager -n 15 2>/dev/null || true
echo ""
echo "Manual start: sudo systemctl start casparcg-scanner.service casparcg-server.service"
echo "Diagnose:     bash ~/highascg/tools/runtime/diagnose-caspar-supervisors.sh"

if [[ "$FAIL" -gt 0 ]]; then
	echo "Caspar autostart verify FAILED (${FAIL} error(s))." >&2
	exit 1
fi
echo "Caspar autostart verify passed."
exit 0
