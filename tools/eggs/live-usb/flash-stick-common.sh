#!/usr/bin/env bash
# Shared helpers for flashing a HighAsCG ISO onto a USB whole-disk device.
# shellcheck shell=bash

find_latest_iso() {
	find_newest_iso_since 0 "${BASENAME:-}"
}

# Newest *.iso under /home/eggs/ (+ mnt/) written at or after EPOCH (0 = any).
# Optional BASENAME prefix filter (e.g. highascg → highascg_*.iso).
find_newest_iso_since() {
	local since="${1:-0}"
	local prefix="${2:-}"
	local latest="" t=0 f ts dir base
	shopt -s nullglob
	for dir in /home/eggs /home/eggs/mnt; do
		[[ -d "$dir" ]] || continue
		for f in "${dir}"/*.iso; do
			[[ -f "$f" ]] || continue
			if [[ -n "$prefix" ]]; then
				base="${f##*/}"
				[[ "$base" == "${prefix}"* ]] || [[ "$base" == "${prefix}_"* ]] || continue
			fi
			ts=$(stat -c %Y "$f" 2>/dev/null) || continue
			((ts >= since)) || continue
			if ((ts >= t)); then
				t=$ts
				latest=$f
			fi
		done
	done
	shopt -u nullglob
	[[ -n "$latest" ]] || {
		echo "No *.iso under /home/eggs/ (since epoch ${since}${prefix:+, prefix ${prefix}})." >&2
		return 1
	}
	printf '%s' "$latest"
}

list_flash_candidates() {
	local -a buf=()
	local path tran rm typ
	while read -r path tran rm; do
		[[ -n "$path" && -b "$path" ]] || continue
		typ=$(lsblk -ndo TYPE "$path" 2>/dev/null || true)
		[[ "$typ" == disk ]] || continue
		if [[ "$tran" == "usb" || "$rm" == "1" ]]; then
			buf+=("$path")
		fi
	done < <(lsblk -dnrpo PATH,TRAN,RM 2>/dev/null || true)
	if [[ ${#buf[@]} -eq 0 ]]; then
		echo "No drive with TRAN=usb or RM=1; listing all whole disks (be careful):" >&2
		while read -r path _; do
			[[ -n "$path" && -b "$path" ]] || continue
			typ=$(lsblk -ndo TYPE "$path" 2>/dev/null || true)
			[[ "$typ" == disk ]] || continue
			buf+=("$path")
		done < <(lsblk -dnrpo PATH,TRAN,RM 2>/dev/null || true)
	fi
	printf '%s\n' "${buf[@]}" | sort -u
}

# Args: [--require-yes PREFIX]
pick_usb_interactive() {
	require_yes=""
	if [[ "${1:-}" == "--require-yes" ]]; then
		require_yes="${2:?pre-prompt message required}"
		shift 2
	fi
	local -a opts=()
	mapfile -t opts < <(list_flash_candidates)
	if [[ ${#opts[@]} -eq 0 ]]; then
		echo "No block devices found." >&2
		return 1
	fi
	echo "Removable / USB candidates (whole disks only):"
	local i=1 p sz model tran
	for p in "${opts[@]}"; do
		sz=$(lsblk -dnro SIZE "$p" 2>/dev/null || echo "?")
		model=$(lsblk -dnro MODEL "$p" 2>/dev/null | head -1 || echo "")
		tran=$(lsblk -dnro TRAN "$p" 2>/dev/null | head -1 || echo "")
		printf '  %2d) %-12s %8s  TRAN=%-6s  %s\n' "$i" "$p" "$sz" "$tran" "$model"
		((i++)) || true
	done
	echo
	if [[ -n "$require_yes" ]]; then
		read -r -p "Before choosing a number — ${require_yes} [y/N] " ok || true
		[[ "${ok,,}" == "y" || "${ok,,}" == "yes" ]] || {
			echo "Aborted — plug the correct stick and re-run." >&2
			return 1
		}
	fi
	local choice
	read -r -p "Enter number for your USB stick (1-${#opts[@]}): " choice || true
	[[ "$choice" =~ ^[0-9]+$ ]] || {
		echo "Invalid choice." >&2
		return 1
	}
	((choice >= 1 && choice <= ${#opts[@]})) || {
		echo "Out of range." >&2
		return 1
	}
	USB="${opts[$((choice - 1))]}"
}

confirm_dd_flash() {
	local iso="$1" dev="$2" assume_yes="${3:-false}"
	local extra_note="${4:-}"
	echo
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "DESTROY ALL DATA ON **whole disk**: $dev"
	echo "ISO: $iso"
	[[ -n "$extra_note" ]] && echo "$extra_note"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	if [[ "$assume_yes" != true ]]; then
		local w
		read -r -p "Type YES (uppercase) to continue dd: " w
		[[ "$w" == "YES" ]] || {
			echo "Aborted." >&2
			return 1
		}
		read -r -p "Confirm device — type exactly: $dev " w2 || true
		[[ "$w2" == "$dev" ]] || {
			echo "Confirmation mismatch ($w2 ≠ $dev)." >&2
			return 1
		}
	fi
	return 0
}

# Write ISO → whole disk with periodic progress on stderr.
# status=progress is often silent under "sudo bash script.sh"; SIGUSR1 + wait can abort the script.
# Poll /sys/block/.../stat instead (no signals sent to dd).
dd_iso_with_progress() {
	local iso="$1" dev="$2"
	local bs="${3:-4M}"
	local dd_pid progress_pid dd_rc=0
	local dev_base iso_bytes sectors bytes

	[[ -f "$iso" ]] || {
		echo "ISO not found: $iso" >&2
		return 1
	}
	[[ -b "$dev" ]] || {
		echo "Not a block device: $dev" >&2
		return 1
	}

	dev_base="$(basename "$dev")"
	iso_bytes="$(stat -c%s "$iso")"

	echo "Writing ${iso} → ${dev} (bs=${bs}) …" >&2
	dd if="$iso" of="$dev" bs="$bs" iflag=fullblock status=none &
	dd_pid=$!
	(
		while kill -0 "$dd_pid" 2>/dev/null; do
			if [[ -r "/sys/block/${dev_base}/stat" ]]; then
				sectors="$(awk '{print $7}' "/sys/block/${dev_base}/stat")"
				bytes=$((sectors * 512))
				printf '%s  written: ' "$(date +%H:%M:%S)" >&2
				numfmt --to=iec-i --suffix=B "$bytes" 2>/dev/null || printf '%s B' "$bytes" >&2
				printf ' / ' >&2
				numfmt --to=iec-i --suffix=B "$iso_bytes" 2>/dev/null || printf '%s B' "$iso_bytes" >&2
				echo >&2
			fi
			sleep 2
		done
	) &
	progress_pid=$!
	set +e
	wait "$dd_pid"
	dd_rc=$?
	set -e
	kill "$progress_pid" 2>/dev/null || true
	wait "$progress_pid" 2>/dev/null || true
	return "$dd_rc"
}

# After dd/mkpart, USB sticks often hang plain lsblk/partprobe — never block the flash script.
usb_reread_partition_table() {
	local dev="$1"
	local dev_base partn i
	dev_base="$(basename "$dev")"
	echo "==> Reread partition table on ${dev} (USB-safe)…" >&2
	sync
	timeout 10 blockdev --rereadpt "$dev" 2>/dev/null || true
	timeout 10 partprobe "$dev" 2>/dev/null || true
	timeout 10 partx -u "$dev" 2>/dev/null || partx --update "$dev" 2>/dev/null || true
	udevadm settle --timeout=20 2>/dev/null || true
	for i in $(seq 1 25); do
		for partn in 2 3 4; do
			[[ -b "${dev}${partn}" ]] && return 0
		done
		sleep 1
	done
	echo "WARN: partition nodes slow to appear on ${dev} (continuing)" >&2
}

usb_print_partition_summary() {
	local dev="$1"
	echo "--- blkid ${dev}* ---" >&2
	blkid "${dev}"?* 2>/dev/null || blkid "$dev" 2>/dev/null || true
	if command -v parted >/dev/null 2>&1; then
		echo "--- parted ${dev} ---" >&2
		timeout 15 parted -s "$dev" unit MiB print 2>/dev/null || true
	fi
}

# Args: DEV [timeout_seconds]
usb_lsblk_safe() {
	local dev="${1:?}"
	local t="${2:-8}"
	local out rc=0
	if out="$(timeout "$t" lsblk -f "$dev" 2>&1)"; then
		printf '%s\n' "$out"
		return 0
	fi
	rc=$?
	if [[ "$rc" -eq 124 ]]; then
		echo "WARN: lsblk timed out after ${t}s on ${dev} (common USB quirk after dd)" >&2
	else
		echo "WARN: lsblk failed on ${dev}: ${out}" >&2
	fi
	usb_print_partition_summary "$dev"
	return 0
}

usb_mount_label_safe() {
	local label="${1:?}" mp="$2" i
	for i in $(seq 1 20); do
		if mount -L "$label" "$mp" 2>/dev/null; then
			return 0
		fi
		udevadm settle --timeout=5 2>/dev/null || true
		sleep 1
	done
	echo "ERROR: mount -L ${label} ${mp} failed after 20s" >&2
	blkid -L "$label" 2>/dev/null || blkid | grep -i "$label" || true
	return 1
}

# Block WO-47 automount while repartitioning / mkfs on the operator USB stick.
usb_mask_exfat_automount() {
	systemctl mask --runtime highascg-exfat-arrive.service 2>/dev/null || true
	systemctl mask --runtime home-casparcg-exfat.mount 2>/dev/null || true
	systemctl mask --runtime home-casparcg-highascg-media-exfat.mount 2>/dev/null || true
	systemctl stop highascg-exfat-sync.service highascg-exfat-arrive.service \
		highascg-exfat-server-update.service 2>/dev/null || true
	systemctl stop home-casparcg-highascg-media-exfat.mount home-casparcg-exfat.mount 2>/dev/null || true
}

usb_umount_disk_partitions() {
	local dev="${1:?}"
	local mnt pt
	while read -r mnt; do
		[[ -n "$mnt" ]] || continue
		umount "$mnt" 2>/dev/null || umount -l "$mnt" 2>/dev/null || true
	done < <(findmnt -rn -S "$dev" -o TARGET 2>/dev/null | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)
	while read -r pt; do
		[[ -n "$pt" ]] || continue
		umount "$pt" 2>/dev/null || umount -l "$pt" 2>/dev/null || true
	done < <(timeout 8 lsblk -nrpo PATH "$dev" 2>/dev/null || true)
	for mp in /home/casparcg/exfat /home/casparcg/highascg/media/exfat; do
		if findmnt -n -o SOURCE "$mp" 2>/dev/null | grep -q "^${dev}"; then
			umount "$mp" 2>/dev/null || umount -l "$mp" 2>/dev/null || true
		fi
	done
	sync
	udevadm settle --timeout=10 2>/dev/null || true
}

usb_quiesce_stick_for_partitioning() {
	usb_mask_exfat_automount
	usb_umount_disk_partitions "$1"
}

# Unmount + wipe stale signatures before mkfs. Residual HIGHASCGEXF labels trigger systemd/udev mounts.
usb_prepare_partition_for_mkfs() {
	local part="${1:?}"
	local label="${2:-}"
	usb_mask_exfat_automount
	umount "$part" 2>/dev/null || umount -l "$part" 2>/dev/null || true
	if [[ -n "$label" ]]; then
		while read -r mnt; do
			[[ -n "$mnt" ]] || continue
			umount "$mnt" 2>/dev/null || umount -l "$mnt" 2>/dev/null || true
		done < <(findmnt -rn -o TARGET -L "$label" 2>/dev/null || true)
	fi
	wipefs -a "$part" 2>/dev/null || true
	udevadm trigger --subsystem-match=block --action=change 2>/dev/null || true
	udevadm settle --timeout=15 2>/dev/null || true
	sleep 1
}

usb_partition_has_exfat_label() {
	local part="${1:?}" label="${2:?}"
	[[ "$(blkid -s TYPE -o value "$part" 2>/dev/null || true)" == exfat ]] \
		&& [[ "$(blkid -s LABEL -o value "$part" 2>/dev/null || true)" == "$label" ]]
}

usb_mkfs_exfat_labeled() {
	local part="${1:?}" label="${2:?}"
	local attempt rc=1
	for attempt in 1 2; do
		usb_prepare_partition_for_mkfs "$part" "$label"
		if mkfs.exfat -L "$label" "$part"; then
			return 0
		fi
		rc=$?
		if [[ "$attempt" -eq 1 ]]; then
			echo "WARN: mkfs.exfat busy on ${part} — quiesced WO-47 automount; retrying…" >&2
		fi
	done
	if usb_partition_has_exfat_label "$part" "$label"; then
		echo "Note: ${part} already exFAT LABEL=${label} (format skipped — partition was auto-mounted during mkpart)." >&2
		return 0
	fi
	echo "exFAT format fail on ${part}!" >&2
	findmnt -S "$part" 2>/dev/null >&2 || true
	return "$rc"
}

run_dd_flash() {
	local iso="$1" dev="$2"
	[[ "$(id -u)" -eq 0 ]] || {
		echo "Run as root." >&2
		return 1
	}
	[[ -f "$iso" ]] || {
		echo "ISO not found: $iso" >&2
		return 1
	}
	[[ -b "$dev" ]] || {
		echo "Not a block device: $dev" >&2
		return 1
	}

	echo "Unmounting any partitions on $dev …"
	systemctl daemon-reload 2>/dev/null || true
	umount "${dev}"* 2>/dev/null || true

	echo "Writing ISO → $dev (bs=4M) …"
	dd_iso_with_progress "$iso" "$dev" 4M || return 1
	sync
	usb_reread_partition_table "$dev"
	usb_lsblk_safe "$dev"
	echo "dd finished."
}
