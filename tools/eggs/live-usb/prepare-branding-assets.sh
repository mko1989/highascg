#!/usr/bin/env bash
# Convert branding PNGs for GRUB / isolinux / Plymouth on live ISO.
#
# GRUB only accepts JPEG with 4:4:4 chroma (no subsampling). ffmpeg/ImageMagick
# default JPEG uses 4:2:0 → "invalid jpeg sampling" at boot. Use PNG for GRUB.
# Plymouth on NVIDIA: flatten RGBA onto black → opaque RGB.
#
# Outputs:
#   branding/splash.boot.png  (1920×1080 RGB — GRUB + isolinux)
#   branding/splash.boot.jpg  (optional 4:4:4 JPEG for size; not used by GRUB theme)
#   branding/plymouth/throbber-boot/*.png  (small spinner — two-step throbber only)
#   branding/plymouth/animation-boot/*.png (RGB full frames — Plymouth script theme)
#
# Usage: bash tools/eggs/live-usb/prepare-branding-assets.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING="${HERE}/branding"
SRC_SPLASH="${BRANDING}/splash.png"
ANIM_SRC="${BRANDING}/plymouth/animation"
THROBBER_OUT="${BRANDING}/plymouth/throbber-boot"
ANIM_BOOT="${BRANDING}/plymouth/animation-boot"
GRUB_BG='#0c1220'
PLYMOUTH_BG='black'
GRUB_W=1920
GRUB_H=1080
# Logo height on GRUB canvas (source splash.png is ~555px tall; 450 ≈ 50% of old 900px cap)
GRUB_LOGO_MAX_H="${GRUB_LOGO_MAX_H:-450}"
PLYMOUTH_THROBBER_MAX="${PLYMOUTH_THROBBER_MAX:-80}"
# Source frame numbers from branding/plymouth/animation/N.png (not all 1–30).
PLYMOUTH_THROBBER_FRAMES="${PLYMOUTH_THROBBER_FRAMES:-1 2 29 30}"

have_imagemagick() {
	command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1
}

magick_cmd() {
	if command -v magick >/dev/null 2>&1; then
		magick "$@"
	elif command -v convert >/dev/null 2>&1; then
		convert "$@"
	else
		return 1
	fi
}

flatten_rgba_imagemagick() {
	local src="$1" dest="$2" bg="$3" extra_args=("${@:4}")
	magick_cmd "$src" \
		-background "$bg" -alpha remove -alpha off \
		"${extra_args[@]}" \
		-define png:color-type=2 \
		"$dest"
}

prepare_splash_imagemagick() {
	flatten_rgba_imagemagick "$SRC_SPLASH" "${BRANDING}/splash.boot.png" "$GRUB_BG" \
		-resize "x${GRUB_LOGO_MAX_H}>" -gravity center -extent "${GRUB_W}x${GRUB_H}"
	# 4:4:4 only — GRUB rejects 4:2:0 (optional; theme uses splash.png)
	magick_cmd "${BRANDING}/splash.boot.png" \
		-sampling-factor 4:4:4 -interlace None -quality 90 \
		"${BRANDING}/splash.boot.jpg"
}

prepare_splash_ffmpeg() {
	command -v ffmpeg >/dev/null 2>&1 || return 1
	ffmpeg -y -hide_banner -loglevel error \
		-f lavfi -i "color=c=${GRUB_BG}:s=${GRUB_W}x${GRUB_H}" \
		-i "$SRC_SPLASH" \
		-filter_complex "[1:v]format=rgba,scale=-1:${GRUB_LOGO_MAX_H}[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgb24" \
		-frames:v 1 -update 1 "${BRANDING}/splash.boot.png"
	# yuvj444p = 4:4:4 JPEG (isolinux only; GRUB uses PNG)
	ffmpeg -y -hide_banner -loglevel error -i "${BRANDING}/splash.boot.png" \
		-pix_fmt yuvj444p -q:v 2 "${BRANDING}/splash.boot.jpg"
}

prepare_throbber_frame_imagemagick() {
	local src="$1" dest="$2"
	flatten_rgba_imagemagick "$src" "$dest" "$PLYMOUTH_BG" \
		-resize "${PLYMOUTH_THROBBER_MAX}x${PLYMOUTH_THROBBER_MAX}>"
}

prepare_throbber_frame_ffmpeg() {
	local src="$1" dest="$2"
	local max="${PLYMOUTH_THROBBER_MAX}"
	ffmpeg -y -hide_banner -loglevel error -i "$src" \
		-filter_complex "
			[0:v]format=rgba,scale=${max}:${max}:force_original_aspect_ratio=decrease[fg];
			color=c=black:s=2x2[bg];
			[bg][fg]scale2ref[background][foreground];
			[background][foreground]overlay=format=auto,format=rgb24
		" -frames:v 1 -update 1 "$dest"
}

png_format_desc() {
	local f="$1"
	if command -v file >/dev/null 2>&1; then
		file -b "$f"
		return 0
	fi
	if command -v ffprobe >/dev/null 2>&1; then
		local fmt
		fmt="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$f" 2>/dev/null || true)"
		printf 'PNG %s (%s)\n' "$(basename "$f")" "${fmt:-unknown}"
		return 0
	fi
	printf 'PNG %s\n' "$(basename "$f")"
}

verify_rgb_png() {
	local f="$1"
	if command -v file >/dev/null 2>&1; then
		file "$f" | grep -q 'RGB' && ! file "$f" | grep -q 'RGBA'
		return $?
	fi
	if command -v ffprobe >/dev/null 2>&1; then
		local fmt
		fmt="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$f" 2>/dev/null || true)"
		case "$fmt" in
		rgb24 | gray | pal8 | yuvj444p) return 0 ;;
		*) return 1 ;;
		esac
	fi
	if command -v identify >/dev/null 2>&1; then
		local ch
		ch="$(identify -format '%[channels]' "$f" 2>/dev/null || true)"
		[[ "$ch" == *r* && "$ch" != *a* ]]
		return $?
	fi
	echo "ERROR: need file, ffprobe, or identify to verify RGB PNG (apt install file ffmpeg)" >&2
	return 1
}

[[ -f "$SRC_SPLASH" ]] || {
	echo "Missing ${SRC_SPLASH}" >&2
	exit 1
}

USE_FFMPEG=0
if have_imagemagick; then
	:
elif command -v ffmpeg >/dev/null 2>&1; then
	USE_FFMPEG=1
else
	echo "ERROR: need ImageMagick or ffmpeg (apt install imagemagick ffmpeg)" >&2
	exit 1
fi

echo "==> GRUB/isolinux splash (${GRUB_W}×${GRUB_H}, RGB PNG — GRUB cannot use subsampled JPEG)"
if [[ "$USE_FFMPEG" -eq 1 ]]; then
	prepare_splash_ffmpeg
else
	prepare_splash_imagemagick
fi
if ! verify_rgb_png "${BRANDING}/splash.boot.png"; then
	echo "ERROR: splash.boot.png must be RGB (no alpha) for GRUB" >&2
	png_format_desc "${BRANDING}/splash.boot.png" >&2
	exit 1
fi
echo "     ${BRANDING}/splash.boot.png ($(png_format_desc "${BRANDING}/splash.boot.png"))"
echo "     ${BRANDING}/splash.boot.jpg (optional 4:4:4 JPEG)"

mkdir -p "$THROBBER_OUT"
rm -f "${THROBBER_OUT}"/*.png
echo "==> Plymouth throbber → ${THROBBER_OUT} (frames ${PLYMOUTH_THROBBER_FRAMES}, max ${PLYMOUTH_THROBBER_MAX}px)"
seq_i=1
for src_num in $PLYMOUTH_THROBBER_FRAMES; do
	src="${ANIM_SRC}/${src_num}.png"
	[[ -f "$src" ]] || {
		echo "ERROR: missing ${src} (PLYMOUTH_THROBBER_FRAMES=${PLYMOUTH_THROBBER_FRAMES})" >&2
		exit 1
	}
	dest="${THROBBER_OUT}/${seq_i}.png"
	if [[ "$USE_FFMPEG" -eq 1 ]]; then
		prepare_throbber_frame_ffmpeg "$src" "$dest"
	else
		prepare_throbber_frame_imagemagick "$src" "$dest"
	fi
	if ! verify_rgb_png "$dest"; then
		echo "ERROR: ${dest} is not RGB after flatten — install imagemagick" >&2
		png_format_desc "$dest" >&2
		exit 1
	fi
	seq_i=$((seq_i + 1))
done
throbber_count=$((seq_i - 1))
sample="$(find "$THROBBER_OUT" -maxdepth 1 -name '*.png' | sort -V | head -1)"
echo "     ${throbber_count} throbber frame(s) from animation/{${PLYMOUTH_THROBBER_FRAMES}}; sample: $(png_format_desc "$sample")"

mkdir -p "$ANIM_BOOT"
rm -f "${ANIM_BOOT}"/*.png
if [[ -d "$ANIM_SRC" ]]; then
	anim_frames=()
	shopt -s nullglob
	for f in "${ANIM_SRC}"/*.png; do
		anim_frames+=("$f")
	done
	shopt -u nullglob
	if [[ ${#anim_frames[@]} -gt 0 ]]; then
		echo "==> Plymouth animation-boot → ${ANIM_BOOT} (${#anim_frames[@]} frames, RGB for script theme)"
		mapfile -t anim_sorted < <(printf '%s\n' "${anim_frames[@]}" | sort -V)
		for f in "${anim_sorted[@]}"; do
			dest="${ANIM_BOOT}/$(basename "$f")"
			if [[ "$USE_FFMPEG" -eq 1 ]]; then
				ffmpeg -y -hide_banner -loglevel error -i "$f" \
					-filter_complex "[0:v]format=rgba,scale=iw:ih[fg];color=c=black:s=2x2[bg];[bg][fg]scale2ref[background][foreground];[background][foreground]overlay=format=auto,format=rgb24" \
					-frames:v 1 -update 1 "$dest"
			else
				flatten_rgba_imagemagick "$f" "$dest" "$PLYMOUTH_BG"
			fi
			verify_rgb_png "$dest" || {
				echo "ERROR: ${dest} is not RGB" >&2
				exit 1
			}
		done
		anim_sample="$(find "$ANIM_BOOT" -maxdepth 1 -name '*.png' | sort -V | head -1)"
		echo "     ${#anim_sorted[@]} animation frame(s); sample: $(png_format_desc "$anim_sample")"
	fi
fi

echo "OK: boot-ready branding assets prepared"
