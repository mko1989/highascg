#!/usr/bin/env bash
set -euo pipefail

# Build a HighAsCG live ISO with robust network tooling included.
#
# Usage:
#   sudo bash tools/eggs/live-usb/build-highascg-egg.sh
#
# Optional env:
#   NVIDIA_BRANCHES="535 580 595"   (default; align with Settings allow-list / WO-39)
#   BASENAME="highascg"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
BASENAME="${BASENAME:-highascg}"
NVIDIA_BRANCHES="${NVIDIA_BRANCHES:-535 580 595}"

echo "==> WO-47 exFAT + empty mount stubs + eggs exclude merge (operator-stick truth baked into clone snapshot)"
SKIP_HIGHASCG_SYSTEMD_RESTART=1 bash "${HERE}/prepare-eggs-clone-with-exfat.sh"

echo "==> One build kernel (eggs.yaml + purge stale linux-image)"
bash "${HERE}/sync-eggs-kernel-and-purge-stale.sh"

echo "==> eggs livecd theme (persistence default — install-eggs-live-grub-theme.sh)"
bash "${HERE}/install-eggs-live-grub-theme.sh"

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

echo "==> Cache offline NVIDIA branches"
NVIDIA_BRANCHES="${NVIDIA_BRANCHES}" \
  bash "${HERE}/nvidia-multi-driver/fetch-debs.sh"

echo "==> Hostname for ISO naming (${BASENAME})"
hostnamectl set-hostname "${BASENAME}" 2>/dev/null || hostname "${BASENAME}"

echo "==> Factory operator config (not eggs build-host JSON / .env)"
bash "${HERE}/reset-iso-operator-config.sh"

echo "==> Finalize GRUB splash + Plymouth initramfs (must run immediately before eggs produce)"
bash "${HERE}/finalize-boot-branding-for-eggs-produce.sh"

THEME_ABS="$(cd "${HERE}/highascg-eggs-theme" && pwd)"
[[ -f "${THEME_ABS}/theme/livecd/grub.main.cfg" ]] || {
	echo "Missing highascg-eggs-theme — run install-eggs-live-grub-theme.sh first." >&2
	exit 1
}

echo "==> Build ISO basename=${BASENAME} theme=${THEME_ABS}"
# eggs produce ignores eggs.yaml theme: unless --theme is passed (defaults to stock eggs GRUB).
eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}" --theme "${THEME_ABS}"

echo "==> Inject GRUB splash + Plymouth initrd into ISO (eggs makeEfi ordering workaround)"
bash "${HERE}/inject-iso-boot-branding.sh"

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
	echo "Done. ISO: ${BUILT_ISO}"
else
	echo "Done. ISO is under /home/eggs/ (name starts with ${BASENAME}_)"
fi
echo
echo "Full build + flash /dev/sda:"
echo "  sudo bash ${HERE}/build-produce-flash-stick.sh -y"
echo
echo "Flash only (this ISO):"
echo "  sudo bash ${HERE}/create-operator-stick-from-dd.sh /dev/sda --iso ${BUILT_ISO:-/home/eggs/${BASENAME}_*.iso}"
echo "  (see tools/eggs/live-usb/FLASH_AND_PERSIST.md)"
