#!/usr/bin/env bash
# Restore a bare Ubuntu host (with ~/highascg checkout) to full HighAsCG production.
#
# Installs: NVIDIA, DeckLink, NDI SDK, nodm/X11, CasparCG+CEF, scanner, Node,
# HighAsCG service, exFAT systemd units, firewall, Syncthing, Tailscale.
#
# Usage:
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash scripts/restore-production-host.sh
#   sudo HIGHASCG_NVIDIA_DRIVER=595 HIGHASCG_INSTALL_YES=1 bash scripts/restore-production-host.sh
#
# After install: reboot, then verify http://$(hostname -I | awk '{print $1}'):4200/
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo HIGHASCG_NVIDIA_DRIVER=595 $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"

echo "==> Fix ownership (restored home trees are often root:root)"
if ! id "$USER_CASPAR" &>/dev/null; then
	useradd -r -m -s "$(command -v nologin || echo /usr/sbin/nologin)" "$USER_CASPAR" 2>/dev/null || true
fi
chown -R "$USER_CASPAR:$USER_CASPAR" "/home/$USER_CASPAR"
chmod 755 "/home/$USER_CASPAR"

export HIGHASCG_NVIDIA_DRIVER="${HIGHASCG_NVIDIA_DRIVER:-595}"
export HIGHASCG_INSTALL_YES="${HIGHASCG_INSTALL_YES:-1}"

echo "==> HighAsCG production install from ${REPO}"
echo "    NVIDIA driver pin: ${HIGHASCG_NVIDIA_DRIVER}"
cd "$REPO"
exec bash ./scripts/install.sh
