#!/bin/sh
# HighAsCG — carry nomodeset into installed GRUB (full path to update-grub).
set -e

if ! grep -q nomodeset /proc/cmdline 2>/dev/null; then
	exit 0
fi

echo "Forwarding nomodeset to installed system"

mkdir -p /etc/default/grub.d
cat >/etc/default/grub.d/ubuntu-installation-nomodeset.cfg <<'EOF'
GRUB_CMDLINE_LINUX_DEFAULT="${GRUB_CMDLINE_LINUX_DEFAULT} nomodeset"
EOF

if command -v update-grub >/dev/null 2>&1; then
	update-grub
elif [ -x /usr/sbin/update-grub ]; then
	/usr/sbin/update-grub
fi

exit 0
