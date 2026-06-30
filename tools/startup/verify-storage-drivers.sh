#!/usr/bin/env bash
# NVMe / internal disk visibility for Calamares install-to-disk (read-only).
#
# Usage: bash ~/highascg/tools/startup/verify-storage-drivers.sh
set -euo pipefail

FAIL=0
ok() { echo "OK: $*"; }
warn() { echo "WARN: $*" >&2; }
bad() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

echo "=== Storage drivers (Calamares / NVMe) ==="

for m in nvme_core nvme vmd ahci; do
	if modinfo "$m" &>/dev/null; then
		loaded=""
		lsmod 2>/dev/null | grep -q "^${m}[[:space:]]" && loaded=" loaded"
		ok "module ${m} available${loaded}"
	else
		warn "module ${m} not in kernel modules (may be built-in or need linux-modules-extra)"
	fi
done

pci_storage="$(lspci -nn 2>/dev/null | grep -iE 'storage|sata|ahci|nvme|raid|vmd|non-volatile' || true)"
if [[ -n "$pci_storage" ]]; then
	ok "PCI storage controller(s) present"
	echo "$pci_storage" | sed 's/^/    /'
else
	bad "no NVMe/SATA PCI device in lspci (unusual)"
fi

if dmesg 2>/dev/null | grep -q 'Switch your BIOS from RAID to AHCI'; then
	bad "Intel RST RAID mode — 2 NVMe drive(s) remapped but hidden from Linux"
	echo "    dmesg: ahci 0000:00:17.0: Switch your BIOS from RAID to AHCI mode to use them." >&2
	echo "" >&2
	echo "    BIOS fix (required for Calamares):" >&2
	echo "      • Enter BIOS → Storage / SATA Configuration" >&2
	echo "      • Change Intel RST / RAID → AHCI (or disable RST for NVMe)" >&2
	echo "      • Save & reboot from USB stick again" >&2
	echo "      • Confirm: lsblk shows nvme0n1 (and nvme1n1 if two M.2)" >&2
	echo "" >&2
	echo "    Alternative: enable Intel VMD in BIOS, reboot, then: sudo modprobe vmd" >&2
elif dmesg 2>/dev/null | grep -q 'impl RAID mode'; then
	warn "SATA/NVMe controller in RAID mode — internal disks may be hidden"
fi

nvme_n="$(lsblk -ndo NAME,TYPE 2>/dev/null | awk '$2=="disk" && $1 ~ /^nvme/ {c++} END{print c+0}')"
sata_n="$(lsblk -ndo NAME,TYPE,TRAN 2>/dev/null | awk '$2=="disk" && $1 ~ /^sd/ && $3!="usb" {c++} END{print c+0}')"
usb_n="$(lsblk -ndo NAME,TYPE,TRAN 2>/dev/null | awk '$2=="disk" && $3=="usb" {c++} END{print c+0}')"

if [[ "$nvme_n" -ge 1 ]]; then
	ok "NVMe disk(s) visible: ${nvme_n}"
	lsblk -o NAME,TYPE,SIZE,MODEL,TRAN | grep -E '^NAME|nvme' || true
elif [[ "$sata_n" -ge 1 ]]; then
	ok "internal SATA/SCSI disk(s) visible: ${sata_n}"
	lsblk -o NAME,TYPE,SIZE,MODEL,TRAN,RM | grep -E '^NAME|^sd' || true
elif [[ "$usb_n" -ge 1 ]]; then
	bad "only USB disk(s) visible (${usb_n}) — not valid Calamares install target (live stick is excluded)"
	lsblk -o NAME,TYPE,SIZE,MODEL,TRAN,RM | grep -E '^NAME|^sd|^nvme' || true
else
	bad "no block disks visible"
fi

if [[ -x /usr/local/lib/highascg/probe-internal-storage.sh ]]; then
	echo "  run: sudo /usr/local/lib/highascg/probe-internal-storage.sh --report"
	if sudo -n /usr/local/lib/highascg/probe-internal-storage.sh --check 2>/dev/null; then
		ok "probe-internal-storage.sh --check"
	else
		bad "probe-internal-storage.sh --check failed (see /var/log/highascg/storage-probe.log)"
	fi
else
	warn "probe-internal-storage.sh not installed — rebuild ISO after install-storage-drivers-for-iso.sh"
fi

echo ""
echo "Calamares install-to-disk needs a fixed internal NVMe or SATA drive."
echo "The live USB stick (highascg-nvidia-595 iso9660) is intentionally excluded."
echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "Storage verify FAILED (${FAIL} error(s))."
	exit 1
fi
echo "Storage verify complete."
exit 0
