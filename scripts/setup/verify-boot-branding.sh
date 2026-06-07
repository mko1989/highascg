#!/usr/bin/env bash
# Check HighAsCG boot branding on this host (no install).
set -euo pipefail

ok()  { echo "  ok: $*"; }
fail() { echo "  FAIL: $*"; ERR=1; }
ERR=0

echo "HighAsCG boot branding verify"
echo

[[ -f /boot/grub/splash.png ]] && ok "GRUB splash /boot/grub/splash.png" || fail "missing /boot/grub/splash.png"
[[ -f /boot/grub/theme.cfg ]] && ok "GRUB theme.cfg" || fail "missing /boot/grub/theme.cfg"
[[ -x /etc/grub.d/00_highascg_gfxtheme ]] && ok "GRUB gfx preamble" || fail "missing /etc/grub.d/00_highascg_gfxtheme"

if [[ -d /usr/share/plymouth/themes/highascg ]]; then
	nthrob=$(find /usr/share/plymouth/themes/highascg -maxdepth 1 -name 'throbber-*.png' 2>/dev/null | wc -l)
	ok "Plymouth theme highascg (${nthrob} throbber frames)"
else
	echo "  note: Plymouth highascg theme not installed (optional on host — dmesg mode uses fb throbber)"
fi

if systemctl list-unit-files highascg-fb-corner-throbber.service &>/dev/null; then
	state=$(systemctl is-enabled highascg-fb-corner-throbber.service 2>/dev/null || echo disabled)
	ok "fb corner throbber service (${state})"
else
	fail "highascg-fb-corner-throbber.service not installed"
fi

grep -q 'insmod gfxterm' /boot/grub/grub.cfg 2>/dev/null && ok "grub.cfg has gfxterm" || fail "grub.cfg missing gfxterm"

echo
if [[ "$ERR" -eq 0 ]]; then
	echo "PASS"
	exit 0
fi
echo "FAIL — run: sudo bash scripts/setup/11-boot-branding.sh"
exit 1
