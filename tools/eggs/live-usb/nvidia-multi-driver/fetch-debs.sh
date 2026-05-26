#!/usr/bin/env bash
# Populate /opt/nvidia-pool with full apt closures for NVIDIA_BRANCHES (for
# offline picker / apply-from-pool). The branch installed on the build host
# is also cloned into the live image by eggs; the pool is for switching
# branches without network.
#
# If /opt/nvidia-pool already contains nvidia-driver-${branch} and
# nvidia-dkms-${branch} .deb metapackages for a branch, that branch is skipped
# unless NVIDIA_POOL_FORCE_REFRESH=1 (re-download closure).
#
# Usage:
#   sudo bash tools/live-usb/nvidia-multi-driver/fetch-debs.sh
# Override branches:
#   NVIDIA_BRANCHES="535 580 595" sudo bash ...
# Env:
#   NVIDIA_POOL_SKIP_EXISTING=0  — fetch every branch even if metapackage .debs exist
#   NVIDIA_POOL_FORCE_REFRESH=1  — refill closures for branches that would otherwise skip
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

CACHE_DIR="${CACHE_DIR:-/opt/nvidia-pool}"
NVIDIA_BRANCHES="${NVIDIA_BRANCHES:-535 580 595}"
NVIDIA_POOL_FORCE_REFRESH="${NVIDIA_POOL_FORCE_REFRESH:-0}"
NVIDIA_POOL_SKIP_EXISTING="${NVIDIA_POOL_SKIP_EXISTING:-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nvidia-pool-lib.sh
source "${HERE}/nvidia-pool-lib.sh"

mkdir -p "$CACHE_DIR"
cd "$CACHE_DIR"

FLAVOR="$(nvidia_pool_read_flavor)"
echo ">> NVIDIA pool flavor: ${FLAVOR} (set /etc/highascg/nvidia-driver-flavor or NVIDIA_DRIVER_FLAVOR)"

pool_has_driver_dkms_debs() {
	local b="$1"
	local driver_pkg dkms_pkg g1 g2
	driver_pkg="$(nvidia_pool_driver_pkg "$b")"
	dkms_pkg="$(nvidia_pool_dkms_pkg "$b")"
	g1="$(compgen -G "./${driver_pkg}_*.deb" || true)"
	g2="$(compgen -G "./${dkms_pkg}_*.deb" || true)"
	[[ -n "$g1" && -n "$g2" ]]
}

branches_to_fetch=()
for branch in $NVIDIA_BRANCHES; do
	if [[ "$NVIDIA_POOL_SKIP_EXISTING" -eq 1 && "$NVIDIA_POOL_FORCE_REFRESH" -eq 0 ]] && pool_has_driver_dkms_debs "$branch"; then
		echo ">> Branch ${branch}: $(nvidia_pool_driver_pkg "$branch") + $(nvidia_pool_dkms_pkg "$branch") already in ${CACHE_DIR} — skip download (NVIDIA_POOL_FORCE_REFRESH=1 to refill)"
		continue
	fi
	branches_to_fetch+=("$branch")
done

if [[ ${#branches_to_fetch[@]} -eq 0 ]]; then
	echo
	echo "==> NVIDIA pool already satisfies all branches (${NVIDIA_BRANCHES}); no apt download."
	ls -lh "$CACHE_DIR" | head -50 || :
	echo
	du -sh "$CACHE_DIR"
	echo "Done."
	exit 0
fi

apt-get update

if ! command -v apt-rdepends >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends apt-rdepends
fi

# apt-rdepends lists virtual provides (xorg-video-abi-*, libc-dev) and version-pinned
# names (nvidia-kernel-common-580-580.159.03) that are not valid apt-get download targets.
dep_has_pool_archive() {
  local dep="$1"
  [[ -n "$dep" ]] || return 1
  apt-cache show "$dep" 2>/dev/null | grep -q '^Filename:'
}

dep_skip_quietly() {
  local dep="$1"
  case "$dep" in
    debconf-2.0|kldutils|libc-dev|libxt6|systemd-sysusers) return 0 ;;
    perlapi-*|xorg-video-abi-*) return 0 ;;
    nvidia-kernel-common-[0-9]*-[0-9]*) return 0 ;;
  esac
  return 1
}

# Ensure the graphics-drivers PPA is present so ubuntu-drivers / apt see
# the same branches that ubuntu-drivers will recommend on target machines.
if ! grep -qiR 'graphics-drivers' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
  echo ">> Adding ppa:graphics-drivers/ppa"
  add-apt-repository -y ppa:graphics-drivers/ppa
  apt-get update
fi

for branch in "${branches_to_fetch[@]}"; do
  for pkg in "$(nvidia_pool_driver_pkg "$branch")" "$(nvidia_pool_dkms_pkg "$branch")"; do
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
          | grep -vE '^(libc6|libgcc|libstdc|linux-|init|debconf|dpkg|systemd|gcc|g\+\+|glibc|kernel-|coreutils|adduser|dkms-|udev|kldutils|libc-dev|libxt6|perlapi-|xorg-video-abi-|nvidia-kernel-common-[0-9]+-[0-9])' \
          || true
      } | sort -u
    )"
    echo ">> Downloading closure for $pkg ($(echo "$deps" | grep -c .) pkgs names) → $CACHE_DIR"
    dl_ok=0
    dl_miss=0
    while IFS= read -r dep || [[ -n ${dep:-} ]]; do
      [[ -z "${dep// }" ]] && continue
      if compgen -G "./${dep}_*.deb" >/dev/null 2>&1; then
        ((++dl_ok)) || true
        continue
      fi
      if ! dep_has_pool_archive "$dep"; then
        if dep_skip_quietly "$dep"; then
          ((++dl_miss)) || true
        else
          echo "WARN: no .deb in apt archives (virtual/skip): $dep" >&2
          ((++dl_miss)) || true
        fi
        continue
      fi
      if apt-get download "$dep" 2>/dev/null; then
        ((++dl_ok)) || true
      else
        echo "WARN: apt-get download failed: $dep" >&2
        ((++dl_miss)) || true
      fi
    done <<<"$deps"
    echo ">>   fetched=$dl_ok  skipped=$dl_miss (virtual/already-cached — expected)"
  done
done

echo
echo "==> Cache contents ($CACHE_DIR):"
ls -lh "$CACHE_DIR" | head -50 || :
echo
du -sh "$CACHE_DIR"
echo
echo "Done. Cache will be cloned into the live image at the same path."
