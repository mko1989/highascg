#!/bin/sh
# Force NVIDIA modules into live ISO initrd (Plymouth DRM on proprietary driver).
# Ubuntu DKMS often ships nvidia-drm.ko.zst; stock hooks may skip zstd modules.
# Installed by install-plymouth-nvidia-initramfs.sh
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

for mod in nvidia nvidia_modeset nvidia_uvm nvidia_drm; do
	if modinfo "$mod" >/dev/null 2>&1; then
		manual_add_modules "$mod" 2>/dev/null || true
		copy_kmod_file "$mod"
	fi
done

if [ -f /etc/modprobe.d/highascg-nvidia-plymouth.conf ]; then
	mkdir -p "${DESTDIR}/etc/modprobe.d"
	cp -a /etc/modprobe.d/highascg-nvidia-plymouth.conf "${DESTDIR}/etc/modprobe.d/"
fi
