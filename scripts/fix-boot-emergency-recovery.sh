#!/usr/bin/env bash
# Fix boot dropping into emergency mode (Ctrl+D to continue).
#
# Typical causes on playout PCs after WO-47/WO-52:
#   1. /etc/fstab /boot/efi UUID no longer matches the ESP (blocks local-fs.target)
#   2. home-casparcg-exfat.mount enabled at boot → 90s wait for absent HIGHASCGEXF USB
#
# Run on each affected machine:
#   cd ~/highascg && sudo bash scripts/fix-boot-emergency-recovery.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash scripts/fix-boot-emergency-recovery.sh" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_CASPAR="${1:-casparcg}"
FSTAB=/etc/fstab
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { echo "==> $*"; }

dedupe_fstab_boot_efi() {
	local count
	count="$(awk '$2=="/boot/efi" && $1 !~ /^#/ { c++ } END { print c+0 }' "$FSTAB")"
	[[ "$count" -le 1 ]] && return 0
	cp -a "$FSTAB" "${FSTAB}.bak.dedupe.${STAMP}"
	awk '
		$2 == "/boot/efi" && $1 !~ /^#/ {
			if (seen++) next
		}
		{ print }
	' "$FSTAB" >"${FSTAB}.new"
	mv "${FSTAB}.new" "$FSTAB"
	log "Removed duplicate /boot/efi fstab lines (had ${count})"
}

fix_fstab_efi() {
	[[ -f "$FSTAB" ]] || return 0
	grep -q '/boot/efi' "$FSTAB" || {
		log "No /boot/efi line in fstab — skip EFI repair"
		return 0
	}

	dedupe_fstab_boot_efi

	local current_uuid want_line efi_dev new_uuid
	current_uuid="$(awk '$2=="/boot/efi" && $1 !~ /^#/{print $1; exit}' "$FSTAB" | sed 's|^/dev/disk/by-uuid/||')"
	if [[ -n "$current_uuid" ]] && [[ -e "/dev/disk/by-uuid/${current_uuid}" ]]; then
		log "EFI fstab UUID ${current_uuid} is present — OK"
		return 0
	fi

	efi_dev=""
	# Prefer unmounted vfat on the boot disk (usually nvme0n1p1).
	while read -r path fstype mountpoint; do
		[[ "$fstype" == "vfat" ]] || continue
		[[ -z "$mountpoint" ]] || continue
		if [[ "$path" =~ nvm|sd[a-z] ]]; then
			efi_dev="$path"
			break
		fi
	done < <(lsblk -nr -o PATH,FSTYPE,MOUNTPOINT)

	if [[ -z "$efi_dev" ]]; then
		efi_dev="$(lsblk -nr -o PATH,FSTYPE | awk '$2=="vfat"{print $1; exit}')"
	fi
	if [[ -z "$efi_dev" ]] || [[ ! -b "$efi_dev" ]]; then
		echo "WARN: could not find a vfat ESP to fix /boot/efi fstab (was UUID=${current_uuid:-?})" >&2
		return 0
	fi

	new_uuid="$(blkid -s UUID -o value "$efi_dev" 2>/dev/null || true)"
	if [[ -z "$new_uuid" ]]; then
		echo "WARN: no UUID on ${efi_dev}" >&2
		return 0
	fi

	cp -a "$FSTAB" "${FSTAB}.bak.${STAMP}"
	want_line="/dev/disk/by-uuid/${new_uuid} /boot/efi vfat umask=0077,nofail 0 1"
	awk -v repl="$want_line" '
		$2 == "/boot/efi" { print repl; next }
		{ print }
	' "$FSTAB" >"${FSTAB}.new"
	mv "${FSTAB}.new" "$FSTAB"
	log "Updated /boot/efi fstab → UUID ${new_uuid} (${efi_dev})"
}

fix_fstab_swap() {
	[[ -f "$FSTAB" ]] || return 0
	if grep -qE '^[[:space:]]*/swap\.img[[:space:]]' "$FSTAB" && ! grep -qE '^[[:space:]]*/swap\.img[[:space:]]+none[[:space:]]+swap[[:space:]]+.*nofail' "$FSTAB"; then
		cp -a "$FSTAB" "${FSTAB}.bak.swap.${STAMP}" 2>/dev/null || true
		sed -i -E 's|^([[:space:]]*/swap\.img[[:space:]]+none[[:space:]]+swap[[:space:]]+)([^[:space:]]+)(.*)$|\1\2,nofail\3|' "$FSTAB"
		log "Added nofail to /swap.img fstab line (missing swap file no longer fails boot)"
	fi
}

log "Refresh WO-47/WO-52 systemd units (USB mount not enabled at local-fs)"
bash "${REPO_ROOT}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"
bash "${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh" "$USER_CASPAR"

DISABLE_MOUNTS=(
	home-casparcg-exfat.mount
	home-casparcg-highascg-media-exfat.mount
)
# Optional bridge bind/mount: started by highascg-bridge-boot.service only.
DISABLE_MOUNTS+=(home-casparcg-bridge.mount home-casparcg-highascg-media.mount)

for u in "${DISABLE_MOUNTS[@]}"; do
	systemctl disable "$u" 2>/dev/null || true
	systemctl reset-failed "$u" 2>/dev/null || true
done

fix_fstab_efi
fix_fstab_swap

systemctl daemon-reload
systemctl reset-failed boot-efi.mount home-casparcg-exfat.mount 2>/dev/null || true

log "Done. Reboot to verify — expect no emergency shell when USB stick is absent."
echo ""
echo "Quick check:"
echo "  grep boot/efi ${FSTAB}"
echo "  systemctl is-enabled home-casparcg-exfat.mount   # should be disabled"
echo "  systemctl is-enabled highascg-exfat-boot.service # should be enabled"
