#!/usr/bin/env bash
# Bring the eggs produce host to production standard: systemd, stick boot, Calamares, verify.
#
# Run once (sudo password required):
#   cd ~/highascg
#   sudo bash work/bring-up-eggs-produce-host.sh
#
# Then produce:
#   sudo bash work/run-eggs-prepare-safe.sh
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
#
# Flash stick (includes drop-update seed with dist-web):
#   sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX
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

log "Passwordless sudo (Calamares + Nuclear UI)"
bash "${REPO}/scripts/setup/12-passwordless-sudo.sh" "$USER_CASPAR"

log "Caspar systemd units (scanner + server)"
bash "${REPO}/scripts/setup/13-caspar-systemd-units.sh" "$USER_CASPAR"

log "WO-47 exFAT + ISO clone prepare (systemd, nginx, excludes, dist-web for stick seed)"
bash "${LIVE_USB}/prepare-eggs-clone-with-exfat.sh" "$USER_CASPAR"

log "Stick / live boot robustness verify"
bash "${LIVE_USB}/verify-highascg-stick-boot.sh"

log "Calamares verify"
bash "${LIVE_USB}/verify-calamares-installed.sh"

log "Full prepare verify"
bash "${LIVE_USB}/verify-eggs-prepare-host.sh"

log "Clone host audit"
bash "${LIVE_USB}/audit-eggs-clone-host.sh"

log "Restart highascg (deadlock-safe unit)"
systemctl daemon-reload
systemctl restart highascg.service

echo
echo "OK: produce host is ready — stick boot fixes baked into next ISO clone."
echo
echo "Next:"
echo "  sudo bash work/run-eggs-prepare-safe.sh"
echo "  sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh"
echo "  sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX"
echo
