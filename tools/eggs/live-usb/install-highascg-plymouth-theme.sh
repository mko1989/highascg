#!/usr/bin/env bash
# Install HighAsCG Plymouth theme on the eggs build host (before eggs produce --clone).
#
# Default: script theme — boot status lines on the left + throbber-boot/ (4 frames) top-right.
# Optional: HIGHASCG_PLYMOUTH_FULL_ANIM=1 → large mascot animation right 1/3 (30 frames).
# Optional: HIGHASCG_PLYMOUTH_TWO_STEP=1 → legacy Ubuntu two-step (no left log panel).
#
# Usage:
#   sudo bash tools/eggs/live-usb/install-highascg-plymouth-theme.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_DIR=/usr/share/plymouth/themes/highascg
SPINNER_DIR=/usr/share/plymouth/themes/spinner
ALT_LINK=/usr/share/plymouth/themes/default.plymouth
ANIM_BOOT="${HERE}/branding/plymouth/animation-boot"
THROBBER_SRC="${HERE}/branding/plymouth/throbber-boot"
SCRIPT_FULL_IN="${HERE}/branding/plymouth/highascg.script.in"
SCRIPT_THROBBER_IN="${HERE}/branding/plymouth/highascg-throbber.script.in"
PLYMOUTH_FULL="${HERE}/branding/plymouth/highascg-script.plymouth"
PLYMOUTH_THROBBER="${HERE}/branding/plymouth/highascg-throbber.plymouth"
PLYMOUTH_TWO_STEP="${HERE}/branding/plymouth/highascg.plymouth"

export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends \
	plymouth plymouth-theme-spinner plymouth-label

bash "${HERE}/install-initramfs-eggs-build-conf.sh"

if modinfo nvidia_drm &>/dev/null; then
	bash "${HERE}/install-plymouth-nvidia-initramfs.sh"
else
	echo "WARN: nvidia_drm not on build host — Plymouth animation may be black on NVIDIA ISO" >&2
fi

bash "${HERE}/prepare-branding-assets.sh"

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

theme_mode="throbber-script"
if [[ "${HIGHASCG_PLYMOUTH_TWO_STEP:-0}" == "1" ]]; then
	theme_mode="two-step"
elif [[ "${HIGHASCG_PLYMOUTH_FULL_ANIM:-0}" == "1" ]]; then
	theme_mode="full-script"
fi

echo "==> Plymouth theme → ${THEME_DIR} (mode=${theme_mode})"
rm -rf "$THEME_DIR"
mkdir -p "$THEME_DIR"

case "$theme_mode" in
full-script)
	[[ -f "$SCRIPT_FULL_IN" && -f "$PLYMOUTH_FULL" ]] || {
		echo "ERROR: missing full animation script assets" >&2
		exit 1
	}
	[[ -d "$ANIM_BOOT" ]] && [[ -n "$(find "$ANIM_BOOT" -maxdepth 1 -name '*.png' -print -quit 2>/dev/null)" ]] || {
		echo "ERROR: HIGHASCG_PLYMOUTH_FULL_ANIM=1 but ${ANIM_BOOT} has no frames" >&2
		exit 1
	}
	install_png_sequence "$ANIM_BOOT" "animation" "full animation (right 1/3)" || exit 1
	frame_count="$(find "$THEME_DIR" -maxdepth 1 -name 'animation-*.png' | wc -l)"
	frame_count="${frame_count//[[:space:]]/}"
	sed "s/@@FRAME_COUNT@@/${frame_count}/" "$SCRIPT_FULL_IN" >"${THEME_DIR}/highascg.script"
	install -m 0644 -o root -g root "$PLYMOUTH_FULL" "${THEME_DIR}/highascg.plymouth"
	echo "  Plymouth module: script (${frame_count} frames, logs left / animation right)"
	;;
two-step)
	[[ -d "$SPINNER_DIR" ]] || {
		echo "Missing $SPINNER_DIR after apt install" >&2
		exit 1
	}
	rsync -a --delete "${SPINNER_DIR}/" "${THEME_DIR}/"
	rm -f "${THEME_DIR}"/animation-*.png "${THEME_DIR}"/throbber-*.png "${THEME_DIR}"/highascg.script 2>/dev/null || true
	if [[ -d "$THROBBER_SRC" ]] && install_png_sequence "$THROBBER_SRC" "throbber" "throbber-boot (two-step)"; then
		:
	else
		cp -a "${SPINNER_DIR}"/throbber-*.png "${THEME_DIR}/" 2>/dev/null || true
	fi
	rm -f "${THEME_DIR}"/animation-*.png 2>/dev/null || true
	install -m 0644 -o root -g root "$PLYMOUTH_TWO_STEP" "${THEME_DIR}/highascg.plymouth"
	echo "  Plymouth module: two-step (legacy — may hide framebuffer logs)"
	;;
throbber-script|*)
	[[ -f "$SCRIPT_THROBBER_IN" && -f "$PLYMOUTH_THROBBER" ]] || {
		echo "ERROR: missing throbber script assets" >&2
		exit 1
	}
	if ! install_png_sequence "$THROBBER_SRC" "throbber" "throbber-boot (top-right)"; then
		echo "ERROR: failed to install throbber frames from ${THROBBER_SRC}" >&2
		exit 1
	fi
	frame_count="$(find "$THEME_DIR" -maxdepth 1 -name 'throbber-*.png' | wc -l)"
	frame_count="${frame_count//[[:space:]]/}"
	sed "s/@@FRAME_COUNT@@/${frame_count}/" "$SCRIPT_THROBBER_IN" >"${THEME_DIR}/highascg.script"
	chmod 0644 "${THEME_DIR}/highascg.script"
	install -m 0644 -o root -g root "$PLYMOUTH_THROBBER" "${THEME_DIR}/highascg.plymouth"
	echo "  Plymouth module: script (${frame_count} throbber frames, status log left + spinner top-right)"
	;;
esac

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

case "$theme_mode" in
full-script)
	nanim="$(find "$THEME_DIR" -maxdepth 1 -name 'animation-*.png' 2>/dev/null | wc -l)"
	nanim="${nanim//[[:space:]]/}"
	echo "OK: Plymouth default = highascg (full script, ${nanim} frames, initrd ${KVER})"
	;;
two-step)
	nthrob="$(find "$THEME_DIR" -maxdepth 1 -name 'throbber-*.png' 2>/dev/null | wc -l)"
	nthrob="${nthrob//[[:space:]]/}"
	echo "OK: Plymouth default = highascg (two-step, ${nthrob} frames, initrd ${KVER})"
	;;
*)
	nthrob="$(find "$THEME_DIR" -maxdepth 1 -name 'throbber-*.png' 2>/dev/null | wc -l)"
	nthrob="${nthrob//[[:space:]]/}"
	echo "OK: Plymouth default = highascg (throbber-script, ${nthrob} frames, initrd ${KVER})"
	;;
esac
