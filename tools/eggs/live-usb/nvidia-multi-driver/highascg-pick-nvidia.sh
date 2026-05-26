#!/usr/bin/env bash
# First-boot NVIDIA driver picker for HighAsCG live USB.
#
# Strategy:
#   - The image ships baked with one driver branch (default: 535) for the
#     common case, plus an offline deb cache at /opt/nvidia-pool containing
#     additional branches (e.g. 580 / 595 alongside default 535 clone).
#   - On first boot, ubuntu-drivers detects the GPU and recommends a branch.
#   - If the recommended branch already matches what's loaded -> stamp marker, exit.
#   - Otherwise: purge the stale branch, install the recommended one from
#     the offline cache, stamp marker, reboot.
#
# Marker at /var/lib/highascg/nvidia-installed records GPU PCI id + branch so the
# same USB can move between machines: stale marker → re-pick recommended driver.
# Logs to /var/log/highascg-pick-nvidia.log and journal.
set -euo pipefail

MARKER="/var/lib/highascg/nvidia-installed"
LOG="/var/log/highascg-pick-nvidia.log"
CACHE="${NVIDIA_DEB_POOL:-/opt/nvidia-pool}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nvidia-pool-lib.sh
source "${HERE}/nvidia-pool-lib.sh"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2; }

nvidia_gpu_pci_id() {
  local line id
  line="$(lspci -nn 2>/dev/null | grep -iE 'vga|3d|display' | grep -i nvidia | head -1 || true)"
  [[ -n "$line" ]] || return 0
  id="${line%% *}"
  printf '%s\n' "${id%:}"
}

read_marker_field() {
  local key="$1" val=""
  [[ -f "$MARKER" ]] || return 1
  val="$(grep -E "^${key}=" "$MARKER" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  [[ -n "$val" ]] || return 1
  printf '%s\n' "$val"
}

write_marker() {
  local gpu="$1" branch="$2"
  mkdir -p "$(dirname "$MARKER")"
  cat >"$MARKER" <<EOF
# Written by highascg-pick-nvidia.sh — safe to delete to force a re-pick
gpu_pci=${gpu}
branch=${branch}
EOF
}

marker_matches_current_gpu_and_branch() {
  local gpu="$1" branch="$2"
  local m_gpu m_branch
  m_gpu="$(read_marker_field gpu_pci || true)"
  m_branch="$(read_marker_field branch || true)"
  [[ -n "$m_gpu" && -n "$m_branch" && "$m_gpu" == "$gpu" && "$m_branch" == "$branch" ]]
}

mkdir -p "$(dirname "$MARKER")" "$(dirname "$LOG")"
: > /dev/null  # ensure log file is writable
touch "$LOG"

GPU_PCI="$(nvidia_gpu_pci_id)"
log "NVIDIA PCI id (if any): ${GPU_PCI:-none}"

if ! command -v ubuntu-drivers >/dev/null 2>&1; then
  log "ubuntu-drivers not installed; cannot pick. Stamping marker and bailing."
  write_marker "${GPU_PCI:-unknown}" "skip-no-ubuntu-drivers"
  exit 0
fi

recommended_pkg="$(ubuntu-drivers devices 2>/dev/null \
  | grep -E 'nvidia-driver-[0-9]+.*recommended' \
  | head -1 \
  | grep -oE 'nvidia-driver-[0-9]+(-server)?' \
  | head -1 || true)"

if [[ -z "$recommended_pkg" ]]; then
  log "No recommended NVIDIA driver found (no NVIDIA GPU? unsupported model?). Skipping."
  write_marker "${GPU_PCI:-unknown}" "skip-no-recommendation"
  exit 0
fi
log "ubuntu-drivers recommends: $recommended_pkg"

recommended_branch="$(echo "$recommended_pkg" | grep -oE '[0-9]+' | head -1)"

loaded_branch=""
if lsmod | awk '{print $1}' | grep -qx 'nvidia'; then
  loaded_version="$(modinfo nvidia 2>/dev/null | awk '/^version:/ {print $2; exit}' || true)"
  loaded_branch="${loaded_version%%.*}"
  log "Currently loaded NVIDIA: version=$loaded_version branch=$loaded_branch"
else
  log "No nvidia kernel module currently loaded."
fi

if [[ -n "$loaded_branch" && "$loaded_branch" == "$recommended_branch" ]]; then
  log "Loaded branch ($loaded_branch) matches recommendation ($recommended_branch). No swap needed."
  write_marker "${GPU_PCI:-unknown}" "$recommended_branch"
  exit 0
fi

if marker_matches_current_gpu_and_branch "${GPU_PCI:-unknown}" "$recommended_branch"; then
  log "Marker matches this GPU and recommended branch $recommended_branch but module mismatch (loaded=${loaded_branch:-none}); continuing install path."
else
  if [[ -f "$MARKER" ]]; then
    log "Marker stale for this machine (marker gpu=$(read_marker_field gpu_pci || echo '?') branch=$(read_marker_field branch || echo '?')); re-picking."
    rm -f "$MARKER"
  fi
fi

recommended_pkg="$(nvidia_pool_map_recommended_pkg "$recommended_pkg")"
dkms_pkg="$(nvidia_pool_map_recommended_dkms "$recommended_pkg")"
log "Plan: install $recommended_pkg + $dkms_pkg (flavor=$(nvidia_pool_read_flavor))"

declare -a APT_OPTS=(-y --no-install-recommends)
if [[ -d "$CACHE" ]] && compgen -G "$CACHE/*.deb" >/dev/null; then
  log "Using offline deb cache at $CACHE"
  APT_OPTS+=(-o "Dir::Cache::Archives=$CACHE")
else
  log "Offline cache empty/missing at $CACHE; will need network."
fi

if [[ -n "$loaded_branch" && "$loaded_branch" != "$recommended_branch" ]]; then
  log "Purging stale NVIDIA packages for branch $loaded_branch"
  apt-get purge -y \
    "nvidia-driver-$loaded_branch" "nvidia-dkms-$loaded_branch" \
    "nvidia-driver-${loaded_branch}-open" "nvidia-dkms-${loaded_branch}-open" 2>/dev/null || true
  apt-get autoremove -y --purge || true
fi

log "Installing $recommended_pkg $dkms_pkg"
DEBIAN_FRONTEND=noninteractive apt-get install "${APT_OPTS[@]}" "$recommended_pkg" "$dkms_pkg"

write_marker "${GPU_PCI:-unknown}" "$recommended_branch"
log "Driver install complete. Rebooting in 5s so the new module loads."
sleep 5
systemctl reboot
