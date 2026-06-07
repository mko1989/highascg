#!/usr/bin/env bash
# Eggs PREPARE — check-only. Does NOT install packages, units, excludes, or run eggs produce.
#
# Verifies the host was configured by scripts/setup/ + prepare-eggs-clone-with-exfat.sh.
# Never touches /usr, /bin, liveroot while bind-mounted, or /home/eggs.
#
#   cd ~/highascg
#   sudo bash work/run-eggs-prepare-safe.sh
#
# Install missing pieces (one-shot):
#   sudo bash work/install-eggs-host-prereqs.sh
# Or step-by-step: scripts/setup/README.md + prepare-eggs-clone-with-exfat.sh
#
# After prepare checks pass:
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_USB="${REPO}/tools/eggs/live-usb"
# shellcheck source=../tools/eggs/live-usb/eggs-liveroot-safety.sh
source "${LIVE_USB}/eggs-liveroot-safety.sh"

log() { echo "==> $*"; }

log "Liveroot / bind-mount safety"
LIVEROOT="$(eggs_liveroot_default)"
if eggs_liveroot_has_host_bind_mounts "$LIVEROOT"; then
	echo "ERROR: ${LIVEROOT} has live system bind mounts — reboot before any eggs work." >&2
	eggs_liveroot_print_host_bind_mounts "$LIVEROOT"
	exit 1
fi
echo "  ok: no liveroot bind mounts (never rm /home/eggs)"

log "Prepare host verify (check-only)"
bash "${LIVE_USB}/verify-eggs-prepare-host.sh"

log "Clone host audit"
bash "${LIVE_USB}/audit-eggs-clone-host.sh"

log "Eggs safety wiring"
bash "${LIVE_USB}/verify-eggs-safety.sh"

echo
echo "OK: eggs PREPARE checks passed — host ready for produce."
echo
echo "Next:"
echo "  cp ~/highascg/config/casparcg.config ~/highascg/config/casparcg.config.bak.\$(date +%s)"
echo "  sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh"
echo
echo "Never rm /home/eggs. After interrupted produce: sudo reboot first."
