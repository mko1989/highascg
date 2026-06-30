#!/usr/bin/env bash
# test-05-systemd-wo47.sh
st_section "05 systemd WO-47 chain"
units=(
	highascg-exfat-boot.service
	highascg-exfat-server-update.service
	highascg-exfat-sync.service
	highascg.service
	casparcg-scanner.service
	casparcg-server.service
)
for u in "${units[@]}"; do
	if systemctl cat "${u}" &>/dev/null; then
		en="$(systemctl is-enabled "${u}" 2>/dev/null || echo unknown)"
		ac="$(systemctl is-active "${u}" 2>/dev/null || echo unknown)"
		case "$ac" in
		active | inactive) st_ok "${u} enabled=${en} active=${ac}" ;;
		failed) st_fail "${u} failed" ;;
		*) st_warn "${u} enabled=${en} active=${ac}" ;;
		esac
	else
		st_fail "missing unit ${u}"
	fi
done
failed_n="$(systemctl --failed --no-legend 2>/dev/null | grep -c . || echo 0)"
if [[ "${failed_n:-0}" -eq 0 ]]; then
	st_ok "no failed systemd units"
else
	st_fail "${failed_n} failed unit(s):"
	systemctl --failed --no-pager 2>/dev/null | head -10 >&2 || true
fi
