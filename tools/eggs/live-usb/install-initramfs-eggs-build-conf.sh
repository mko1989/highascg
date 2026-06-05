#!/usr/bin/env bash
# Suppress benign mkinitramfs noise when building live ISO initrds on the eggs host.
#
#   W: Couldn't identify type of root file system for fsck hook
#
# Live boot does not use the build host's /. Setting FSTYPE avoids auto-probing / in hooks/fsck.
#
# Usage: sudo bash tools/eggs/live-usb/install-initramfs-eggs-build-conf.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

CONF=/etc/initramfs-tools/conf.d/highascg-live-iso-build.conf
cat >"$CONF" <<'EOF'
# HighAsCG eggs host: building casper/live initrd, not booting this machine's root fs.
export FSTYPE=ext4
FRAMEBUFFER=y
EOF
chmod 0644 "$CONF"
echo "OK: ${CONF} (suppresses fsck hook root probe warning during mkinitramfs)"
