#!/usr/bin/env bash
# Preview HighAsCG boot animation WITHOUT touching the live DRM display.
#
# Safe default: build a short MP4 (black console + top-right frames) under work/.
# Do NOT run plymouthd on a machine with Xorg/CasparCG outputs — it can blank monitors.
#
# Usage:
#   bash tools/eggs/live-usb/preview-plymouth-boot-branding.sh
#   bash tools/eggs/live-usb/preview-plymouth-boot-branding.sh --open     # play MP4 when done
#   sudo bash tools/eggs/live-usb/preview-plymouth-boot-branding.sh --install   # theme + initrd only
#
# Full boot preview: sudo bash tools/eggs/live-usb/preview-live-iso-qemu.sh [iso]
#
# If you already ran the old live-Plymouth preview and lost video:
#   sudo bash tools/eggs/live-usb/recover-display-after-plymouth.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
ANIM_SRC="${HERE}/branding/plymouth/animation"
WORK="${REPO}/work"
OUT="${WORK}/plymouth-corner-preview.mp4"
FPS=12
CANVAS_W=1920
CANVAS_H=1080
PANEL_FRAC=3

bash "${HERE}/verify-plymouth-animation-frames.sh"

if [[ "${1:-}" == "--install" ]]; then
	[[ "$(id -u)" -eq 0 ]] || {
		echo "Run: sudo $0 --install" >&2
		exit 1
	}
	bash "${HERE}/install-highascg-plymouth-theme.sh"
	echo
	echo "Theme installed for ISO/initrd. Preview animation safely with:"
	echo "  bash ${HERE}/preview-plymouth-boot-branding.sh --open"
	exit 0
fi

if [[ "${1:-}" == "--unsafe-live-drm" ]]; then
	echo "ERROR: live Plymouth preview on this host is disabled (it blanked Xorg/nodm outputs)." >&2
	echo "Use: bash $0 [--open]   or   sudo bash ${HERE}/preview-live-iso-qemu.sh" >&2
	exit 1
fi

command -v ffmpeg >/dev/null || {
	echo "Install ffmpeg: sudo apt-get install -y ffmpeg" >&2
	exit 1
}

mkdir -p "$WORK"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

shopt -s nullglob
frames=("${ANIM_SRC}"/*.png)
shopt -u nullglob
[[ ${#frames[@]} -gt 0 ]] || {
	echo "No frames in ${ANIM_SRC}" >&2
	exit 1
}
mapfile -t frames < <(printf '%s\n' "${frames[@]}" | sort -V)

i=1
for f in "${frames[@]}"; do
	ln -sf "$(readlink -f "$f")" "${TMP}/frame-$(printf '%04d' "$i").png"
	i=$((i + 1))
done
nframes=$((i - 1))
duration="$(awk "BEGIN { printf \"%.2f\", ${nframes} / ${FPS} }")"

# Black 1080p canvas: left 2/3 = boot log area, right 1/3 = animation (matches Plymouth script).
ffmpeg -y -hide_banner -loglevel error \
	-framerate "$FPS" -start_number 1 -i "${TMP}/frame-%04d.png" \
	-filter_complex \
	"[0:v]format=rgba,scale=iw:ih:flags=lanczos[anim];color=c=black:s=${CANVAS_W}x${CANVAS_H}:d=${duration}[bg];[bg][anim]overlay=x='(W*2/3)+(W/3-w)/2':y='(H-h)/2':shortest=1" \
	-c:v libx264 -pix_fmt yuv420p -t "$duration" \
	"$OUT"

echo "OK: wrote ${OUT} (${nframes} frames @ ${FPS} fps, ~${duration}s)"
echo "    Simulates boot: left 2/3 console log, right 1/3 animation."
echo "    ISO/USB: use QEMU preview — never plymouthd on this playout host."

if [[ "${1:-}" == "--open" ]]; then
	if command -v xdg-open >/dev/null && [[ -n "${DISPLAY:-}" ]]; then
		xdg-open "$OUT"
	elif command -v mpv >/dev/null; then
		mpv "$OUT"
	else
		echo "Open manually: ${OUT}"
	fi
fi
