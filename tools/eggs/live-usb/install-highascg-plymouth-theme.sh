#!/usr/bin/env bash
# Install HighAsCG Plymouth theme on the eggs build host (before eggs produce --clone).
#
# Uses two-step spinner: your branding frames as small throbber dots only (no large logo).
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

bash "${HERE}/install-initramfs-eggs-build-conf.sh"

if modinfo nvidia_drm &>/dev/null; then
	bash "${HERE}/install-plymouth-nvidia-initramfs.sh"
else
	echo "WARN: nvidia_drm not on build host — Plymouth animation may be black on NVIDIA ISO" >&2
fi

[[ -d "$SPINNER_DIR" ]] || {
	echo "Missing $SPINNER_DIR after apt install" >&2
	exit 1
}

echo "==> Plymouth theme: copy spinner base → ${THEME_DIR}"
rm -rf "$THEME_DIR"
mkdir -p "$THEME_DIR"
rsync -a --delete "${SPINNER_DIR}/" "${THEME_DIR}/"
rm -f "${THEME_DIR}"/animation-*.png "${THEME_DIR}"/throbber-*.png "${THEME_DIR}"/highascg.script 2>/dev/null || true

LOGO="${HERE}/branding/logo.png"
if [[ -f "$LOGO" ]]; then
	install -m 0644 -o root -g root "$LOGO" "${THEME_DIR}/watermark.png" 2>/dev/null || \
		cp -f "$LOGO" "${THEME_DIR}/watermark.png" 2>/dev/null || true
	echo "  optional watermark.png"
fi

install_png_sequence() {
	local src_dir="$1" prefix="$2" label="$3"
	[[ -d "$src_dir" ]] || return 1
	local frames=()
	local f
	shopt -s nullglob
	for f in "${src_dir}"/*.png; do
		frames+=("$f")
	done
	shopt -u nullglob
	[[ ${#frames[@]} -gt 0 ]] || return 1
	mapfile -t frames < <(printf '%s\n' "${frames[@]}" | sort -V)
	local i=1 idx
	for f in "${frames[@]}"; do
		printf -v idx '%04d' "$i"
		install -m 0644 -o root -g root "$f" "${THEME_DIR}/${prefix}-${idx}.png"
		i=$((i + 1))
	done
	echo "  ${label}: ${#frames[@]} frames → ${prefix}-0001 … ${prefix}-$(printf '%04d' ${#frames[@]})"
	return 0
}

bash "${HERE}/prepare-branding-assets.sh"

THROBBER_SRC="${HERE}/branding/plymouth/throbber-boot"
if [[ -d "$THROBBER_SRC" ]] && [[ -n "$(find "$THROBBER_SRC" -maxdepth 1 -name '*.png' -print -quit 2>/dev/null)" ]]; then
	sample="$(find "$THROBBER_SRC" -maxdepth 1 -name '*.png' | sort -V | head -1)"
	if file -b "$sample" | grep -q RGBA; then
		echo "ERROR: ${sample} still has alpha — run prepare-branding-assets.sh" >&2
		exit 1
	fi
	if ! install_png_sequence "$THROBBER_SRC" "throbber" "branding throbber (small spinner)"; then
		echo "ERROR: failed to install throbber frames from ${THROBBER_SRC}" >&2
		exit 1
	fi
else
	echo "WARN: no throbber-boot frames — restoring stock spinner throbber dots" >&2
	cp -a "${SPINNER_DIR}"/throbber-*.png "${THEME_DIR}/" 2>/dev/null || true
fi

# two-step: no large animation-*.png (throbber only)
rm -f "${THEME_DIR}"/animation-*.png 2>/dev/null || true

install -m 0644 -o root -g root "$PLYMOUTH_SRC" "${THEME_DIR}/highascg.plymouth"
echo "  Plymouth module: two-step (throbber spinner + boot messages below)"

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

# shellcheck source=eggs-kernel-lib.sh
source "${HERE}/eggs-kernel-lib.sh"
highascg_resolve_eggs_kernel
highascg_rebuild_host_initramfs "$KVER" "install-highascg-plymouth-theme.sh"

nthrob="$(find "$THEME_DIR" -maxdepth 1 -name 'throbber-*.png' 2>/dev/null | wc -l)"
nthrob="${nthrob//[[:space:]]/}"
echo "OK: Plymouth default = highascg (two-step throbber, ${nthrob} frames, initrd ${KVER})"
