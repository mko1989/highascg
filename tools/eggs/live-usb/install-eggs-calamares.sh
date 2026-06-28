#!/usr/bin/env bash
# Install Calamares + eggs incubator config on the clone host before `eggs produce --clone`.
#
# eggs produce --nointeractive does NOT auto-install Calamares; the binary must exist on
# the host before produce or you get: "calamares is available, but NOT installed".
#
# Usage (root):
#   sudo bash tools/eggs/live-usb/install-eggs-calamares.sh
#
# Optional env:
#   HIGHASCG_ISO_EMBED_CALAMARES=0   skip (default 1)
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

EMBED="${HIGHASCG_ISO_EMBED_CALAMARES:-1}"
if [[ "$EMBED" != "1" ]]; then
	echo "==> HIGHASCG_ISO_EMBED_CALAMARES=0 — skipping Calamares install"
	exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_ROOT="${HERE}/highascg-eggs-theme"
THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"

if ! command -v eggs >/dev/null 2>&1; then
	echo "ERROR: penguins-eggs (eggs) not installed — install eggs before Calamares bake" >&2
	exit 1
fi

[[ -d "${THEME_ABS}/theme/calamares" ]] || {
	echo "ERROR: missing ${THEME_ABS}/theme/calamares — run install-eggs-live-grub-theme.sh first" >&2
	exit 1
}

if command -v calamares >/dev/null 2>&1 \
	&& dpkg-query -W -f='${Status}' calamares 2>/dev/null | grep -qE '(install|hold) ok installed' \
	&& [[ -d /etc/calamares ]]; then
	echo "==> Calamares already installed ($(calamares --version 2>/dev/null | head -1 || echo calamares))"
	echo "==> Re-applying eggs calamares config (theme + policies)"
	eggs calamares --install --nointeractive --verbose --theme="${THEME_ABS}"
else
	echo "==> Calamares for eggs produce (graphical install-to-disk on live ISO)"
	echo "==> eggs calamares --install (apt packages + incubator + policies)"
	eggs calamares --install --nointeractive --verbose --theme="${THEME_ABS}"
fi

if ! command -v calamares >/dev/null 2>&1; then
	echo "ERROR: calamares binary missing after eggs calamares --install" >&2
	exit 1
fi

if ! dpkg-query -W -f='${Status}' calamares 2>/dev/null | grep -qE '(install|hold) ok installed'; then
	echo "ERROR: dpkg reports calamares not installed" >&2
	exit 1
fi

if [[ ! -d /etc/calamares ]]; then
	echo "ERROR: /etc/calamares missing after eggs calamares --install" >&2
	exit 1
fi

calamares_polkit_policy() {
	local p
	for p in \
		/usr/share/polkit-1/actions/com.github.calamares.calamares.policy \
		/usr/share/polkit-1/actions/io.calamares.calamares.policy; do
		[[ -f "$p" ]] && {
			echo "$p"
			return 0
		}
	done
	return 1
}

if ! calamares_polkit_policy >/dev/null; then
	echo "ERROR: Calamares polkit policy missing (expected com.github.calamares.calamares.policy or io.calamares.calamares.policy)" >&2
	exit 1
fi

if [[ -f "$EGGS_YAML" ]] && ! grep -qE '^force_installer:[[:space:]]+true' "$EGGS_YAML"; then
	echo "WARN: force_installer not true in $EGGS_YAML — eggs may prefer krill on ISO" >&2
fi

if ! eggs calamares --help >/dev/null 2>&1; then
	echo "ERROR: eggs calamares CLI not usable" >&2
	exit 1
fi

echo "OK: Calamares ready ($(calamares --version 2>/dev/null | head -1 || echo calamares))"
echo "     theme: ${THEME_ABS}"
echo "     config: /etc/calamares"
echo "     polkit: $(calamares_polkit_policy)"
