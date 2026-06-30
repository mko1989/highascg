#!/usr/bin/env bash
# Verify NOPASSWD sudoers required by the Web UI (Tailscale, Calamares, Caspar, nodm).
# Read-only — does not run privileged actions.
#
# Usage (on booted stick):
#   bash ~/highascg/tools/startup/verify-passwordless-sudo.sh
set -euo pipefail

USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
FAIL=0

ok() { echo "OK: $*"; }
bad() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

echo "=== Passwordless sudo (Web UI / Tailscale / Nuclear) ==="

if [[ -f /etc/sudoers.d/highascg ]]; then
	ok "/etc/sudoers.d/highascg present"
else
	bad "/etc/sudoers.d/highascg missing — ISO built without scripts/setup/12-passwordless-sudo.sh (re-run prepare + produce)"
	echo "  On build host: sudo bash scripts/setup/12-passwordless-sudo.sh ${USER_CASPAR}" >&2
fi

if ! id "$USER_CASPAR" &>/dev/null; then
	bad "user ${USER_CASPAR} does not exist"
fi

SUDO_L=""
if id "$USER_CASPAR" &>/dev/null; then
	SUDO_L="$(sudo -u "$USER_CASPAR" sudo -n -l 2>/dev/null || true)"
fi

need_sudo_rule() {
	local needle="$1"
	local label="$2"
	if [[ -n "$SUDO_L" ]] && grep -qF "$needle" <<<"$SUDO_L"; then
		ok "NOPASSWD: ${label}"
	else
		bad "NOPASSWD missing for ${label} — rebuild ISO after 12-passwordless-sudo.sh"
	fi
}

need_sudo_rule 'highascg-tailscale-up.sh' 'Tailscale login (/usr/local/lib/highascg/highascg-tailscale-up.sh)'
need_sudo_rule 'tailscale logout' 'Tailscale logout'
need_sudo_rule 'tailscaled' 'tailscaled systemctl'
need_sudo_rule 'launch-calamares.sh' 'Calamares install-to-disk'
need_sudo_rule 'caspar-systemd-control.sh' 'Caspar stop/start'

if [[ -x /usr/local/lib/highascg/highascg-tailscale-up.sh ]]; then
	ok "tailscale helper installed (/usr/local/lib/highascg/highascg-tailscale-up.sh)"
else
	bad "missing /usr/local/lib/highascg/highascg-tailscale-up.sh — installed by 12-passwordless-sudo.sh"
fi

if [[ -x /usr/local/bin/launch-calamares.sh ]]; then
	ok "launch-calamares.sh installed"
else
	bad "missing /usr/local/bin/launch-calamares.sh"
fi

if [[ -x /usr/local/bin/caspar-systemd-control.sh ]]; then
	ok "caspar-systemd-control.sh installed"
else
	bad "missing /usr/local/bin/caspar-systemd-control.sh"
fi

if command -v tailscale >/dev/null 2>&1 || [[ -x /snap/bin/tailscale ]]; then
	ok "tailscale CLI present"
else
	bad "tailscale CLI not installed on this image"
fi

echo ""
echo "Quick manual tests (as ${USER_CASPAR}):"
echo "  sudo -n /usr/local/lib/highascg/highascg-tailscale-up.sh   # starts login (needs tailscaled)"
echo "  sudo -n /usr/local/bin/launch-calamares.sh --check"
echo "  sudo -n /usr/local/bin/caspar-systemd-control.sh status"

echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "Passwordless sudo verify FAILED (${FAIL} error(s))." >&2
	exit 1
fi
echo "Passwordless sudo verify passed."
exit 0
