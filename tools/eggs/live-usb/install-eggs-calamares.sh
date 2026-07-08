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
#   HIGHASCG_ISO_EMBED_CALAMARES=0        skip (default 1)
#   HIGHASCG_FORCE_CALAMARES_REAPPLY=1    re-run eggs calamares even when verify passes
#
# Note: penguins-eggs 26.6.2 inverts `eggs calamares --nointeractive` — that flag
# *forces* the "Select yes to continue..." prompt instead of skipping it. Do not pass -n.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

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
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
THEME_ROOT="${HERE}/highascg-eggs-theme"
THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
FIX_SRC="${HERE}/fix-calamares-branding.sh"
FIX_DST=/usr/local/lib/highascg/fix-calamares-branding.sh

if ! command -v eggs >/dev/null 2>&1; then
	echo "ERROR: penguins-eggs (eggs) not installed — install eggs before Calamares bake" >&2
	exit 1
fi

[[ -d "${THEME_ABS}/theme/calamares" ]] || {
	echo "ERROR: missing ${THEME_ABS}/theme/calamares — run install-eggs-live-grub-theme.sh first" >&2
	exit 1
}

[[ -f "$FIX_SRC" ]] || {
	echo "ERROR: missing ${FIX_SRC}" >&2
	exit 1
}

install -d /usr/local/lib/highascg
install -m 0755 "$FIX_SRC" "$FIX_DST"

run_branding_fix() {
	bash "$FIX_DST"
}

if [[ "${HIGHASCG_FORCE_CALAMARES_REAPPLY:-0}" != "1" ]] \
	&& bash "${HERE}/verify-calamares-installed.sh" >/dev/null 2>&1; then
	echo "==> Calamares already installed and verified (skip eggs calamares re-apply)"
	echo "     force re-apply: HIGHASCG_FORCE_CALAMARES_REAPPLY=1"
elif command -v calamares >/dev/null 2>&1 \
	&& dpkg-query -W -f='${Status}' calamares 2>/dev/null | grep -qE '(install|hold) ok installed' \
	&& [[ -d /etc/calamares ]]; then
	echo "==> Calamares already installed ($(calamares --version 2>/dev/null | head -1 || echo calamares))"
	echo "==> Re-applying eggs calamares config (theme + policies; no --install)"
	eggs calamares --policies --verbose --theme="${THEME_ABS}"
else
	echo "==> Calamares for eggs produce (graphical install-to-disk on live ISO)"
	echo "==> eggs calamares --install (apt packages + incubator + policies)"
	eggs calamares --install --verbose --theme="${THEME_ABS}"
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

echo "==> Calamares branding logo (eggs 26.6.2 name mismatch — bake before squashfs clone)"
run_branding_fix

echo "==> Calamares shellprocess fixes (chroot PATH / offline l10n — avoid exit 127)"
bash "${HERE}/fix-calamares-shellprocess.sh"

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
	echo "ERROR: Calamares polkit policy missing" >&2
	exit 1
fi

if [[ -f "$EGGS_YAML" ]] && ! grep -qE '^force_installer:[[:space:]]+true' "$EGGS_YAML"; then
	echo "WARN: force_installer not true in $EGGS_YAML — eggs may prefer krill on ISO" >&2
fi

if ! eggs calamares --help >/dev/null 2>&1; then
	echo "ERROR: eggs calamares CLI not usable" >&2
	exit 1
fi

echo "==> Calamares verify (must pass before eggs produce)"
bash "${HERE}/verify-calamares-installed.sh"

BRANDING_UNIT="${REPO_ROOT}/scripts/systemd/highascg-calamares-branding.service"
if [[ -f "$BRANDING_UNIT" ]]; then
	install -m 0644 "$BRANDING_UNIT" /etc/systemd/system/highascg-calamares-branding.service
	systemctl daemon-reload
	systemctl enable highascg-calamares-branding.service
	echo "==> enabled highascg-calamares-branding.service (boot-time logo repair)"
fi

echo "OK: Calamares ready ($(calamares --version 2>/dev/null | head -1 || echo calamares))"
echo "     theme: ${THEME_ABS}"
echo "     config: /etc/calamares"
echo "     polkit: $(calamares_polkit_policy)"
echo "     branding fixer: ${FIX_DST}"
