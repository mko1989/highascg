#!/usr/bin/env bash
# Point penguins-eggs at the HighAsCG livecd GRUB/isolinux theme (persistence default)
# and install GRUB + Plymouth branding.
#
# Usage:
#   sudo bash tools/eggs/live-usb/install-eggs-live-grub-theme.sh
#
# Optional artwork: tools/eggs/live-usb/branding/splash.png (GRUB background)
# See tools/eggs/live-usb/branding/README.md
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_ROOT="${HERE}/highascg-eggs-theme"
BRANDING="${HERE}/branding"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
EGGS_LIVECD="${EGGS_LIVECD:-/usr/lib/penguins-eggs/addons/eggs/theme/livecd}"
EGGS_THEME="${EGGS_THEME:-/usr/lib/penguins-eggs/addons/eggs/theme}"

[[ -f "${THEME_ROOT}/theme/livecd/grub.main.cfg" ]] || {
	echo "Missing ${THEME_ROOT}/theme/livecd/grub.main.cfg" >&2
	exit 1
}
[[ -d "$EGGS_LIVECD" ]] || {
	echo "penguins-eggs livecd theme not found at $EGGS_LIVECD — install eggs first." >&2
	exit 1
}
[[ -f "$EGGS_YAML" ]] || {
	echo "Missing $EGGS_YAML — run eggs configuration once." >&2
	exit 1
}

THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
LIVE="${THEME_ABS}/theme/livecd"
mkdir -p "$LIVE"

echo "==> GRUB theme.cfg (HighAsCG colours)"
[[ -f "${LIVE}/grub.theme.cfg" ]] || {
	echo "Missing ${LIVE}/grub.theme.cfg" >&2
	exit 1
}
chmod 0644 "${LIVE}/grub.theme.cfg"

if [[ -f "${BRANDING}/splash.png" ]]; then
	echo "==> GRUB/isolinux splash from branding/splash.png"
	install -m 0644 -o root -g root "${BRANDING}/splash.png" "${LIVE}/splash.png"
else
	echo "ERROR: Missing ${BRANDING}/splash.png — GRUB will show eggs penguins on the ISO." >&2
	echo "       Copy your wallpaper to branding/splash.png (see branding/README.md)." >&2
	exit 1
fi

for f in isolinux.theme.cfg; do
	src="${EGGS_LIVECD}/${f}"
	[[ -e "$src" ]] || continue
	ln -sfn "$src" "${LIVE}/${f}"
done

for d in calamares applications artwork; do
	[[ -d "${EGGS_THEME}/${d}" ]] || continue
	ln -sfn "${EGGS_THEME}/${d}" "${THEME_ABS}/theme/${d}"
done

if grep -q '^theme:' "$EGGS_YAML"; then
	sed -i "s|^theme:.*|theme: ${THEME_ABS}|" "$EGGS_YAML"
else
	printf '\ntheme: %s\n' "$THEME_ABS" >>"$EGGS_YAML"
fi

echo "==> Plymouth boot splash (replaces Ubuntu purple screen)"
bash "${HERE}/install-highascg-plymouth-theme.sh"

echo "OK: eggs theme → ${THEME_ABS}"
echo "     GRUB: default Live entry includes persistence on the kernel line"
echo "     Plymouth: highascg (see branding/README.md)"
grep '^theme:' "$EGGS_YAML"
echo
echo "IMPORTANT: eggs produce ignores eggs.yaml theme: unless you pass --theme."
echo "  build-highascg-egg.sh passes: eggs produce ... --theme ${THEME_ABS}"
echo "  Manual: sudo eggs produce --nointeractive --clone --max --basename highascg --theme ${THEME_ABS}"
