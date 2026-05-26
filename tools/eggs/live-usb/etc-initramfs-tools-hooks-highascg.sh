#!/bin/sh
# Force HighAsCG Plymouth theme files into every initramfs (eggs produce + host boot).
# Installed to /etc/initramfs-tools/hooks/highascg by install-highascg-plymouth-theme.sh
set -e

PREREQ=""
prereqs() { echo "$PREREQ"; }

case "$1" in
prereqs) prereqs; exit 0 ;;
esac

. /usr/share/initramfs-tools/hook-functions

THEME_DIR=/usr/share/plymouth/themes/highascg
PLY="${THEME_DIR}/highascg.plymouth"

[ -d "$THEME_DIR" ] || exit 0
[ -f "$PLY" ] || exit 0

mkdir -p "${DESTDIR}/usr/share/plymouth/themes"
cp -a "$THEME_DIR" "${DESTDIR}/usr/share/plymouth/themes/"
ln -sf /usr/share/plymouth/themes/highascg/highascg.plymouth \
	"${DESTDIR}/usr/share/plymouth/themes/default.plymouth"
