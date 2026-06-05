#!/usr/bin/env bash
# Boot a HighAsCG ISO in QEMU to preview GRUB → kernel console → Plymouth without flashing USB.
#
# Usage:
#   sudo bash tools/eggs/live-usb/preview-live-iso-qemu.sh [/path/to/highascg*.iso]
#
# Requires: qemu-system-x86_64, KVM optional (-enable-kvm when /dev/kvm exists).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

ISO="${1:-}"
if [[ -z "$ISO" ]]; then
	ISO="$(find_latest_iso 2>/dev/null || true)"
fi
[[ -f "$ISO" ]] || {
	echo "No ISO. Build first or pass path: sudo $0 /home/eggs/mnt/highascg_*.iso" >&2
	exit 1
}

command -v qemu-system-x86_64 >/dev/null || {
	echo "Install qemu-system-x86: sudo apt-get install -y qemu-system-x86" >&2
	exit 1
}

KVM=()
[[ -r /dev/kvm ]] && KVM=(-enable-kvm -cpu host)

echo "==> QEMU live boot preview"
echo "    ISO: $ISO"
echo "    Watch: kernel/systemd text on the console; Plymouth animation should sit top-right."
echo "    Close the QEMU window or Ctrl+C here to stop."
echo

exec qemu-system-x86_64 \
	"${KVM[@]}" \
	-machine q35 \
	-m 8192 \
	-smp 4 \
	-cdrom "$ISO" \
	-boot d \
	-vga virtio \
	-display gtk,show-cursor=on \
	-netdev user,id=net0 \
	-device virtio-net-pci,netdev=net0
