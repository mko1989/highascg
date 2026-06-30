#!/usr/bin/env bash
# Fix eggs Calamares shellprocess steps that exit 127 in chroot (sbin not on PATH,
# check-language-support missing offline, update-grub without path).
#
#   sudo bash tools/eggs/live-usb/fix-calamares-shellprocess.sh
#   HIGHASCG_CALAMARES_ROOT=/home/eggs/mnt/squashfs-calamares-patch-root sudo bash ...
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
ROOT="${HIGHASCG_CALAMARES_ROOT:-}"
MOD="${ROOT}/etc/calamares/modules"
LIB="${ROOT}/usr/libexec/calamares"
SBIN="${ROOT}/usr/sbin"

if [[ -n "$ROOT" ]]; then
	echo "==> Calamares shellprocess fix target: ${ROOT} (squashfs unpack / liveroot)"
else
	MOD=/etc/calamares/modules
	LIB=/usr/libexec/calamares
	SBIN=/usr/sbin
	echo "==> Calamares shellprocess fix target: live system (/)"
fi

mkdir -p "$MOD" "$LIB" "$SBIN"

echo "==> Calamares shellprocess: full paths for chroot (mkinitramfs, dpkg-reconfigure)"

cat >"${MOD}/shellprocess@mkinitramfs.conf" <<'EOF'
# HighAsCG — /usr/sbin not always on Calamares chroot PATH (eggs 26.6.2)
---
message: Creating the boot image (initramfs)...
dontChroot: false
timeout: 300
script:
  - /bin/bash -c '/usr/sbin/mkinitramfs -o /boot/initrd.img-$(uname -r)'
EOF

cat >"${MOD}/shellprocess@boot_reconfigure.conf" <<'EOF'
# HighAsCG — explicit bash + /usr/sbin for chroot PATH
---
message: Final reconfiguration of the kernel and bootloader...
dontChroot: false
timeout: 300
script:
  - /bin/bash -c 'chmod 644 /boot/vmlinuz-$(uname -r)'
  - /bin/bash -c 'chown 0:0 /boot/vmlinuz-$(uname -r)'
  - /bin/bash -c 'INITRD=No /usr/sbin/dpkg-reconfigure -fnoninteractive linux-image-$(uname -r)'
EOF

cat >"${MOD}/shellprocess@boot_deploy.conf" <<'EOF'
# HighAsCG — live medium vmlinuz copy (eggs boot_deploy)
---
message: Preparing the boot environment...
dontChroot: true
timeout: 300
script:
  - /bin/bash -c 'cp --preserve=timestamps /run/live/medium/live/vmlinuz-$(uname -r) ${ROOT}/boot/vmlinuz-$(uname -r)'
EOF

L10N_SRC="${REPO_ROOT}/tools/runtime/calamares-l10n-helper.sh"
NOMODESET_SRC="${REPO_ROOT}/tools/runtime/calamares-nomodeset-helper.sh"
if [[ -f "$L10N_SRC" ]]; then
	install -m 0755 "$L10N_SRC" "${LIB}/calamares-l10n-helper.sh"
	echo "==> installed ${LIB}/calamares-l10n-helper.sh (offline-safe)"
fi
if [[ -f "$NOMODESET_SRC" ]]; then
	install -m 0755 "$NOMODESET_SRC" "${LIB}/calamares-nomodeset.sh"
	echo "==> installed ${LIB}/calamares-nomodeset.sh (/usr/sbin/update-grub)"
fi

if [[ ! -x "${SBIN}/cleanup.sh" ]]; then
	CLEANUP_SRC="/usr/lib/penguins-eggs/conf/distros/noble/calamares/calamares-modules/cleanup/cleanup.sh"
	if [[ -f "$CLEANUP_SRC" ]]; then
		install -m 0755 "$CLEANUP_SRC" "${SBIN}/cleanup.sh"
		echo "==> installed ${SBIN}/cleanup.sh"
	fi
fi

echo "OK: Calamares shellprocess fixes applied"
echo "     ${MOD}/shellprocess@mkinitramfs.conf"
echo "     ${MOD}/shellprocess@boot_reconfigure.conf"
echo "     ${MOD}/shellprocess@boot_deploy.conf"
