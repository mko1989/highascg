#!/usr/bin/env bash
# Install everything verify-eggs-prepare-host.sh checks for (run once on a fresh host).
# Prepare itself stays check-only: work/run-eggs-prepare-safe.sh
#
#   cd ~/highascg
#   sudo bash work/install-eggs-host-prereqs.sh
#
# Then verify:
#   sudo bash work/run-eggs-prepare-safe.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_USB="${REPO}/tools/eggs/live-usb"
USER_CASPAR="${USER_CASPAR:-casparcg}"

log() { echo "==> $*"; }

log "APT: exfatprogs parted (WO-47 stick tooling)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y exfatprogs parted

log "penguins-eggs + host boot branding (installs eggs binary)"
bash "${REPO}/work/setup-boot-branding-phase1.sh"

log "WO-47 systemd units"
bash "${REPO}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"

log "WO-47 stubs, exfat-sync, exclude.list, eggs GRUB theme"
SKIP_APT=1 HIGHASCG_SKIP_BOOT_BRANDING_IN_PREPARE=0 SKIP_HIGHASCG_SYSTEMD_RESTART=1 \
	bash "${LIVE_USB}/prepare-eggs-clone-with-exfat.sh" "$USER_CASPAR"

log "Re-check prepare"
bash "${LIVE_USB}/verify-eggs-prepare-host.sh"

echo
echo "OK: eggs host prereqs installed. Run: sudo bash work/run-eggs-prepare-safe.sh"
