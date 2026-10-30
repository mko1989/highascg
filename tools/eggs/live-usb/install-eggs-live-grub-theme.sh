#!/usr/bin/env bash
# Point penguins-eggs at the HighAsCG livecd GRUB/isolinux theme (persistence default)
# and install GRUB + Plymouth branding.
# New eggs (WO-870): prepares the repo theme + Plymouth only; the eggs.yaml `theme:` edit is legacy-only.
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
# WO-832: eggs >= 26.10 keeps the stock theme in /etc/penguins-eggs.d/branding.default (older: /usr/lib/penguins-eggs/…).
# shellcheck source=eggs-theme-lib.sh
source "${HERE}/eggs-theme-lib.sh"
if EGGS_THEME="$(highascg_eggs_theme_dir)"; then
	EGGS_LIVECD="${EGGS_LIVECD:-${EGGS_THEME}/livecd}"
else
	EGGS_THEME="${EGGS_THEME:-/etc/penguins-eggs.d/branding.default}"
	EGGS_LIVECD="${EGGS_LIVECD:-${EGGS_THEME}/livecd}"
fi

[[ -f "${THEME_ROOT}/theme/livecd/grub.main.cfg" ]] || {
	echo "Missing ${THEME_ROOT}/theme/livecd/grub.main.cfg" >&2
	exit 1
}
[[ -d "$EGGS_LIVECD" ]] || {
	echo "penguins-eggs livecd theme not found at $EGGS_LIVECD (also tried /usr/lib/penguins-eggs/addons/eggs/theme) — install eggs first." >&2
	exit 1
}
# WO-870: only the legacy eggs reads eggs.yaml `theme:`. The new one (Go rewrite) takes the theme from
# <conf>/branding/livecd/, copied from this repo theme by install-eggs-config.sh --apply right before eggs runs.
# shellcheck source=eggs-cli-lib.sh
source "${HERE}/eggs-cli-lib.sh"
EGGS_FLAVOR="$(highascg_eggs_flavor)"
if [[ "$EGGS_FLAVOR" == "legacy" && ! -f "$EGGS_YAML" ]]; then
	echo "Missing $EGGS_YAML — run eggs configuration once." >&2
	exit 1
fi

THEME_ABS="$(cd "$THEME_ROOT" && pwd)"
LIVE="${THEME_ABS}/theme/livecd"
mkdir -p "$LIVE"

echo "==> GRUB theme.cfg (HighAsCG colours)"
[[ -f "${LIVE}/grub.theme.cfg" ]] || {
	echo "Missing ${LIVE}/grub.theme.cfg" >&2
	exit 1
}
chmod 0644 "${LIVE}/grub.theme.cfg"

if [[ ! -f "${BRANDING}/splash.png" ]]; then
	echo "ERROR: Missing ${BRANDING}/splash.png — GRUB will show eggs penguins on the ISO." >&2
	echo "       Copy your wallpaper to branding/splash.png (see branding/README.md)." >&2
	exit 1
fi

echo "==> Prepare boot-ready splash + Plymouth frames (RGB PNG for GRUB)"
bash "${HERE}/prepare-branding-assets.sh"

if [[ -f "${BRANDING}/splash.boot.png" ]]; then
	echo "==> GRUB/isolinux splash from branding/splash.boot.png"
	install -m 0644 -o root -g root "${BRANDING}/splash.boot.png" "${LIVE}/splash.png"
	[[ -f "${BRANDING}/splash.boot.jpg" ]] && \
		install -m 0644 -o root -g root "${BRANDING}/splash.boot.jpg" "${LIVE}/splash.jpg"
else
	echo "==> GRUB/isolinux splash from branding/splash.png (prepare step skipped)"
	install -m 0644 -o root -g root "${BRANDING}/splash.png" "${LIVE}/splash.png"
fi

install -m 0644 -o root -g root "${HERE}/isolinux.theme.cfg" "${LIVE}/isolinux.theme.cfg"

for d in applications artwork; do
	[[ -d "${EGGS_THEME}/${d}" ]] || continue
	ln -sfn "${EGGS_THEME}/${d}" "${THEME_ABS}/theme/${d}"
done

# WO-148: theme/calamares must be the REAL repo directory (HighAsCG slideshow).
# Never symlink it to ${EGGS_THEME}/calamares — that is exactly how the stock
# penguins-eggs slideshow used to reach the ISO installer.
CAL_DIR="${THEME_ABS}/theme/calamares"
if [[ -L "$CAL_DIR" ]]; then
	echo "==> Removing legacy theme/calamares symlink → stock eggs artwork (penguins slideshow)"
	rm -f "$CAL_DIR"
fi
if [[ ! -f "${CAL_DIR}/branding/show.qml" ]] || ! grep -q 'HighAsCG' "${CAL_DIR}/branding/show.qml"; then
	echo "ERROR: missing HighAsCG Calamares slideshow at ${CAL_DIR}/branding/show.qml" >&2
	echo "       (repo checkout incomplete? theme/calamares must be a real directory, not a symlink)" >&2
	exit 1
fi
# Keep installer module configs in sync with the eggs defaults (real files, not symlinks)
if [[ -d "${EGGS_THEME}/calamares/modules" ]]; then
	mkdir -p "${CAL_DIR}/modules"
	cp -Lf "${EGGS_THEME}/calamares/modules/"*.yaml "${CAL_DIR}/modules/" 2>/dev/null || true
fi

if [[ "$EGGS_FLAVOR" != "legacy" ]]; then
	: # new eggs: no yaml theme key (see above)
elif grep -q '^theme:' "$EGGS_YAML"; then
	sed -i "s|^theme:.*|theme: ${THEME_ABS}|" "$EGGS_YAML"
else
	printf '\ntheme: %s\n' "$THEME_ABS" >>"$EGGS_YAML"
fi

echo "==> Plymouth boot splash (replaces Ubuntu purple screen)"
bash "${HERE}/install-highascg-plymouth-theme.sh"

nthrob="$(find /usr/share/plymouth/themes/highascg -maxdepth 1 -name 'throbber-*.png' 2>/dev/null | wc -l)"
nthrob="${nthrob//[[:space:]]/}"
PLYMOUTH_NOTE="highascg throbber-script (${nthrob} frames top-right + status log left)"
echo "OK: eggs theme → ${THEME_ABS}"
echo "     GRUB: default Live entry (exFAT-only; no union persistence on kernel line)"
echo "     Plymouth: ${PLYMOUTH_NOTE} (see branding/README.md)"
if [[ "$EGGS_FLAVOR" != "legacy" ]]; then
	echo "     eggs ${EGGS_FLAVOR}: theme reaches the ISO via $(highascg_eggs_branding_dir)/livecd/"
	echo "       (sudo bash ${HERE}/install-eggs-config.sh --apply; build-highascg-egg.sh runs it before eggs remaster)"
	exit 0
fi
grep '^theme:' "$EGGS_YAML"
echo
echo "IMPORTANT (legacy eggs only): eggs produce ignores eggs.yaml theme: unless you pass --theme."
echo "  build-highascg-egg.sh passes: eggs produce ... --theme ${THEME_ABS}"
echo "  Manual: sudo eggs produce --nointeractive --clone --max --basename highascg --theme ${THEME_ABS}"
