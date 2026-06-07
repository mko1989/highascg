#!/usr/bin/env bash
# Install framebuffer corner throbber for nosplash dmesg boot (host + ISO rootfs).
#
# Plymouth splash and raw framebuffer dmesg cannot run together; this draws the
# small throbber-boot animation in the top-right corner without touching Plymouth.
#
# Usage:
#   sudo bash tools/eggs/live-usb/install-fb-corner-throbber.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_C="${HERE}/branding/fb-corner-throbber/highascg-fb-corner-throbber.c"
THROBBER_SRC="${HERE}/branding/plymouth/throbber-boot"
BIN=/usr/local/bin/highascg-fb-corner-throbber
FRAMES_DIR=/usr/share/highascg/boot-throbber
NODM_DROPIN_SRC="${HERE}/systemd/nodm-stop-fb-throbber.conf"
NODM_DROPIN_DIR=/etc/systemd/system/nodm.service.d
DOC_DIR=/usr/share/doc/highascg

log() { echo "==> $*"; }

command -v gcc >/dev/null || {
	export DEBIAN_FRONTEND=noninteractive
	apt-get install -y --no-install-recommends gcc
}

command -v ffmpeg >/dev/null || {
	export DEBIAN_FRONTEND=noninteractive
	apt-get install -y --no-install-recommends ffmpeg
}

bash "${HERE}/prepare-branding-assets.sh"

[[ -f "$SRC_C" ]] || {
	echo "Missing $SRC_C" >&2
	exit 1
}
[[ -d "$THROBBER_SRC" ]] || {
	echo "Missing $THROBBER_SRC — run prepare-branding-assets.sh" >&2
	exit 1
}

log "Compile ${BIN}"
gcc -O2 -Wall -Wextra -o "${BIN}.tmp" "$SRC_C"
install -m 0755 -o root -g root "${BIN}.tmp" "$BIN"
rm -f "${BIN}.tmp"

log "Convert throbber-boot PNGs → raw RGB (${FRAMES_DIR})"
install -d -m 0755 -o root -g root "$FRAMES_DIR"
rm -f "${FRAMES_DIR}"/throbber-*.rgb

shopt -s nullglob
frames=("${THROBBER_SRC}"/*.png)
shopt -u nullglob
[[ ${#frames[@]} -gt 0 ]] || {
	echo "No throbber frames in ${THROBBER_SRC}" >&2
	exit 1
}
mapfile -t frames < <(printf '%s\n' "${frames[@]}" | sort -V)

frame_w=0
frame_h=0
i=1
for f in "${frames[@]}"; do
	# csv=p=0 → "60,80" (s=x would merge into one token and break -w/-h parsing)
	IFS=',' read -r frame_w frame_h < <(ffprobe -v error -select_streams v:0 \
		-show_entries stream=width,height -of csv=p=0 "$f")
	[[ -n "$frame_w" && -n "$frame_h" ]] || {
		echo "ffprobe failed to read dimensions for $f" >&2
		exit 1
	}
	out="${FRAMES_DIR}/throbber-$(printf '%04d' "$i").rgb"
	ffmpeg -y -hide_banner -loglevel error -i "$f" -f rawvideo -pix_fmt rgb24 "$out"
	chmod 0644 "$out"
	i=$((i + 1))
done
frame_count=$((i - 1))

log "Install systemd units (frame ${frame_w}x${frame_h}, count=${frame_count})"
install -d -m 0755 -o root -g root "$DOC_DIR"
cat >"${DOC_DIR}/fb-corner-throbber.txt" <<EOF
HighAsCG framebuffer corner throbber (${frame_w}x${frame_h}, ${frame_count} frames).

Runs during nosplash boot: full dmesg on the console with a small spinner in the
top-right corner. Stops automatically before nodm starts X.

Reinstall: sudo bash ${HERE}/install-fb-corner-throbber.sh
EOF

install -d -m 0755 -o root -g root "$NODM_DROPIN_DIR"
install -m 0644 -o root -g root "$NODM_DROPIN_SRC" "${NODM_DROPIN_DIR}/stop-fb-throbber.conf"

# Write service with detected frame geometry (avoid sed on template — easy to corrupt -w/-h).
cat >/etc/systemd/system/highascg-fb-corner-throbber.service <<EOF
[Unit]
Description=HighAsCG corner throbber on framebuffer (nosplash dmesg overlay)
Documentation=file:/usr/share/doc/highascg/fb-corner-throbber.txt
DefaultDependencies=no
After=dev-fb0.device systemd-udev-settle.service
Before=nodm.service display-manager.service
ConditionPathExists=/dev/fb0
ConditionPathExists=${BIN}

[Service]
Type=simple
ExecStart=${BIN} -d ${FRAMES_DIR} -w ${frame_w} -h ${frame_h} -c ${frame_count} -m 20 -i 200
# Do not respawn after nodm stops us — restart fights NVIDIA X on fb0 and blanks the screen.
Restart=no
KillMode=mixed
TimeoutStopSec=2

[Install]
WantedBy=sysinit.target
EOF
chmod 0644 /etc/systemd/system/highascg-fb-corner-throbber.service

systemctl daemon-reload
systemctl enable highascg-fb-corner-throbber.service

echo
echo "OK: framebuffer corner throbber installed"
echo "     binary: ${BIN}"
echo "     frames: ${FRAMES_DIR}/throbber-0001.rgb … (${frame_count} @ ${frame_w}x${frame_h})"
echo "     service: highascg-fb-corner-throbber.service (enabled)"
echo "     stops before nodm via ${NODM_DROPIN_DIR}/stop-fb-throbber.conf"
echo
echo "Reboot to verify: GRUB wallpaper → scrolling dmesg + corner animation."
