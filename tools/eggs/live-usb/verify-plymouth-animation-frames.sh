#!/usr/bin/env bash
# Dry-run check: branding/plymouth/animation → animation-0001 … animation-0030
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${HERE}/branding/plymouth/animation"
[[ -d "$SRC" ]] || {
	echo "Missing $SRC" >&2
	exit 1
}

shopt -s nullglob
frames=("${SRC}"/*.png)
shopt -u nullglob
[[ ${#frames[@]} -gt 0 ]] || {
	echo "No PNG frames in $SRC" >&2
	exit 1
}

mapfile -t sorted < <(printf '%s\n' "${frames[@]}" | sort -V)
echo "Frames: ${#sorted[@]} (install order → Plymouth names)"
i=1
for f in "${sorted[@]}"; do
	printf -v idx '%04d' "$i"
	printf '  %s → animation-%s.png\n' "$(basename "$f")" "$idx"
	i=$((i + 1))
done
echo "OK: use sudo bash tools/eggs/live-usb/install-highascg-plymouth-theme.sh then rebuild ISO"
