#!/usr/bin/env bash
# First-boot NVIDIA driver picker for HighAsCG live USB.
#
# Strategy:
#   - The image ships baked with one driver branch (default: 535) for the
#     common case, plus an offline deb cache at /opt/nvidia-pool containing
#     additional branches (e.g. 470 legacy, 580 latest).
#   - On first boot, ubuntu-drivers detects the GPU and recommends a branch.
#   - If the recommended branch already matches what's loaded -> stamp marker, exit.
#   - Otherwise: purge the stale branch, install the recommended one from
#     the offline cache, stamp marker, reboot.
#
# Idempotent: marker file at /var/lib/highascg/nvidia-installed prevents re-run.
# Logs to /var/log/highascg-pick-nvidia.log and journal.
set -euo pipefail

MARKER="/var/lib/highascg/nvidia-installed"
LOG="/var/log/highascg-pick-nvidia.log"
CACHE="${NVIDIA_DEB_POOL:-/opt/nvidia-pool}"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2; }

mkdir -p "$(dirname "$MARKER")" "$(dirname "$LOG")"
: > /dev/null  # ensure log file is writable
touch "$LOG"

if [[ -f "$MARKER" ]]; then
  log "Marker $MARKER present; nothing to do."
  exit 0
fi

if ! command -v ubuntu-drivers >/dev/null 2>&1; then
  log "ubuntu-drivers not installed; cannot pick. Stamping marker and bailing."
  touch "$MARKER"
  exit 0
fi

recommended_pkg="$(ubuntu-drivers devices 2>/dev/null \
  | grep -E 'nvidia-driver-[0-9]+.*recommended' \
  | head -1 \
  | grep -oE 'nvidia-driver-[0-9]+(-server)?' \
  | head -1 || true)"

if [[ -z "$recommended_pkg" ]]; then
  log "No recommended NVIDIA driver found (no NVIDIA GPU? unsupported model?). Skipping."
  touch "$MARKER"
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
  touch "$MARKER"
  exit 0
fi

dkms_pkg="${recommended_pkg/-driver-/-dkms-}"
dkms_pkg="${dkms_pkg%-server}"
log "Plan: install $recommended_pkg + $dkms_pkg"

declare -a APT_OPTS=(-y --no-install-recommends)
if [[ -d "$CACHE" ]] && compgen -G "$CACHE/*.deb" >/dev/null; then
  log "Using offline deb cache at $CACHE"
  APT_OPTS+=(-o "Dir::Cache::Archives=$CACHE")
else
  log "Offline cache empty/missing at $CACHE; will need network."
fi

if [[ -n "$loaded_branch" && "$loaded_branch" != "$recommended_branch" ]]; then
  log "Purging stale nvidia-driver-$loaded_branch and nvidia-dkms-$loaded_branch"
  apt-get purge -y "nvidia-driver-$loaded_branch" "nvidia-dkms-$loaded_branch" || true
  apt-get autoremove -y --purge || true
fi

log "Installing $recommended_pkg $dkms_pkg"
DEBIAN_FRONTEND=noninteractive apt-get install "${APT_OPTS[@]}" "$recommended_pkg" "$dkms_pkg"

touch "$MARKER"
log "Driver install complete. Rebooting in 5s so the new module loads."
sleep 5
systemctl reboot
