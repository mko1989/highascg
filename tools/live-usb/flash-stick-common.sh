#!/usr/bin/env bash
# Shared helpers for flashing a HighAsCG ISO onto a USB whole-disk device.
# shellcheck shell=bash

find_latest_iso() {
	local latest="" t=0 f ts
	shopt -s nullglob
	local candidates=(/home/eggs/*.iso /home/eggs/mnt/*.iso)
	shopt -u nullglob
	[[ ${#candidates[@]} -gt 0 ]] || {
		echo "No *.iso found under /home/eggs/ or /home/eggs/mnt/. Build first or pass --iso." >&2
		return 1
	}
	for f in "${candidates[@]}"; do
		[[ -f "$f" ]] || continue
		ts=$(stat -c %Y "$f" 2>/dev/null) || continue
		if ((ts >= t)); then
			t=$ts
			latest=$f
		fi
	done
	[[ -n "$latest" ]] || return 1
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
	dd if="$iso" of="$dev" bs=4M status=progress oflag=sync conv=fsync
	sync
	partprobe "$dev"
	sleep 1
	lsblk "$dev"
	echo "dd finished."
}
