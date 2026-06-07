#!/usr/bin/env bash
# Step 2: Verify kernel 6.8.0-117-generic is running and pinned.
# Exit 0 = pass, 1 = fail (run after reboot from 01-kernel-117.sh).
#
#   sudo bash scripts/setup/02-verify-kernel-117.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ERR=0
check() {
	local label="$1"
	shift
	if "$@"; then
		ok "$label"
	else
		fail "$label"
		ERR=1
	fi
}

running_krel() { [[ "$(uname -r)" == "${TARGET_KREL}" ]]; }

pin_file_ok() {
	[[ -f /etc/highascg/pinned-kernel ]] &&
		grep -qx "${TARGET_KREL}" /etc/highascg/pinned-kernel
}

apt_pin_ok() {
	[[ -f /etc/apt/preferences.d/highascg-kernel-117.pref ]] &&
		grep -q 'linux-image-generic' /etc/apt/preferences.d/highascg-kernel-117.pref
}

pkg_held() {
	apt-mark showhold | grep -qx "$1"
}

no_124_boot() {
	! compgen -G '/boot/*6.8.0-124*' >/dev/null
}

vmlinuz_117() {
	[[ -f "/boot/vmlinuz-${TARGET_KREL}" ]]
}

igc_available() {
	modinfo igc &>/dev/null || [[ -d "/lib/modules/${TARGET_KREL}/kernel/drivers/net/ethernet/intel/igc" ]]
}

grub_default_ok() {
	# Must not force-open "Advanced options" submenu every boot.
	! grep -q 'Advanced options for Ubuntu' /etc/default/grub 2>/dev/null &&
		grep -qE '^GRUB_DEFAULT=(saved|0)' /etc/default/grub 2>/dev/null
}

echo "HighAsCG kernel verify — target: ${TARGET_KREL}"
echo "  running: $(uname -r)"
echo

check "uname -r is ${TARGET_KREL}" running_krel
check "/etc/highascg/pinned-kernel" pin_file_ok
check "APT pin blocks linux-image-generic" apt_pin_ok
check "vmlinuz in /boot" vmlinuz_117
check "no 6.8.0-124 boot artifacts" no_124_boot
check "GRUB_DEFAULT is saved/0 (not Advanced submenu)" grub_default_ok

for pkg in \
	"linux-image-${TARGET_KREL}" \
	"linux-modules-${TARGET_KREL}" \
	"linux-modules-extra-${TARGET_KREL}" \
	"linux-tools-${TARGET_KREL}"; do
	check "installed: $pkg" pkg_installed "$pkg"
	check "held: $pkg" pkg_held "$pkg"
done

check "igc driver available (Intel I226-V NIC)" igc_available

ethernet_up() {
	# ip -br: "<iface> <state> <mac> <flags>" — name is column 1, state column 2
	ip -br link show 2>/dev/null | awk '
		$1 != "lo" && $2 == "UP" && $1 ~ /^(eno|enp|ens|eth)/ { found=1 }
		END { exit !found }
	'
}

if ethernet_up; then
	ok "at least one ethernet interface is UP"
else
	fail "no ethernet interface UP — check cabling/driver after reboot"
	ERR=1
fi

echo
if [[ "$ERR" -eq 0 ]]; then
	echo "PASS — continue with:"
	echo "  sudo bash ${SCRIPT_DIR}/03-nvidia-open-595.sh"
	exit 0
fi
echo "FAIL — fix issues above, reboot if still on wrong kernel, re-run this script."
exit 1
