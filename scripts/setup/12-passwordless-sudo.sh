#!/usr/bin/env bash
# Install NOPASSWD sudoers for HighAsCG Web UI (nodm restart, reboot, optional eggs calamares).
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

DEST=/etc/sudoers.d/highascg
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cat >"$TMP" <<EOF
# HighAsCG privileged actions (strict allowlist) — installed by 12-passwordless-sudo.sh
# User: ${USER_CASPAR}
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl restart nodm, /usr/bin/systemctl restart nodm
${USER_CASPAR} ALL=(root) NOPASSWD: /sbin/reboot, /usr/sbin/reboot
${USER_CASPAR} ALL=(root) NOPASSWD: /bin/systemctl reboot, /usr/bin/systemctl reboot
EOF

if command -v eggs >/dev/null 2>&1 && [ -x /usr/bin/eggs ]; then
	echo "${USER_CASPAR} ALL=(root) NOPASSWD: /usr/bin/eggs calamares" >>"$TMP"
fi

visudo -cf "$TMP" >/dev/null
install -m 0440 -o root -g root "$TMP" "$DEST"

echo "OK: $DEST"
echo "     nodm restart, reboot$(command -v eggs >/dev/null 2>&1 && [ -x /usr/bin/eggs ] && echo ', eggs calamares' || echo '')"
echo
echo "Verify as ${USER_CASPAR}:"
echo "  sudo -u ${USER_CASPAR} sudo -n /usr/bin/systemctl restart nodm"
echo "  sudo -u ${USER_CASPAR} sudo -n /usr/bin/true"
