#!/usr/bin/env bash
# Load block drivers so internal NVMe/SATA appears before Calamares partition UI.
#
# Usage:
#   sudo /usr/local/lib/highascg/probe-internal-storage.sh
#   sudo /usr/local/lib/highascg/probe-internal-storage.sh --check
#   sudo /usr/local/lib/highascg/probe-internal-storage.sh --report
set -euo pipefail

LOG=/var/log/highascg/storage-probe.log
CHECK_ONLY=0
REPORT_ONLY=0
case "${1:-}" in
--check) CHECK_ONLY=1 ;;
--report) REPORT_ONLY=1 ;;
esac

log() {
	local line="[$(date -Iseconds)] $*"
	echo "$line" | tee -a "$LOG" >&2
	logger -t highascg-storage-probe -- "$*" 2>/dev/null || true
}

report_pci_storage() {
	log "PCI storage controllers:"
	if command -v lspci >/dev/null 2>&1; then
		lspci -nn 2>/dev/null | grep -iE 'storage|sata|ahci|nvme|raid|vmd|scsi|non-volatile' | tee -a "$LOG" || log "  (none matched — no NVMe/SATA PCI device visible to kernel)"
	else
		log "  lspci not installed"
	fi
}

report_dmesg_storage() {
	log "Kernel storage messages (last 40):"
	if command -v dmesg >/dev/null 2>&1; then
		dmesg 2>/dev/null | grep -iE 'nvme|ahci|ata[0-9]|vmd|scsi host|remapped|RAID mode|Switch your BIOS' | tail -40 | tee -a "$LOG" || log "  (no matches)"
	fi
}

intel_rst_hiding_nvme() {
	dmesg 2>/dev/null | grep -q 'Switch your BIOS from RAID to AHCI'
}

intel_rst_message() {
	echo "Intel RST RAID mode is hiding internal NVMe drive(s)." >&2
	echo "  dmesg: ahci found remapped NVMe but will not attach in RAID mode." >&2
	echo "  Fix (BIOS): set SATA/NVMe storage to AHCI (not Intel RST/RAID/VMD RAID)." >&2
	echo "  Or: enable Intel VMD in BIOS and reboot, then: sudo modprobe vmd" >&2
	echo "  Calamares cannot install until lsblk shows nvme0n1 or a non-USB sdX disk." >&2
}

count_install_targets() {
	# Disks Calamares could use: not loop, not the live USB iso9660 stick.
	usb_live=0
	internal=0
	while read -r name rm tran fstype; do
		[[ "$name" == loop* ]] && continue
		if [[ "$rm" == 1 || "$tran" == usb ]]; then
			usb_live=$((usb_live + 1))
			continue
		fi
		internal=$((internal + 1))
	done < <(lsblk -ndo NAME,RM,TRAN,FSTYPE 2>/dev/null | awk '$1 ~ /^[a-z]/ {print $1, $2, $3, $4}')
	echo "$internal $usb_live"
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root" >&2
	exit 1
}

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

if [[ "$REPORT_ONLY" -eq 1 ]]; then
	report_pci_storage
	report_dmesg_storage
	lsblk -o NAME,TYPE,SIZE,MODEL,TRAN,RM,FSTYPE 2>/dev/null | tee -a "$LOG" || true
	exit 0
fi

STORAGE_MODS=(nvme_core nvme vmd ahci libahci sd_mod scsi_mod scsi_transport_sas)
for m in "${STORAGE_MODS[@]}"; do
	if modinfo "$m" &>/dev/null; then
		modprobe "$m" 2>/dev/null && log "modprobe ${m}: ok" || log "modprobe ${m}: already loaded or skipped"
	fi
done

if command -v udevadm >/dev/null 2>&1; then
	udevadm settle --timeout=45 2>/dev/null || true
fi
sleep 1
command -v partprobe >/dev/null 2>&1 && partprobe -a 2>/dev/null || true

read -r internal_n usb_n <<<"$(count_install_targets)"
nvme_count="$(lsblk -ndo NAME,TYPE 2>/dev/null | awk '$2=="disk" && $1 ~ /^nvme/ {c++} END{print c+0}')"
disk_count="$(lsblk -ndo NAME,TYPE 2>/dev/null | awk '$2=="disk" {c++} END{print c+0}')"

log "block_disks=${disk_count} nvme=${nvme_count} install_targets=${internal_n} usb/removable=${usb_n}"
lsblk -o NAME,TYPE,SIZE,MODEL,TRAN,RM,FSTYPE 2>/dev/null | tee -a "$LOG" || true

if [[ "$CHECK_ONLY" -eq 1 ]]; then
	if [[ "$internal_n" -ge 1 ]]; then
		exit 0
	fi
	report_pci_storage
	report_dmesg_storage
	echo "" >&2
	if intel_rst_hiding_nvme; then
		intel_rst_message
	else
		echo "ERROR: Calamares needs an internal install disk (NVMe/SATA)." >&2
		echo "       This machine only shows the USB live stick — no nvme/sd target in lsblk." >&2
		echo "       If the rig has an M.2/SATA drive, check BIOS (enable M.2, storage mode)." >&2
	fi
	echo "       Full report: sudo $0 --report" >&2
	echo "       Log: ${LOG}" >&2
	exit 1
fi

exit 0
