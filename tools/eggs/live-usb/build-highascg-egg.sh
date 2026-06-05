#!/usr/bin/env bash
# Build a HighAsCG live ISO with ONE baked NVIDIA driver (535, 580, or 595).
#
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh
#
# Does NOT download multi-branch /opt/nvidia-pool debs.
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo HIGHASCG_NVIDIA_DRIVER=595 $0" >&2
	exit 1
}

BR="${HIGHASCG_NVIDIA_DRIVER:-}"
case "$BR" in
535 | 580 | 595) ;;
*)
	echo "Set HIGHASCG_NVIDIA_DRIVER to 535, 580, or 595 (one driver per ISO)." >&2
	exit 1
	;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
export HIGHASCG_NVIDIA_DRIVER="$BR"
BASENAME="${BASENAME:-highascg-nvidia-${BR}}"

mkdir -p /etc/highascg
echo "$BR" > /etc/highascg/nvidia-iso-driver
chmod 0644 /etc/highascg/nvidia-iso-driver
echo "[build-highascg-egg] stamped /etc/highascg/nvidia-iso-driver = $BR"

export HIGHASCG_PURGE_NVIDIA_POOL=1
DISABLE="$REPO_ROOT/scripts/disable-nvidia-multi-driver-boot.sh"
if [[ -f "$DISABLE" ]]; then
	bash "$DISABLE"
fi

echo "==> WO-47 exFAT + empty mount stubs + eggs exclude merge (operator-stick truth baked into clone snapshot)"
HIGHASCG_SKIP_BOOT_BRANDING_IN_PREPARE=1 SKIP_HIGHASCG_SYSTEMD_RESTART=1 bash "${HERE}/prepare-eggs-clone-with-exfat.sh"

echo "==> Latest single kernel (apt generic + eggs.yaml + purge older images)"
HIGHASCG_ENSURE_LATEST_KERNEL=1 HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/sync-eggs-kernel-and-purge-stale.sh"

echo "==> Install network + firmware essentials for live image"
apt-get update
apt-get install -y --no-install-recommends \
	network-manager wpasupplicant isc-dhcp-client \
	iproute2 ethtool pciutils usbutils rfkill wireless-regdb \
	linux-firmware netplan.io

echo "==> Live auto-network without NM (systemd-networkd + netplan)"
mkdir -p /etc/systemd/network /etc/netplan

tee /etc/systemd/network/10-live-wired.network >/dev/null <<'NETEOF'
[Match]
Name=en* eth*

[Network]
DHCP=yes
MulticastDNS=yes
IPv6AcceptRA=yes
NETEOF

tee /etc/netplan/01-live-networkd.yaml >/dev/null <<'PLANEOF'
network:
  version: 2
  renderer: networkd
PLANEOF

chmod 600 /etc/netplan/01-live-networkd.yaml
chown root:root /etc/netplan/01-live-networkd.yaml

systemctl enable systemd-networkd systemd-resolved || true
ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true

echo "==> Hostname for ISO naming (${BASENAME})"
hostnamectl set-hostname "${BASENAME}" 2>/dev/null || hostname "${BASENAME}"

echo "==> Factory operator config (not eggs build-host JSON / .env)"
bash "${HERE}/reset-iso-operator-config.sh"

echo "==> Clone host audit (swap, nvidia-pool, excludes, branding)"
bash "${HERE}/audit-eggs-clone-host.sh"

echo "==> Umount WO-47 paths (empty stubs only in squashfs)"
umount /home/casparcg/bridge /home/casparcg/exfat /home/casparcg/highascg/media 2>/dev/null || true

echo "==> Clean eggs liveroot / stale squashfs (avoid usr_1 duplicate bloat)"
bash "${HERE}/clean-eggs-workspace-before-produce.sh"

echo "==> Finalize GRUB splash + Plymouth initramfs (must run immediately before eggs produce)"
bash "${HERE}/finalize-boot-branding-for-eggs-produce.sh"

sample="$(file -b /usr/share/plymouth/themes/highascg/throbber-0001.png 2>/dev/null || true)"
echo "==> Host Plymouth throbber sample before produce: ${sample:-missing}"
if echo "$sample" | grep -q RGBA; then
	echo "ERROR: host Plymouth frames still RGBA — prepare-branding-assets.sh did not run" >&2
	exit 1
fi

THEME_ABS="$(cd "${HERE}/highascg-eggs-theme" && pwd)"
[[ -f "${THEME_ABS}/theme/livecd/grub.main.cfg" ]] || {
	echo "Missing highascg-eggs-theme — run install-eggs-live-grub-theme.sh first." >&2
	exit 1
}

echo "==> Stop highascg during squashfs (avoid .highascg-state.json changing mid-pack)"
systemctl stop highascg.service 2>/dev/null || true

echo "==> Build ISO basename=${BASENAME} theme=${THEME_ABS} (single NVIDIA driver ${BR})"
eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}" --theme "${THEME_ABS}"

echo "==> Inject GRUB splash + Plymouth initrd into ISO (eggs makeEfi ordering workaround)"
# Fresh produce already cloned host /usr into squashfs — skip 25 min squashfs rebuild.
HIGHASCG_SKIP_SQUASHFS_REFRESH=1 bash "${HERE}/inject-iso-boot-branding.sh"

echo "==> Verify squashfs excludes (no swap file, nvidia-pool, dev trees)"
bash "${HERE}/verify-iso-squashfs-excludes.sh"

echo "==> Verify ISO boot branding (persistence on default linux line, splash, plymouth)"
bash "${HERE}/verify-iso-boot-branding.sh" || {
	echo "ERROR: ISO boot branding check failed — do not flash this ISO." >&2
	exit 1
}

if [[ "${SKIP_STRIP_HOST_SWAP:-0}" != "1" ]]; then
	bash "${HERE}/strip-host-swap-for-live-iso.sh" restore
fi

# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh" 2>/dev/null || true
BUILT_ISO=""
if declare -F find_latest_iso >/dev/null 2>&1; then
	BUILT_ISO="$(find_latest_iso 2>/dev/null || true)"
fi

echo
if [[ -n "$BUILT_ISO" ]]; then
	echo "Done. ISO: ${BUILT_ISO} (nvidia-${BR}, no nvidia-pool)"
else
	echo "Done. ISO is under /home/eggs/ (name starts with ${BASENAME}_, nvidia-${BR})"
fi
echo
echo "Full build + flash /dev/sda:"
echo "  sudo HIGHASCG_NVIDIA_DRIVER=${BR} bash ${HERE}/build-produce-flash-stick.sh -y"
echo
echo "Flash only (this ISO):"
echo "  sudo bash ${HERE}/create-operator-stick-from-dd.sh /dev/sda --iso ${BUILT_ISO:-/home/eggs/${BASENAME}_*.iso}"
echo "  (see tools/eggs/live-usb/FLASH_AND_PERSIST.md)"
