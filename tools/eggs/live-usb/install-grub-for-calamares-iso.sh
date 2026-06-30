#!/usr/bin/env bash
# Bake BIOS + UEFI GRUB packages into the eggs clone host (and thus live squashfs).
# Without grub-pc, Calamares on Legacy BIOS boot fails:
#   "The bootloader could not be installed" (grub-install exit 1).
#
#   sudo bash tools/eggs/live-usb/install-grub-for-calamares-iso.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=apt-with-stale-eggs-repo-fallback.sh
source "${HERE}/apt-with-stale-eggs-repo-fallback.sh"
highascg_apt_update

echo "==> GRUB for Calamares install-to-disk (BIOS grub-pc + UEFI grub-efi)"
highascg_apt_install grub-pc grub-pc-bin grub-efi-amd64-bin grub-efi-amd64-signed shim-signed

for pkg in grub-pc grub-pc-bin grub-efi-amd64-bin; do
	if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qE '(install|hold) ok installed'; then
		echo "OK: $pkg"
	else
		echo "ERROR: $pkg not installed after apt" >&2
		exit 1
	fi
done

echo "OK: GRUB BIOS + EFI packages ready for eggs produce squashfs clone"
