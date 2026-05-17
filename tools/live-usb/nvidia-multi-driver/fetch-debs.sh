#!/usr/bin/env bash
# Populate /opt/nvidia-pool with NVIDIA driver branches that aren't already
# installed on the build host. The currently-installed branch (typically 535)
# is *already* baked into the live image via the normal eggs clone, so we
# only cache the *additional* branches the picker may need to install on
# different hardware.
#
# Usage:
#   sudo bash tools/live-usb/nvidia-multi-driver/fetch-debs.sh
# Override branches:
#   NVIDIA_BRANCHES="470 580" sudo bash tools/live-usb/nvidia-multi-driver/fetch-debs.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

CACHE_DIR="${CACHE_DIR:-/opt/nvidia-pool}"
NVIDIA_BRANCHES="${NVIDIA_BRANCHES:-470 580}"

mkdir -p "$CACHE_DIR"
cd "$CACHE_DIR"

apt-get update

if ! command -v apt-rdepends >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends apt-rdepends
fi

# Ensure the graphics-drivers PPA is present so ubuntu-drivers / apt see
# the same branches that ubuntu-drivers will recommend on target machines.
if ! grep -qiR 'graphics-drivers' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
  echo ">> Adding ppa:graphics-drivers/ppa"
  add-apt-repository -y ppa:graphics-drivers/ppa
  apt-get update
fi

for branch in $NVIDIA_BRANCHES; do
  for pkg in "nvidia-driver-${branch}" "nvidia-dkms-${branch}"; do
    if ! apt-cache show "$pkg" >/dev/null 2>&1; then
      echo "WARN: $pkg not found in apt; skipping" >&2
      continue
    fi
    echo ">> Resolving deps for $pkg"
    deps="$(
      {
        echo "$pkg"
        apt-rdepends "$pkg" 2>/dev/null \
          | grep -v '^ ' \
          | grep -vE '^(libc6|libgcc|libstdc|linux-|init|debconf|dpkg|systemd|gcc|g\+\+|glibc|kernel-|coreutils|adduser|dkms-|udev)$' \
          || true
      } | sort -u
    )"
    echo ">> Downloading closure for $pkg ($(echo "$deps" | grep -c .) pkgs names) → $CACHE_DIR"
    dl_ok=0
    dl_miss=0
    while IFS= read -r dep || [[ -n ${dep:-} ]]; do
      [[ -z "${dep// }" ]] && continue
      if apt-get download "$dep" 2>/dev/null; then
        ((++dl_ok)) || true
      else
        echo "WARN: apt-get download failed: $dep" >&2
        ((++dl_miss)) || true
      fi
    done <<<"$deps"
    echo ">>   fetched=$dl_ok  skipped/failed=$dl_miss"
  done
done

echo
echo "==> Cache contents ($CACHE_DIR):"
ls -lh "$CACHE_DIR" | head -50
echo
du -sh "$CACHE_DIR"
echo
echo "Done. Cache will be cloned into the live image at the same path."
