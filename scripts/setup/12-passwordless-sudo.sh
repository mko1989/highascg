#!/usr/bin/env bash
# Install NOPASSWD sudoers for HighAsCG Web UI (nodm restart, reboot, Calamares, Caspar systemd).
#
#   sudo bash scripts/setup/12-passwordless-sudo.sh [casparcg]
#
# See docs/HIGHASCG_PASSWORDLESS_SUDO.md
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

USER_CASPAR="${1:-casparcg}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}

PLAYOUT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p /usr/local/lib/highascg
if [[ -f "$PLAYOUT/tools/runtime/highascg-tailscale-up.sh" ]]; then
	install -m 0755 -o root -g root "$PLAYOUT/tools/runtime/highascg-tailscale-up.sh" /usr/local/lib/highascg/highascg-tailscale-up.sh
fi

DEST=/etc/sudoers.d/highascg
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cat >"$TMP" <<EOF
# HighAsCG privileged actions (strict allowlist) — installed by 12-passwordless-sudo.sh
# User: ${USER_CASPAR}
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl restart nodm, /usr/bin/systemctl restart nodm
${USER_CASPAR} ALL=(root) NOPASSWD: /sbin/reboot, /usr/sbin/reboot
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl reboot, /usr/bin/systemctl reboot
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/local/bin/launch-calamares.sh
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/local/bin/launch-calamares.sh --check
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/calamares -d
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/local/bin/caspar-systemd-control.sh
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl start casparcg-scanner.service, /usr/bin/systemctl start casparcg-scanner.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl stop casparcg-scanner.service, /usr/bin/systemctl stop casparcg-scanner.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl restart casparcg-scanner.service, /usr/bin/systemctl restart casparcg-scanner.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl start casparcg-server.service, /usr/bin/systemctl start casparcg-server.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl stop casparcg-server.service, /usr/bin/systemctl stop casparcg-server.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl restart casparcg-server.service, /usr/bin/systemctl restart casparcg-server.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl is-active casparcg-scanner.service, /usr/bin/systemctl is-active casparcg-scanner.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl is-active casparcg-server.service, /usr/bin/systemctl is-active casparcg-server.service
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/local/lib/highascg/highascg-operator-snap-home.sh
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl enable --now tailscaled, /usr/bin/systemctl enable --now tailscaled
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl start tailscaled, /usr/bin/systemctl start tailscaled
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl stop tailscaled, /usr/bin/systemctl stop tailscaled
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl start snap.tailscale.tailscaled.service, /usr/bin/systemctl start snap.tailscale.tailscaled.service
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl stop snap.tailscale.tailscaled.service, /usr/bin/systemctl stop snap.tailscale.tailscaled.service
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/tailscale logout, /snap/bin/tailscale logout
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/tailscale up
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/tailscale up *
${USER_CASPAR} ALL=(root) NOPASSWD: /snap/bin/tailscale up
${USER_CASPAR} ALL=(root) NOPASSWD: /snap/bin/tailscale up *
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/local/lib/highascg/highascg-tailscale-up.sh
EOF

if command -v eggs >/dev/null 2>&1 && [ -x /usr/bin/eggs ]; then
	cat >>"$TMP" <<EOF
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/eggs calamares
${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/eggs calamares --install *
EOF
fi

visudo -cf "$TMP" >/dev/null
install -m 0440 -o root -g root "$TMP" "$DEST"

echo "OK: $DEST"
echo "     nodm restart, reboot, launch-calamares, caspar-systemd-control, tailscale, operator-snap-home$(command -v eggs >/dev/null 2>&1 && [ -x /usr/bin/eggs ] && echo ', eggs calamares (+ --install)' || echo '')"
echo
echo "Verify as ${USER_CASPAR}:"
echo "  sudo -u ${USER_CASPAR} sudo -n /usr/local/bin/caspar-systemd-control.sh status"
