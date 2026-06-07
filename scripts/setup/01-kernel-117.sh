#!/usr/bin/env bash
# Step 1: Install and pin kernel 6.8.0-117-generic (full stack + extras).
# Does NOT install GPU drivers.
#
#   sudo bash scripts/setup/01-kernel-117.sh
#   sudo reboot
#   sudo bash scripts/setup/02-verify-kernel-117.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root
setup_trap_apt_cleanup

KERNEL_124_PKGS=(
	linux-image-6.8.0-124-generic
	linux-headers-6.8.0-124-generic
	linux-headers-6.8.0-124
	linux-modules-6.8.0-124-generic
	linux-modules-extra-6.8.0-124-generic
	linux-tools-6.8.0-124-generic
	linux-tools-6.8.0-124
)

META_PULL_LATEST=(
	linux-image-generic
	linux-headers-generic
	linux-generic
)

log "APT pin: block generic kernel metas (prevents 124+)"
mkdir -p /etc/apt/preferences.d
cat >/etc/apt/preferences.d/highascg-kernel-117.pref <<'EOF'
# HighAsCG playout host — stay on 6.8.0-117-generic
Package: linux-image-generic linux-headers-generic linux-generic
Pin: release *
Pin-Priority: -1
EOF

log "Install ${TARGET_KREL} (image, headers, modules, modules-extra, tools)"
DEBIAN_FRONTEND=noninteractive apt-get update -y
highascg_apt_block_service_starts
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	"linux-image-${TARGET_KREL}" \
	"linux-headers-${TARGET_KREL}" \
	"linux-modules-${TARGET_KREL}" \
	"linux-modules-extra-${TARGET_KREL}" \
	"linux-tools-${TARGET_KREL}" \
	linux-tools-common
DEBIAN_FRONTEND=noninteractive dpkg --configure -a

log "Purge 6.8.0-124 kernel packages"
for pkg in "${KERNEL_124_PKGS[@]}"; do
	pkg_installed "$pkg" &&
		DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "$pkg" || true
done

log "Purge generic kernel metas"
for pkg in "${META_PULL_LATEST[@]}"; do
	pkg_installed "$pkg" &&
		DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge "$pkg" || true
done

DEBIAN_FRONTEND=noninteractive apt-get autoremove -y

log "Hold ${TARGET_KREL} packages"
apt-mark hold \
	"linux-image-${TARGET_KREL}" \
	"linux-headers-${TARGET_KREL}" \
	"linux-modules-${TARGET_KREL}" \
	"linux-modules-extra-${TARGET_KREL}" \
	"linux-tools-${TARGET_KREL}"

log "GRUB: saved default (top-level Ubuntu — not Advanced submenu)"
GRUB_FILE=/etc/default/grub
if grep -q '^GRUB_DEFAULT=' "$GRUB_FILE"; then
	sed -i 's|^GRUB_DEFAULT=.*|GRUB_DEFAULT=saved|' "$GRUB_FILE"
else
	echo 'GRUB_DEFAULT=saved' >>"$GRUB_FILE"
fi
if grep -q '^GRUB_SAVEDEFAULT=' "$GRUB_FILE"; then
	sed -i 's/^GRUB_SAVEDEFAULT=.*/GRUB_SAVEDEFAULT=true/' "$GRUB_FILE"
else
	echo 'GRUB_SAVEDEFAULT=true' >>"$GRUB_FILE"
fi
update-grub
# Top-level "Ubuntu" entry boots newest installed image (${TARGET_KREL} after 124 purge).
grub-set-default 0 2>/dev/null || true
update-initramfs -u -k "${TARGET_KREL}" 2>/dev/null || true
rm -f /boot/*6.8.0-124* 2>/dev/null || true

mkdir -p /etc/highascg
echo "${TARGET_KREL}" >/etc/highascg/pinned-kernel
chmod 0644 /etc/highascg/pinned-kernel

echo
dpkg -l \
	"linux-image-${TARGET_KREL}" \
	"linux-modules-${TARGET_KREL}" \
	"linux-modules-extra-${TARGET_KREL}" \
	"linux-tools-${TARGET_KREL}" 2>/dev/null |
	awk '/^ii/ {print "  ok:", $2, $3}' || true
echo
echo "REBOOT NOW, then verify:"
echo "  sudo bash ${SCRIPT_DIR}/02-verify-kernel-117.sh"
