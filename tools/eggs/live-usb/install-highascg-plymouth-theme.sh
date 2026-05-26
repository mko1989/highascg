#!/usr/bin/env bash
# Install HighAsCG Plymouth theme on the eggs build host (before eggs produce --clone).
#
# Replaces ubuntu-text (purple + Ubuntu wordmark) with dark HighAsCG spinner theme.
#
# Usage:
#   sudo bash tools/eggs/live-usb/install-highascg-plymouth-theme.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLYMOUTH_SRC="${HERE}/branding/plymouth/highascg.plymouth"
THEME_DIR=/usr/share/plymouth/themes/highascg
SPINNER_DIR=/usr/share/plymouth/themes/spinner
ALT_LINK=/usr/share/plymouth/themes/default.plymouth

[[ -f "$PLYMOUTH_SRC" ]] || {
	echo "Missing $PLYMOUTH_SRC" >&2
	exit 1
}

export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends \
	plymouth plymouth-theme-spinner plymouth-label

[[ -d "$SPINNER_DIR" ]] || {
	echo "Missing $SPINNER_DIR after apt install" >&2
	exit 1
}

echo "==> Plymouth theme: copy spinner assets → ${THEME_DIR}"
rm -rf "$THEME_DIR"
mkdir -p "$THEME_DIR"
rsync -a --delete "${SPINNER_DIR}/" "${THEME_DIR}/"
install -m 0644 -o root -g root "$PLYMOUTH_SRC" "${THEME_DIR}/highascg.plymouth"

LOGO="${HERE}/branding/logo.png"
if [[ -f "$LOGO" ]]; then
	install -m 0644 -o root -g root "$LOGO" "${THEME_DIR}/watermark.png" 2>/dev/null || \
		cp -f "$LOGO" "${THEME_DIR}/watermark.png" 2>/dev/null || true
	echo "  installed optional watermark.png"
fi

# Custom PNG sequences (two-step module): animation-0001.png …, throbber-0001.png …
install_png_sequence() {
	local src_dir="$1" prefix="$2" label="$3"
	[[ -d "$src_dir" ]] || return 0
	local frames=()
	local f
	shopt -s nullglob
	for f in "${src_dir}"/*.png; do
		frames+=("$f")
	done
	shopt -u nullglob
	[[ ${#frames[@]} -gt 0 ]] || return 0
	mapfile -t frames < <(printf '%s\n' "${frames[@]}" | sort)
	local i=1 idx
	for f in "${frames[@]}"; do
		printf -v idx '%04d' "$i"
		install -m 0644 -o root -g root "$f" "${THEME_DIR}/${prefix}-${idx}.png"
		i=$((i + 1))
	done
	echo "  ${label}: ${#frames[@]} frames → ${prefix}-0001 … ${prefix}-$(printf '%04d' ${#frames[@]})"
}

install_png_sequence "${HERE}/branding/plymouth/animation" "animation" "custom animation"
install_png_sequence "${HERE}/branding/plymouth/throbber" "throbber" "custom throbber (spinner dots)"

HOOK_SRC="${HERE}/etc-initramfs-tools-hooks-highascg.sh"
HOOK_DEST=/etc/initramfs-tools/hooks/highascg
echo "==> initramfs hook (always embed highascg theme in ISO /live/initrd)"
install -m 0755 -o root -g root "$HOOK_SRC" "$HOOK_DEST"

echo "==> Register default.plymouth alternative"
update-alternatives --install "$ALT_LINK" default.plymouth \
	"${THEME_DIR}/highascg.plymouth" 110 2>/dev/null || true
update-alternatives --set default.plymouth "${THEME_DIR}/highascg.plymouth"

if [[ -f /etc/plymouth/plymouthd.conf ]]; then
	if grep -q '^Theme=' /etc/plymouth/plymouthd.conf; then
		sed -i 's/^Theme=.*/Theme=highascg/' /etc/plymouth/plymouthd.conf
	else
		echo 'Theme=highascg' >>/etc/plymouth/plymouthd.conf
	fi
else
	mkdir -p /etc/plymouth
	echo -e '[Daemon]\nTheme=highascg' >/etc/plymouth/plymouthd.conf
fi

KVER="$(uname -r)"
echo "==> Rebuild initramfs for ${KVER} (eggs produce also runs mkinitramfs into ISO /live/)"
update-initramfs -u -k "$KVER"

echo "OK: Plymouth default theme = highascg (dark background, spinner dots, no Ubuntu text)"
