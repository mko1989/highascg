#!/bin/sh
# Copy NVMe/VMD/AHCI modules into live initrd (Calamares must see internal disks).
# Installed by install-storage-drivers-for-iso.sh
set -e

PREREQ=""
prereqs() { echo "$PREREQ"; }

case "$1" in
prereqs) prereqs; exit 0 ;;
esac

. /usr/share/initramfs-tools/hook-functions

version="${KERNELVERSION:-}"
[ -n "$version" ] || version="$(uname -r)"

copy_kmod_file() {
	mod="$1"
	kmod="$(modinfo -n "$mod" 2>/dev/null)" || return 0
	[ -e "$kmod" ] || return 0
	case "$kmod" in
	/lib/modules/${version}/*) ;;
	*) return 0 ;;
	esac
	relpath="${kmod#/lib/modules/${version}/}"
	dest="${DESTDIR}/lib/modules/${version}/${relpath}"
	mkdir -p "$(dirname "$dest")"
	cp -a "$kmod" "$dest"
}

for mod in nvme_core nvme vmd ahci libahci sd_mod scsi_mod scsi_transport_sas; do
	if modinfo "$mod" >/dev/null 2>&1; then
		manual_add_modules "$mod" 2>/dev/null || true
		copy_kmod_file "$mod"
	fi
done

if [ -f /etc/modprobe.d/highascg-storage-block.conf ]; then
	mkdir -p "${DESTDIR}/etc/modprobe.d"
	cp -a /etc/modprobe.d/highascg-storage-block.conf "${DESTDIR}/etc/modprobe.d/"
fi
