#!/usr/bin/env bash
# Check-only: Calamares is installed the way eggs produce expects (Pacman.calamaresExists).
#
#   sudo bash tools/eggs/live-usb/verify-calamares-installed.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
FAIL=0

fail() {
	echo "ERROR: $*" >&2
	FAIL=$((FAIL + 1))
}
ok() {
	echo "OK: $*"
}

EMBED="${HIGHASCG_ISO_EMBED_CALAMARES:-1}"
if [[ "$EMBED" != "1" ]]; then
	echo "HIGHASCG_ISO_EMBED_CALAMARES=0 — skipping Calamares checks"
	exit 0
fi

if command -v calamares >/dev/null 2>&1 && [[ -x /usr/bin/calamares ]]; then
	ok "binary /usr/bin/calamares ($(calamares --version 2>/dev/null | head -1 || echo installed))"
else
	fail "missing /usr/bin/calamares — sudo bash ${HERE}/install-eggs-calamares.sh"
fi

if dpkg-query -W -f='${Status}' calamares 2>/dev/null | grep -qE '(install|hold) ok installed'; then
	ok "dpkg calamares"
else
	fail "dpkg calamares not installed"
fi

[[ -d /etc/calamares ]] && ok "/etc/calamares" \
	|| fail "missing /etc/calamares — run install-eggs-calamares.sh"

BRAND="/etc/calamares/branding/highascg-eggs-theme"
if [[ -f "${BRAND}/branding.desc" ]]; then
	ok "branding ${BRAND}/branding.desc"
	icon="$(awk -F': *' '/^[[:space:]]*productIcon:/{print $2; exit}' "${BRAND}/branding.desc" | tr -d ' \"')"
	logo="$(awk -F': *' '/^[[:space:]]*productLogo:/{print $2; exit}' "${BRAND}/branding.desc" | tr -d ' \"')"
	for want in "$icon" "$logo"; do
		[[ -n "$want" ]] || continue
		if [[ -f "${BRAND}/${want}" ]]; then
			ok "branding image ${want}"
		else
			fail "missing ${BRAND}/${want} — re-run install-eggs-calamares.sh (eggs logo name mismatch)"
		fi
	done
else
	fail "missing ${BRAND}/branding.desc — run install-eggs-calamares.sh"
fi

if [[ -f /usr/share/polkit-1/actions/com.github.calamares.calamares.policy ]]; then
	ok "polkit policy (com.github.calamares.calamares.policy)"
elif [[ -f /usr/share/polkit-1/actions/io.calamares.calamares.policy ]]; then
	ok "polkit policy (io.calamares.calamares.policy)"
else
	fail "missing Calamares polkit policy under /usr/share/polkit-1/actions/"
fi

if command -v eggs >/dev/null 2>&1 && eggs calamares --help >/dev/null 2>&1; then
	ok "eggs calamares CLI"
else
	fail "eggs calamares CLI unavailable"
fi

USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
if [[ -x /usr/local/bin/launch-calamares.sh ]]; then
	ok "launcher /usr/local/bin/launch-calamares.sh"
else
	fail "missing /usr/local/bin/launch-calamares.sh — sudo bash ${REPO_ROOT}/scripts/setup/13-caspar-systemd-units.sh"
fi

if [[ -f /etc/sudoers.d/highascg ]] \
	&& sudo -u "$USER_CASPAR" sudo -n -l 2>/dev/null | grep -q 'launch-calamares.sh'; then
	ok "passwordless sudo for launch-calamares (${USER_CASPAR})"
else
	fail "passwordless sudo for Calamares missing — sudo bash ${REPO_ROOT}/scripts/setup/12-passwordless-sudo.sh ${USER_CASPAR}"
fi

if [[ "$FAIL" -gt 0 ]]; then
	echo "Calamares verify FAILED (${FAIL} error(s))." >&2
	exit 1
fi
echo "Calamares verify passed."
exit 0
