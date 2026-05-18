#!/usr/bin/env bash
set -euo pipefail

# Build a HighAsCG live ISO with robust network tooling included.
#
# Usage:
#   sudo bash tools/live-usb/build-highascg-egg.sh
#
# Optional env:
#   NVIDIA_BRANCHES="470 580"
#   BASENAME="highascg"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
BASENAME="${BASENAME:-highascg}"
NVIDIA_BRANCHES="${NVIDIA_BRANCHES:-470 580}"

echo "==> WO-47 exFAT + empty mount stubs + eggs exclude merge (operator-stick truth baked into clone snapshot)"
SKIP_HIGHASCG_SYSTEMD_RESTART=1 bash "${HERE}/prepare-eggs-clone-with-exfat.sh"

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

echo "==> Build ISO basename=${BASENAME}"
eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}"

echo
echo "Done. ISO is under /home/eggs/ and should start with ${BASENAME}_"
echo
echo "After dd (flash host): DEFAULT — full stick persistence for NVIDIA / DeckLink / Tailscale / etc.:"
echo "  sudo bash ${HERE}/add-union-persistence-partition.sh /dev/sdX"
echo "  → then always boot GRUB → Live with persistence (tools/live-usb/FLASH_AND_PERSIST.md)"
echo "Optional narrow mode (~/highascg only, no full OS persist): tools/live-usb/HIGHASCG_FOLDER_USB_PARTITION.md"
