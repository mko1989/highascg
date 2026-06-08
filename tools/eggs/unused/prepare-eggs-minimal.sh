#!/usr/bin/env bash
set -euo pipefail

# Prepare host for a leaner penguins-eggs image while keeping:
# - Ubuntu server basics
# - NVIDIA runtime path for CasparCG/HighASCG
# - laptop compatibility (firmware + NetworkManager + SSH)
#
# Usage:
#   sudo bash tools/prepare-eggs-minimal.sh
# Optional:
#   PURGE_DEV=1 sudo bash tools/prepare-eggs-minimal.sh
#   PURGE_SNAPS=1 sudo bash tools/prepare-eggs-minimal.sh
#   BUILD_EGGS=0 sudo bash tools/prepare-eggs-minimal.sh

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

PURGE_DEV="${PURGE_DEV:-0}"
PURGE_SNAPS="${PURGE_SNAPS:-0}"
BUILD_EGGS="${BUILD_EGGS:-0}"

echo "==> Cleaning obvious large leftovers"
rm -f /var/lib/apport/coredump/core.* || true
rm -f /opt/old/casparcg/core || true
rm -rf /opt/old/casparcg/cef-cache || true
rm -rf /opt/old || true

HERE="$(cd "$(dirname "$0")" && pwd)"
echo "==> Removing swap from live payload (runtime zram is preferable)"
bash "${HERE}/live-usb/strip-host-swap-for-live-iso.sh" permanent

echo "==> Cleaning caches/log debris"
apt-get clean
rm -rf /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/* || true
rm -rf /var/lib/snapd/cache/* || true
journalctl --rotate || true
journalctl --vacuum-time=2d || true
find /var/log -type f -name "*.gz" -delete || true
find /var/log -type f -name "*.1" -delete || true
find /var/tmp -mindepth 1 -delete || true
find /tmp -mindepth 1 -maxdepth 1 -name "eggs*" -prune -o -mindepth 1 -delete || true

echo "==> Keeping laptop/server essentials"
apt-get update
apt-get install -y --no-install-recommends \
  openssh-server \
  network-manager \
  wpasupplicant \
  isc-dhcp-client \
  ethtool \
  pciutils \
  usbutils \
  rfkill \
  wireless-regdb \
  linux-firmware \
  nvidia-driver-535

echo "==> Purging obsolete kernels (keeps current + newest ABI)"
current_kernel="$(uname -r)"
mapfile -t installed_kernels < <(dpkg -l 'linux-image-[0-9]*' | awk '/^ii/{print $2}' | sort -V)
if ((${#installed_kernels[@]} > 2)); then
  keep_pkg_1="linux-image-${current_kernel}"
  keep_pkg_2="${installed_kernels[-1]}"
  for kpkg in "${installed_kernels[@]}"; do
    if [[ "$kpkg" != "$keep_pkg_1" && "$kpkg" != "$keep_pkg_2" ]]; then
      apt-get -y purge "$kpkg" || true
      hdr="${kpkg/linux-image-/linux-headers-}"
      mod="${kpkg/linux-image-/linux-modules-}"
      modx="${kpkg/linux-image-/linux-modules-extra-}"
      apt-get -y purge "$hdr" "$mod" "$modx" || true
    fi
  done
fi

if [[ "$PURGE_DEV" == "1" ]]; then
  echo "==> PURGE_DEV=1: removing heavy build toolchain packages"
  apt-get -y purge \
    build-essential cmake clang llvm llvm-18 llvm-18-dev \
    gcc g++ gfortran make \
    linux-headers-generic linux-headers-6.8.0-* \
    libclang-common-18-dev libclang-cpp18 libllvm20 libllvm18 || true
fi

if [[ "$PURGE_SNAPS" == "1" ]]; then
  echo "==> PURGE_SNAPS=1: removing snaps and snapd"
  if command -v snap >/dev/null 2>&1; then
    snap list | awk 'NR>1{print $1}' | while read -r s; do
      snap remove --purge "$s" || true
    done
  fi
  apt-get -y purge snapd || true
  rm -rf /var/lib/snapd /snap /var/snap ~/snap || true
fi

echo "==> Autoremove and final cleanup"
apt-get -y autoremove --purge
apt-get clean
update-initramfs -u || true
update-grub || true

echo "==> Biggest remaining paths"
du -xhd1 /var /usr /opt /home 2>/dev/null | sort -h
echo
echo "Largest files:"
find / -xdev -type f -size +200M 2>/dev/null | head -n 40

if [[ "$BUILD_EGGS" == "1" ]]; then
  echo "==> Building fresh image"
  eggs produce --nointeractive --release --standard
  echo "ISO output usually under /home/eggs"
else
  echo "Skipping eggs build (BUILD_EGGS=0)"
fi

